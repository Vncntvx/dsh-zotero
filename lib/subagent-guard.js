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
import { LIBRARY_WRITE_TOOL_NAMES, SCHOLARLY_SAVE_TOOL_NAME } from './constants.js';
import { errorMessageOf } from './errors.js';
import { FIBER_STATE } from './fiber-state.js';
/** The model-facing denial. One constant, so a wording change edits one place. */
export const SUBAGENT_WRITE_DENIAL_REASON = 'Zotero write tools are reserved for the root agent. A subagent cannot modify the personal library; return the intended change to the calling agent instead.';
const WRITE_NAME_SET = new Set(LIBRARY_WRITE_TOOL_NAMES);
/**
 * Track live child agents and keep Zotero's write surface out of their view.
 * @param ctx - the Zotero service context.
 * @param diagnostics - the service's diagnostics recorder.
 * @returns refresh and teardown operations owned by ZoteroService.
 */
export function createSubagentGuard(ctx, diagnostics) {
    const active = new Map();
    let registry;
    let writeEnabled = false;
    let disposed = false;
    /** Resolve the registry lazily: a registry mounted after this service still counts. */
    const agentRegistry = () => (registry ??= ctx.get('agents', false));
    const isRestricted = (agent) => {
        const header = agent.session?.header;
        return header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0;
    };
    /**
     * One `view()` rebuild per refresh instead of one per write name per agent:
     * `definitions()` resolves the same global `view().visible` that `get(name)`
     * reads, so the registered-name set is identical for every tracked child.
     */
    const registeredGlobalNames = () => new Set(ctx.tools.definitions().map(({ name }) => name));
    /** restrict() rejects unknown names; observe global registrations before masking. */
    const denyNamesOf = (registered) => LIBRARY_WRITE_TOOL_NAMES.filter((name) => (writeEnabled || name === SCHOLARLY_SAVE_TOOL_NAME) && registered.has(name));
    const apply = (restriction, deny) => {
        const names = deny.join(',');
        if (names === restriction.names)
            return;
        const previousNames = restriction.names;
        // Set this before restrict/dispose emit tools/change, preventing recursion.
        restriction.names = names;
        let dispose;
        try {
            if (deny.length > 0)
                dispose = restriction.ctx.tools.restrict({ deny: [...deny] });
        }
        catch (error) {
            restriction.names = previousNames;
            throw error;
        }
        const previous = restriction.dispose;
        restriction.dispose = dispose;
        previous?.();
    };
    const release = (restriction) => {
        const effectDispose = restriction.effectDispose;
        restriction.effectDispose = undefined;
        effectDispose?.();
        const dispose = restriction.dispose;
        restriction.dispose = undefined;
        restriction.names = '';
        dispose?.();
    };
    const retire = (agent) => {
        const restriction = active.get(agent);
        if (restriction === undefined)
            return;
        active.delete(agent);
        release(restriction);
    };
    const track = (agent) => {
        if (disposed || active.has(agent) || !isRestricted(agent))
            return;
        if (agentRegistry() === undefined)
            return;
        const restriction = { ctx: agent.ctx, names: '' };
        // A custom registry may omit `agent/disposed`; the agent's own scope
        // unwind still retires the map entry, and the restriction unwinds with it.
        restriction.effectDispose = agent.ctx.effect(() => () => retire(agent), 'zotero: subagent guard retire');
        active.set(agent, restriction);
        apply(restriction, denyNamesOf(registeredGlobalNames()));
    };
    ctx.on('agent/created', ({ agent }) => {
        track(agent);
        return undefined;
    });
    ctx.on('agent/disposed', ({ agent }) => {
        retire(agent);
    });
    // A denial that must hold regardless of listener order: the tool remains
    // callable by name, so the view-layer restriction alone cannot enforce it.
    const guardDispose = ctx.tools.guard((execution) => {
        if (disposed || !WRITE_NAME_SET.has(execution.name))
            return undefined;
        const agent = execution.agent;
        return agent !== undefined && isRestricted(agent) ? SUBAGENT_WRITE_DENIAL_REASON : undefined;
    });
    const refresh = () => {
        if (disposed ||
            (ctx.fiber.state !== FIBER_STATE.ACTIVE && ctx.fiber.state !== FIBER_STATE.LOADING))
            return;
        const deny = denyNamesOf(registeredGlobalNames());
        const errors = [];
        for (const [agent, restriction] of active) {
            try {
                apply(restriction, deny);
            }
            catch (error) {
                diagnostics.sink.warn('subagent.restriction.failed', errorMessageOf(error), {
                    agent: agent.id,
                });
                errors.push(error);
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, 'zotero: subagent write restriction refresh failed');
        }
    };
    /**
     * `refresh()` must keep surfacing failures on the explicit config-commit path
     * (`reconcileWriteTools` calls it directly). The event listener contains each
     * failure instead, matching the harness `notifyChange()` listener discipline:
     * an emit from an unrelated tool registration must not fail that registration.
     */
    const onToolsChange = () => {
        try {
            refresh();
        }
        catch (error) {
            diagnostics.sink.warn('subagent.refresh.failed', errorMessageOf(error));
        }
    };
    // Also covers Scholarly mounting after existing children, and unloading it.
    ctx.on('tools/change', onToolsChange);
    for (const agent of agentRegistry()?.list() ?? [])
        track(agent);
    return {
        refresh(next) {
            writeEnabled = next;
            refresh();
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            const errors = [];
            try {
                guardDispose();
            }
            catch (error) {
                errors.push(error);
            }
            const restrictions = [...active.values()];
            active.clear();
            for (const restriction of restrictions) {
                try {
                    release(restriction);
                }
                catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length > 0) {
                throw new AggregateError(errors, 'zotero: subagent write restriction teardown failed');
            }
        },
    };
}
//# sourceMappingURL=subagent-guard.js.map