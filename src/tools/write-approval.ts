/**
 * Plan-review approval for writes.
 *
 * Every write shows the plan card while the capability is on and
 * `writeConfirm` is set (`askPlanApproval`): the in-conversation
 * confirmation layer. Argument validation runs first so a malformed call
 * never bothers the user. The user's Zotero authorization dialog and its key
 * remain the hard boundary.
 *
 * The layer fails closed: the model never writes past an unanswered plan.
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
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
} from '../errors.js'

/** The label the plan-review question is answered with to apply the write. */
export const APPROVE_LABEL = 'Apply'

/** The question id every write plan carries, so UIs can route on it. */
export const WRITE_PLAN_QUESTION_ID = 'zotero-write-plan'

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
