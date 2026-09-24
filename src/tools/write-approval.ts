/**
 * Plan-review approval for writes.
 *
 * Every write shows the plan card while the capability is on and
 * `writeConfirm` is set (`askPlanApproval`): the in-conversation
 * confirmation layer. Argument validation runs first so a malformed call
 * never bothers the user. The user's Zotero authorization dialog and its key
 * remain the hard boundary.
 *
 * Settlement map (the only contract this layer owns):
 * - `ASK_ABORTED` → harness `TOOL_ABORTED` (caller cancelled).
 * - `ASK_CANCELLED` → `false` (the user dismissed the plan review to talk;
 *   the official plan card settles the non-approve path this way, never as a
 *   `Cancel` option label). Callers return `kind: 'declined'`.
 * - any other answer without `Apply` → `false` (`declined`).
 * - no channel / ask infrastructure failure → `ZOTERO_WRITE_APPROVAL_UNAVAILABLE`
 *   (fail closed; not a user decision, not Zotero write auth).
 *
 * Mid-body domain failures throw `ZoteroError`; the registry maps those to
 * `{ name, code }` only.
 * @module dsh-zotero/tools/write-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolRunContext } from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.userQuestions` Context merge into this program.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TOOL_ABORTED_MESSAGE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  ZoteroError,
} from '../errors.js'

/** The label the plan-review question is answered with to apply the write. */
export const APPROVE_LABEL = 'Apply'

/** The question id every write plan carries, so UIs can route on it. */
export const WRITE_PLAN_QUESTION_ID = 'zotero-write-plan'

/**
 * Whether a settled ask rejection carries the given user-questions code.
 * The wire restores `UserQuestionError` (name + code); some paths surface a
 * `HarnessError` with the same code string. Match on name/code so a restored
 * value is recognized even if its class identity was lost in transit.
 * @param error - the rejected ask value.
 * @param code - the stable code to match.
 * @returns true when the rejection is that ask settlement.
 */
function isAskCode(error: unknown, code: 'ASK_ABORTED' | 'ASK_CANCELLED'): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return (
    candidate.code === code &&
    (error instanceof HarnessError ||
      candidate.name === 'UserQuestionError' ||
      candidate.name === 'HarnessError')
  )
}

/**
 * Show one write's plan and wait for the user's answer. The plan text is the
 * tool's own deterministic markdown — what the user approves is exactly what
 * the tool passes to the domain.
 * @param ctx - the plugin context, whose user-questions service answers.
 * @param exec - the running tool call; its agent routes the question and its
 *   signal cancels it.
 * @param planDetail - the plan markdown the UI renders.
 * @returns true only when the user answered with {@link APPROVE_LABEL};
 *   `false` for every non-approve user settlement (including `ASK_CANCELLED`).
 * @throws {ZoteroError} `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` when no channel
 *   can answer the question (fail closed).
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
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
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
          intent: {
            kind: 'plan-review',
            approve: APPROVE_LABEL,
            callId: exec.callId,
          },
        },
      ],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    return (answer.answers[0]?.selected ?? []).includes(APPROVE_LABEL)
  } catch (error) {
    if (isAskCode(error, 'ASK_ABORTED') || exec.signal.aborted) {
      throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED, { cause: error })
    }
    // The official plan card settles "Request changes / talk instead" as
    // ASK_CANCELLED — a user decision, not a missing channel. Map it to the
    // same non-approve outcome as choosing Cancel on a generic question UI.
    if (isAskCode(error, 'ASK_CANCELLED')) {
      return false
    }
    // NO_PROVIDER, CALLER_NOT_LIVE, DELEGATED_CALLER, BAD_INTENT, and any
    // other infrastructure failure: no channel can answer, so the write
    // cannot be approved — refuse it.
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE, {
      cause: error,
    })
  }
}
