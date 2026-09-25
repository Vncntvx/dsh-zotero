/**
 * Plan-review approval for writes — the confirmation layer of the
 * `ctx.zotero` seam.
 *
 * The gate lives here, not in a tool, because the service is the only door to
 * the write domain: every in-process caller (the three write tools, and any
 * consumer that resolves `ctx.zotero`) passes through `ZoteroService`'s write
 * methods, so no caller can write without the plan the user approves. Argument
 * validation still runs in the caller first, so a malformed call never bothers
 * the user with an approval for a call that cannot run. The user's Zotero
 * authorization dialog and its key remain the hard boundary.
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
 * @module dsh-zotero/write-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.userQuestions` Context merge into this program.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TOOL_ABORTED_MESSAGE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  ZoteroError,
} from './errors.js'
import type { ZoteroWriteCall } from './types.js'

/** The label the plan-review question is answered with to apply the write. */
export const APPROVE_LABEL = 'Apply'

/** The question id every write plan carries, so UIs can route on it. */
export const WRITE_PLAN_QUESTION_ID = 'zotero-write-plan'

/**
 * The shared model-facing sentence for the plan-review outcome. Every write
 * tool appends this so the declined contract cannot drift between tools.
 */
export const WRITE_PLAN_OUTCOME_DESCRIPTION =
  'Every write first shows a plan the user approves — the confirmation is not configurable; kind "declined" means the user answered the plan without approving and nothing was written — do not retry unasked.'

/**
 * Whether a settled ask rejection carries the given user-questions code.
 * The wire restores `UserQuestionError` (name + code); some paths surface a
 * `HarnessError` with the same code string. Match the exact code and the
 * documented harness/user-question error names, including a transported
 * value whose class identity was lost in transit.
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
 * caller's deterministic markdown — what the user approves is exactly what the
 * service passes to the domain.
 * @param ctx - the plugin context, whose user-questions service answers.
 * @param call - the asking write call: its plan markdown, its agent (which
 *   routes the question), and its signal (which cancels the question). The
 *   plan-review intent carries no `callId` — see {@link ZoteroWriteCall}.
 * @returns true only when the user answered with {@link APPROVE_LABEL};
 *   `false` for every non-approve user settlement (including `ASK_CANCELLED`).
 * @throws {ZoteroError} `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` when no channel
 *   can answer the question (fail closed).
 * @throws {HarnessError} the harness's own abort when the caller cancelled.
 */
export async function askPlanApproval(ctx: Context, call: ZoteroWriteCall): Promise<boolean> {
  const { exec, plan } = call
  // `ctx.get`, not the property proxy: the service fiber carries no inject
  // declarations for this optional seam, so a property read would trip
  // cordis's inject guard. The seam is optional at runtime — absent means fail
  // closed below.
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
          detail: plan,
          options: [
            { label: APPROVE_LABEL, description: 'Write to the Zotero library now' },
            { label: 'Cancel', description: 'Discard this plan; nothing is written' },
          ],
          intent: {
            kind: 'plan-review',
            approve: APPROVE_LABEL,
            // Deliberately no `callId`: that field names a LOGGED invocation
            // whose ARGUMENTS carry the reviewed plan — what plan mode's own
            // tool call is. A write tool's arguments carry the note body or the
            // tag list, not a plan document, so naming the call here sends the
            // client's plan panel looking for a document that does not exist
            // ("无法读取计划 / 未找到这份计划"). Left out, the client shows the
            // plan below as an in-band preview of exactly what was asked.
          },
        },
      ],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    const items = answer.answers.filter((a) => a.id === WRITE_PLAN_QUESTION_ID)
    const item = items.length === 1 ? items[0] : undefined
    if (item === undefined || item.custom !== undefined) return false
    return item.selected.length === 1 && item.selected[0] === APPROVE_LABEL
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
