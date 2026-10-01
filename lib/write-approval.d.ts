/**
 * Approval gates for writes — the confirmation layer of the `ctx.zotero` seam.
 *
 * Two sequential gates, both owned here so no caller can skip either:
 * 1. {@link requestWriteApproval} — the session approval policy
 *    (`ctx.approval.request`). Honors `approval/policy: never` (auto-reject)
 *    and writes the `approval/asked` + `approval/decided` audit pair.
 * 2. {@link askPlanApproval} — the plan-review card (`userQuestions`).
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
 *   be routed or audited, so the gate fails closed — plan-review never runs
 *   without it.
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
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroWriteCall } from './types.js';
/** The label the plan-review question is answered with to apply the write. */
export declare const APPROVE_LABEL = "Apply";
/** The question id every write plan carries, so UIs can route on it. */
export declare const WRITE_PLAN_QUESTION_ID = "zotero-write-plan";
/**
 * The shared model-facing sentence for the plan-review outcome. Every write
 * tool appends this so the declined contract cannot drift between tools.
 */
export declare const WRITE_PLAN_OUTCOME_DESCRIPTION = "Every write first passes the session approval policy (a \"never\" session auto-rejects) and then shows a plan the user approves \u2014 neither confirmation is configurable; kind \"declined\" means the write was not approved and nothing was written \u2014 do not retry unasked.";
/**
 * Appended by every tool that can report a committed-unverified outcome, so
 * the do-not-retry contract is stated once and cannot drift between tools.
 */
export declare const WRITE_COMMITTED_UNVERIFIED_DESCRIPTION = " kind \"committed-unverified\" means the write must be treated as committed although its response could not be verified; do not retry, reconcile by key/ref when available.";
/**
 * One write's outcome under the session approval policy, before any plan card.
 *
 * When `ctx.approval` is composed this is the deployment-level gate: `never`
 * auto-rejects, `ask` routes to the composed answerers, and every request
 * writes the `approval/asked` + `approval/decided` audit pair. When no
 * approval service is composed the gate fails closed — the decision cannot
 * be routed or audited, matching the user-approval package's stance for
 * headless or incompletely composed deployments.
 * @param ctx - the plugin context, whose approval service decides.
 * @param call - the asking write call (agent, signal, tool name, call id).
 * @returns `'allowed'` to continue to plan-review; `'declined'` when the
 *   session policy or the user refused; `'unavailable'` when the approval
 *   channel cannot decide at all (fail closed).
 * @throws {HarnessError} the harness's own abort when the caller cancelled.
 */
export declare function requestWriteApproval(ctx: Context, call: ZoteroWriteCall): Promise<'allowed' | 'declined' | 'unavailable'>;
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
export declare function askPlanApproval(ctx: Context, call: ZoteroWriteCall): Promise<boolean>;
//# sourceMappingURL=write-approval.d.ts.map