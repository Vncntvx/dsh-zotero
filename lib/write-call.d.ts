/** Host-owned write approval execution context. */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ZoteroWriteRisk } from './types.js';
/**
 * Who is asking for one write, and the plan the user reviews.
 *
 * The gate lives at the `ctx.zotero` seam, so a write cannot reach the domain
 * without a call like this: the service runs the session approval policy
 * (`ctx.approval.request`, where `never` auto-rejects) and then asks the user
 * with {@link ZoteroWriteCall.plan} on every write, and fails closed when no
 * channel can answer. `plan` is the caller's deterministic markdown, so what
 * the user approves is exactly what the service passes on. `exec` is
 * structurally the fields the asks need (agent, signal, tool name, call id),
 * so a tool's `ToolRunContext` satisfies it directly and a test can build one.
 *
 * The approval request carries `toolName`/`callId` so the audit pair links to
 * the already-logged tool call. The plan-review intent deliberately carries
 * **no `callId`**: that field names a logged invocation whose arguments hold
 * the reviewed plan, and a write tool's arguments hold the note body or the
 * tag list, so naming the call would send the client's plan panel after a
 * document that does not exist.
 */
export interface ZoteroWriteCall {
    /** The asking tool run: agent routes the asks, signal cancels them, name/callId audit the approval. */
    readonly exec: Pick<ToolRunContext, 'agent' | 'signal' | 'name' | 'callId'>;
    /** The plan markdown the user reviews; it must describe exactly this request. */
    readonly plan: string;
    /**
     * The blast radius the approval prompt states. Only deletions set it: a
     * destructive write must not open with the same sentence an additive one
     * uses, because the first prompt is read without the plan detail.
     */
    readonly risk?: ZoteroWriteRisk;
}
//# sourceMappingURL=write-call.d.ts.map