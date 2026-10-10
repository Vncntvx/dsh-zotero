/**
 * Approval gates for writes: the confirmation layer of the `ctx.zotero` seam.
 *
 * Two sequential gates, both owned here so no caller can skip either:
 * 1. {@link requestWriteApproval}, the session approval policy
 *    (`ctx.approval.request`). Honors `approval/policy: never` (auto-reject)
 *    and writes the `approval/asked` + `approval/decided` audit pair.
 * 2. {@link askPlanApproval}, the plan-review card (`userQuestions`).
 *    The user approves the exact plan markdown the domain will apply.
 *
 * The gate lives here, not in a tool, because the service is the only door to
 * the write domain: every in-process caller (the write tools, and any
 * consumer that resolves `ctx.zotero`) passes through `ZoteroService`'s write
 * methods. Argument validation still runs in the caller first, so a malformed
 * call never bothers the user with an approval for a call that cannot run.
 * The user's Zotero authorization dialog and its key remain the hard boundary.
 *
 * Approval-settlement map ({@link requestWriteApproval}):
 * - `allowed-once` → proceed to plan-review.
 * - `rejected` / `cancelled` → `declined` (no plan card, no network).
 * - `unavailable` / no agent / infrastructure failure →
 *   `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` (fail closed).
 * - no `ctx.approval` composed → `unavailable` as well: the decision cannot
 *   be routed or audited, so the gate fails closed, and plan-review never
 *   runs without it.
 *
 * A call that carries no agent while an approval service is composed is
 * `unavailable`, never `allowed`: the request cannot be routed or audited,
 * matching harness `serviceAsk` and sandbox escalation.
 *
 * Plan-settlement map ({@link askPlanApproval}):
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
// Type-only: brings the `ctx.approval` Context merge into this program.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
// Type-only: brings the `ctx.userQuestions` Context merge into this program.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TOOL_ABORTED_MESSAGE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  ZoteroError,
} from './errors.js'
import { PERSONAL_LIBRARY } from './refs.js'
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
  'Every write first passes the session approval policy (a "never" session auto-rejects) and then shows a plan the user approves; neither confirmation is configurable. Kind "declined" means the write was not approved and nothing was written: do not retry unasked.'

/**
 * Appended by every tool that can report a committed-unverified outcome, so
 * the do-not-retry contract is stated once and cannot drift between tools.
 */
export const WRITE_COMMITTED_UNVERIFIED_DESCRIPTION =
  ' kind "committed-unverified" means the write must be treated as committed although its response could not be verified; do not retry, reconcile by key/ref when available.'

/**
 * The plan line every write tool prints naming the library it writes to.
 *
 * Composed from `PERSONAL_LIBRARY` rather than spelled so the plan cannot
 * silently name a library the write boundary refuses: the seam only ever
 * writes `zotero://user/0/`.
 */
export const WRITE_PLAN_LIBRARY_LINE = `- Library: zotero://${PERSONAL_LIBRARY.type}/${PERSONAL_LIBRARY.id} (the local personal library)`

/** The single reason string every write approval request logs. */
function writeApprovalReason(call: ZoteroWriteCall): string {
  return `Zotero library write: ${call.exec.name}`
}

/**
 * Whether a settled ask rejection carries the given user-questions code.
 * The ask() exit path restores `UserQuestionError` instances uniformly, and
 * that class extends `HarnessError`, so class identity plus the stable code
 * is the whole contract, the same judgment the official plan card makes.
 * @param error - the rejected ask value.
 * @param code - the stable code to match.
 * @returns true when the rejection is that ask settlement.
 */
function isAskCode(error: unknown, code: 'ASK_ABORTED' | 'ASK_CANCELLED'): boolean {
  return error instanceof HarnessError && error.code === code
}

/**
 * One write's outcome under the session approval policy, before any plan card.
 *
 * When `ctx.approval` is composed this is the deployment-level gate: `never`
 * auto-rejects, `ask` routes to the composed answerers, and every request
 * writes the `approval/asked` + `approval/decided` audit pair. When no
 * approval service is composed the gate fails closed: the decision cannot be
 * routed or audited, matching the user-approval package's stance for headless
 * or incompletely composed deployments.
 * @param ctx - the plugin context, whose approval service decides.
 * @param call - the asking write call (agent, signal, tool name, call id).
 * @returns `'allowed'` to continue to plan-review; `'declined'` when the
 *   session policy or the user refused; `'unavailable'` when the approval
 *   channel cannot decide at all (fail closed).
 * @throws {HarnessError} the harness's own abort when the caller cancelled.
 */
export async function requestWriteApproval(
  ctx: Context,
  call: ZoteroWriteCall,
): Promise<'allowed' | 'declined' | 'unavailable'> {
  const { exec } = call
  const approval = ctx.get('approval')
  // Absent approval service: the decision cannot be routed or audited.
  // Fail closed, matching the user-approval package's fail-closed stance
  // for headless or incompletely composed deployments.
  if (approval === undefined) return 'unavailable'
  // Absent agent: the request cannot be routed or audited. Fail closed,
  // matching harness `serviceAsk` and sandbox escalation, which both deny an
  // ask that has no agent to route it through.
  if (exec.agent === undefined) return 'unavailable'
  let outcome: ApprovalOutcome
  try {
    outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      reason: writeApprovalReason(call),
      displayReason: {
        en: 'Allow this Zotero library write? A plan card follows for the exact change.',
        zh: '允许这次 Zotero 库写入？随后会展示具体变更的计划卡。',
      },
      signal: exec.signal,
    })
  } catch (error) {
    if (error instanceof HarnessError && error.code === TOOL_ABORTED) throw error
    if (exec.signal.aborted) {
      throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED, { cause: error })
    }
    // Outside-turn, audit-append failure, or a throwing answerer: the
    // decision cannot be logged, so the write cannot proceed.
    return 'unavailable'
  }
  switch (outcome) {
    case 'allowed-once':
      return 'allowed'
    case 'rejected':
    case 'cancelled':
      return 'declined'
    default:
      // 'unavailable' and any rogue value: fail closed.
      return 'unavailable'
  }
}

/**
 * Show one write's plan and wait for the user's answer. The plan text is the
 * caller's deterministic markdown, so what the user approves is exactly what
 * the service passes to the domain.
 * @param ctx - the plugin context, whose user-questions service answers.
 * @param call - the asking write call: its plan markdown, its agent (which
 *   routes the question), and its signal (which cancels the question). The
 *   plan-review intent carries no `callId`; see {@link ZoteroWriteCall}.
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
  // cordis's inject guard. The seam is optional at runtime, so absence means
  // fail closed below.
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
            // whose ARGUMENTS carry the reviewed plan, which is what plan mode's
            // own tool call is. A write tool's arguments carry the note body or the
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
    // ASK_CANCELLED is a user decision, not a missing channel. Map it to the
    // same non-approve outcome as choosing Cancel on a generic question UI.
    if (isAskCode(error, 'ASK_CANCELLED')) {
      return false
    }
    // NO_PROVIDER, CALLER_NOT_LIVE, DELEGATED_CALLER, BAD_INTENT, and any
    // other infrastructure failure: no channel can answer, so the write
    // cannot be approved, and the gate refuses it.
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE, {
      cause: error,
    })
  }
}
