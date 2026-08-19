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
import {
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
export type ConnectivityAskExec = Pick<ToolRunContext, 'signal' | 'agent'>

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
    header: 'Zotero version too old',
    question: 'The running Zotero does not speak local API version 3, which this plugin requires.',
    detail: 'Upgrade Zotero to a version whose local API supports version 3.',
    retryLabel: 'I upgraded Zotero, retry (Recommended)',
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
 * Run one Zotero request; on a connectivity failure, ask the user how to
 * proceed and retry at most once when they choose the recommended action.
 * @param ctx - the plugin context; the question service is looked up
 *   optionally, so headless compositions skip the ask.
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
  exec: ConnectivityAskExec,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof ZoteroError) || !isAskWorthyCode(error.code)) throw error
    const questions = ctx.get('userQuestions') as UserQuestionService | undefined
    if (questions === undefined) throw error
    const spec = FAILURE_SPECS[error.code]
    let answer: AskUserQuestionAnswer
    try {
      const request: AskUserQuestionRequest = {
        questions: [questionOf(spec)],
        ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
        signal: exec.signal,
      }
      answer = await questions.ask(request)
    } catch {
      // A failed question (no provider, aborted ask, delegated caller) must
      // never mask the underlying connectivity failure.
      if (exec.signal?.aborted) throw new HarnessError('tool call aborted', TOOL_ABORTED)
      throw error
    }
    const answerItem = answer.answers.find((item) => item.id === 'zotero-failure')
    const selected = answerItem?.selected ?? []
    if (!selected.includes(spec.retryLabel)) throw error
    // Outside the catch: a second failure propagates as-is, never re-asking.
    return await run()
  }
}
