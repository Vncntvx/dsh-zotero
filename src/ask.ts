/**
 * Interactive recovery for Zotero connectivity failures.
 *
 * When a request-driven tool call fails because Zotero cannot serve it
 * (not running, local API disabled, unsupported API version, timeout),
 * the caller is asked how to proceed through the `userQuestions` seam,
 * with the recommended action offered first. The ask happens only inside
 * a tool call that actually attempted a Zotero request — loading the
 * plugin never probes, and a tool that was never called never asks.
 * Everything here fails closed: an absent question service, a failed
 * question, or a non-retry answer all surface the original typed
 * `ZoteroError`, so a broken question mechanism can never mask a broken
 * Zotero connection, and a retry is attempted at most once.
 * @module dsh-zotero/ask
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
  UserQuestionService,
} from '@deepseek-ai/dsh-user-questions'
import { ZOTERO_LOCAL_API_VERSION } from './constants.js'
import {
  TOOL_ABORTED_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_RUNNING,
  ZOTERO_TIMEOUT,
  ZoteroError,
} from './errors.js'

/** The connectivity failure codes that warrant asking the user how to proceed. */
const ASK_WORTHY_CODES = [
  ZOTERO_NOT_RUNNING,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_TIMEOUT,
] as const

type AskWorthyCode = (typeof ASK_WORTHY_CODES)[number]

/** The parts of a tool execution `withConnectivityAsk` needs. */
type ConnectivityAskExec = Pick<ToolRunContext, 'signal' | 'agent'>

/** One connectivity failure rendered as a question card with a recommended option. */
interface FailureSpec {
  readonly header: string
  readonly question: string
  readonly detail: string
  readonly retryLabel: string
  readonly retryDescription: string
  readonly abortLabel: string
  readonly abortDescription: string
}

const ABORT_LABEL = 'Abort this query'
const ABORT_DESCRIPTION = 'Stop this operation; ask me to retry later if you still need it.'
const RETRY_DESCRIPTION = 'Re-run the query with the original parameters.'

const FAILURE_SPECS: Record<AskWorthyCode, FailureSpec> = {
  [ZOTERO_NOT_RUNNING]: {
    header: 'Zotero is not running',
    question: 'Zotero is not running, so I cannot read your library. What should I do?',
    detail:
      'Start Zotero, then in Settings → Advanced check "Allow other applications on this computer to communicate with Zotero".',
    retryLabel: 'I started Zotero, retry (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_API_DISABLED]: {
    header: 'Zotero local API is disabled',
    question: 'Zotero is running but rejected the local API request (403).',
    detail:
      'In Zotero Settings → Advanced, check "Allow other applications on this computer to communicate with Zotero".',
    retryLabel: 'I enabled the local API, retry (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_API_VERSION]: {
    header: 'Zotero and this plugin share no API version',
    question: `The running Zotero does not implement local API version ${ZOTERO_LOCAL_API_VERSION}, which this plugin requires.`,
    detail: `Upgrade Zotero to a version whose local API supports version ${ZOTERO_LOCAL_API_VERSION} — or update dsh-zotero if the running Zotero is newer than this plugin line.`,
    retryLabel: 'I fixed the version, retry (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_TIMEOUT]: {
    header: 'Zotero timed out',
    question: 'Zotero did not respond within the timeout (it may be indexing a large library).',
    detail: 'The request failed after the configured timeout.',
    retryLabel: 'Retry (Recommended)',
    retryDescription: 'Run the same request again.',
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
}

function isAskWorthyCode(code: string): code is AskWorthyCode {
  return (ASK_WORTHY_CODES as readonly string[]).includes(code)
}

function questionOf(spec: FailureSpec): AskUserQuestionItem {
  return {
    id: 'zotero-failure',
    question: spec.question,
    header: spec.header,
    detail: spec.detail,
    options: [
      { label: spec.retryLabel, description: spec.retryDescription },
      { label: spec.abortLabel, description: spec.abortDescription },
    ],
  }
}

/**
 * One recovery conversation per failure kind, owned by the plugin service
 * instance that holds the gate.
 *
 * Tool calls run concurrently, and a Zotero that is down fails all of them:
 * five parallel reads used to put five identical cards in front of the user,
 * each one demanding the same answer. The gate keeps one ask per failure
 * kind in flight and lets every other caller wait on that same answer, so a
 * single card decides for all of them — and each caller then retries, or
 * does not, on its own request. The entry is dropped as soon as the question
 * settles, so a later failure asks again instead of inheriting a stale
 * answer.
 *
 * Ownership is the service instance, not a transport generation. Callers pass
 * `service.recovery`; `ZoteroService.buildTransport()` replaces HTTP clients
 * and the provider but intentionally keeps this gate so in-flight waiters and
 * new failures stay on one conversation. Replacing the gate on a volatile
 * commit would stack cards — do not treat recovery as config-scoped state.
 *
 * Only idempotent reads ride this helper: its contract re-runs `run` on
 * retry, which a write cannot promise (retrying a timed-out note creation
 * would create the note twice). Write tools surface domain failures directly
 * instead.
 */
export class ConnectivityRecovery {
  private readonly asking = new Map<string, Promise<boolean>>()

  /**
   * Answer one failure kind, asking only when no question for it is in
   * flight.
   * @param code - the failure kind the question belongs to.
   * @param question - the ask to run when this caller is the first; resolves
   *   true when the user chose to retry.
   * @returns the answer this caller acts on.
   */
  async ask(code: string, question: () => Promise<boolean>): Promise<boolean> {
    const inFlight = this.asking.get(code)
    if (inFlight !== undefined) return await inFlight
    const answer = question()
    this.asking.set(code, answer)
    try {
      return await answer
    } finally {
      this.asking.delete(code)
    }
  }
}

/**
 * Run one Zotero request; on a connectivity failure, ask the user how to
 * proceed and retry at most once when they choose the recommended action.
 * @param ctx - the plugin context; the question service is looked up
 *   optionally, so headless compositions skip the ask.
 * @param recovery - the instance's recovery gate: callers that failed the
 *   same way share one question instead of stacking identical cards.
 * @param exec - the tool execution (signal and agent) the failure belongs to.
 * @param run - the request to attempt; must be re-runnable with identical
 *   arguments, because the retry path calls it a second time.
 * @returns the request result, or throws the original `ZoteroError` when
 *   the failure is not ask-worthy, no question service exists, the user
 *   does not choose to retry, the question itself fails, or the retry
 *   fails again.
 */
export async function withConnectivityAsk<T>(
  ctx: Context,
  recovery: ConnectivityRecovery,
  exec: ConnectivityAskExec,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof ZoteroError) || !isAskWorthyCode(error.code)) throw error
    const questions = ctx.get('userQuestions')
    if (questions === undefined) throw error
    const spec = FAILURE_SPECS[error.code]
    let retry: boolean
    try {
      retry = await recovery.ask(error.code, async () => {
        const request: AskUserQuestionRequest = {
          questions: [questionOf(spec)],
          ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
          signal: exec.signal,
        }
        const answer: AskUserQuestionAnswer = await questions.ask(request)
        const answerItem = answer.answers.find((item) => item.id === 'zotero-failure')
        // Matched by label string because the answer protocol carries only
        // selected labels (no stable option ids); the labels are code
        // constants (FAILURE_SPECS), never i18n copy, so a rename breaks the
        // build's contract visibly in one place. Revisit if the protocol
        // gains option ids.
        return (answerItem?.selected ?? []).includes(spec.retryLabel)
      })
    } catch {
      // A failed question (no provider, aborted ask, delegated caller) must
      // never mask the underlying connectivity failure.
      if (exec.signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
      throw error
    }
    if (!retry) throw error
    // Outside the catch: a second failure propagates as-is, never re-asking.
    return await run()
  }
}
