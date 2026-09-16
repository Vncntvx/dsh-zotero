/**
 * Plan-review approval and the pre-dispatch write policy gate.
 *
 * Two layers sit in front of Zotero:
 *
 * 1. **Policy** (`tools/pre-execute`): when the live config has the write
 *    capability off, the call is denied before the tool body runs (a settings
 *    race after the tools were registered). The deny carries structured
 *    `ToolErrorInfo.reason` — durable user-facing detail the harness keeps out
 *    of model-facing content.
 * 2. **Plan card** (`askPlanApproval`): the in-conversation confirmation
 *    every write shows while the capability is on. Argument validation runs
 *    first so a malformed call never bothers the user. The user's Zotero
 *    authorization dialog and its key remain the hard boundary.
 *
 * Both layers fail closed: the model never writes past an unanswered plan.
 * Mid-body domain failures throw `ZoteroError`; the registry maps those to
 * `{ name, code }` only — `errorInfo` does not extract `reason` from throws
 * at this harness line.
 * @module dsh-zotero/tools/write-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import {
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecution,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.userQuestions` Context merge into this program.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TOOL_ABORTED_MESSAGE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  WRITE_DISABLED_MESSAGE,
  ZOTERO_WRITE_DISABLED,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
} from '../errors.js'
import type { ZoteroService } from '../service.js'

/** The label the plan-review question is answered with to apply the write. */
export const APPROVE_LABEL = 'Apply'

/** The question id every write plan carries, so UIs can route on it. */
export const WRITE_PLAN_QUESTION_ID = 'zotero-write-plan'

/** Tool names the write policy gate covers. */
export const WRITE_TOOL_NAMES = [
  'zotero_create_note',
  'zotero_add_tags',
  'zotero_add_to_collection',
] as const

/** The structured error identity every write-policy denial carries. */
const WRITE_DENIED_INFO_NAME = 'ZoteroError'

/**
 * Show one write's plan and wait for the user's answer. The plan text is the
 * tool's own deterministic markdown — what the user approves is exactly what
 * the tool passes to the domain.
 * @param ctx - the plugin context, whose user-questions service answers.
 * @param exec - the running tool call; its agent routes the question and its
 *   signal cancels it.
 * @param planDetail - the plan markdown the UI renders.
 * @returns true only when the user answered with {@link APPROVE_LABEL}.
 * @throws {ZoteroError} `ZOTERO_WRITE_UNAUTHORIZED` when no channel can
 *   answer the question (fail closed).
 * @throws {HarnessError} the harness's own abort when the caller cancelled.
 */
export async function askPlanApproval(
  ctx: Context,
  exec: ToolRunContext,
  planDetail: string,
): Promise<boolean> {
  // `ctx.get`, not the property proxy: the execute fiber carries no inject
  // declarations, so a property read would trip cordis's inject guard. The
  // seam is optional at runtime — absent means fail closed below.
  const questions = ctx.get('userQuestions')
  if (questions === undefined) {
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED)
  }
  try {
    const answer = await questions.ask({
      questions: [
        {
          id: WRITE_PLAN_QUESTION_ID,
          question: 'Apply this write to your Zotero library?',
          detail: planDetail,
          options: [
            { label: APPROVE_LABEL, description: 'Write to the Zotero library now' },
            { label: 'Cancel', description: 'Discard this plan; nothing is written' },
          ],
          intent: { kind: 'plan-review', approve: APPROVE_LABEL },
        },
      ],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    return (answer.answers[0]?.selected ?? []).includes(APPROVE_LABEL)
  } catch (error) {
    if (error instanceof HarnessError && error.code === 'ASK_ABORTED') {
      throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED, { cause: error })
    }
    // NO_PROVIDER, CALLER_NOT_LIVE, DELEGATED_CALLER, BAD_INTENT: no channel
    // can answer, so the write cannot be approved — refuse it.
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED, {
      cause: error,
    })
  }
}

/**
 * A pre-dispatch deny that keeps the model-facing text the tool's domain
 * message and parks the user-facing detail on `ToolErrorInfo.reason` (the
 * harness's durable-projection channel; never model content).
 */
function writeDeny(
  message: string,
  code: typeof ZOTERO_WRITE_DISABLED | typeof ZOTERO_WRITE_UNAUTHORIZED,
  reason: string,
): PreToolDecision {
  return {
    kind: 'deny',
    reason: message,
    info: {
      name: WRITE_DENIED_INFO_NAME,
      code,
      reason,
    },
  }
}

/**
 * Pre-dispatch policy for the write tools: deny before the body runs when the
 * live config has the write capability off (a settings race after the tools
 * were registered). Plan review and argument validation stay in the tool body
 * — a malformed call must not be denied as "unapproved", and a mid-body
 * domain failure still throws `ZoteroError` (the registry maps that to
 * `{ name, code }` only; `ToolErrorInfo.reason` is populated only on this
 * deny path at the current harness line).
 * @param service - the live plugin service (config authority).
 * @param exec - the pending call.
 * @returns the denial, or `undefined` to allow the body to run.
 */
export function writePolicyDecision(
  service: ZoteroService,
  exec: Pick<ToolExecution, 'name'>,
): PreToolDecision | undefined {
  if (!(WRITE_TOOL_NAMES as readonly string[]).includes(exec.name)) return undefined
  if (service.config.writeEnabled) return undefined
  return writeDeny(
    WRITE_DISABLED_MESSAGE,
    ZOTERO_WRITE_DISABLED,
    'The write capability is off in the Zotero settings page (writeEnabled: false); enable it before calling write tools.',
  )
}
