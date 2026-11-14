/**
 * Per-agent write policy for Zotero's global write tools.
 *
 * A child agent must not modify the personal library. The policy is expressed
 * on two public harness surfaces:
 *
 * - `agent.ctx.tools.restrict({ deny })` removes the write tools from that
 *   agent's view, so schema presentation, lookup, and execution agree;
 * - a plugin-level `ctx.tools.guard()` denies a write call from a tracked
 *   child even when a caller supplies the tool name out of band. Guards are
 *   monotonic: no later listener can turn the denial back into permission.
 *
 * Child identity comes from durable session lineage (`SessionHeader.origin`
 * or a positive `delegationDepth`), not `AgentRegistry.roots()`. Runtime
 * ownership is independent of session lineage, and a resumed fork can still
 * be a runtime root while remaining a child by lineage.
 *
 * The registry is resolved through `ctx.get('agents', false)` rather than an
 * `inject` declaration. The Zotero service must stay active in compositions
 * without an AgentRegistry (the host tool lanes and any non-agent profile),
 * and the guard must exist before the constructor's `reconcileWriteTools()`
 * call. A missing registry therefore means "no children to track", and the
 * lookup retries so a registry mounted after this service is still observed.
 *
 * @module dsh-zotero/subagent-guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DiagnosticsRecorder } from './diagnostics.js';
/** The model-facing denial. One constant, so a wording change edits one place. */
export declare const SUBAGENT_WRITE_DENIAL_REASON = "Zotero write tools are reserved for the root agent. A subagent cannot modify the personal library; return the intended change to the calling agent instead.";
/** The lifecycle operations ZoteroService needs when its write surface changes. */
export interface SubagentGuard {
    /** Apply the current write-capability state to every tracked child. */
    refresh(writeEnabled: boolean): void;
    /** Lift every per-agent restriction owned by this guard. */
    dispose(): void;
}
/**
 * Track live child agents and keep Zotero's write surface out of their view.
 * @param ctx - the Zotero service context.
 * @param diagnostics - the service's diagnostics recorder.
 * @returns refresh and teardown operations owned by ZoteroService.
 */
export declare function createSubagentGuard(ctx: Context, diagnostics: DiagnosticsRecorder): SubagentGuard;
//# sourceMappingURL=subagent-guard.d.ts.map