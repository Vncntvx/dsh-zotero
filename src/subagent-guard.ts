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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { LIBRARY_WRITE_TOOL_NAMES, SCHOLARLY_SAVE_TOOL_NAME } from './constants.js'
import type { DiagnosticsRecorder } from './diagnostics.js'
import { FIBER_STATE } from './fiber-state.js'

/** The model-facing denial. One constant, so a wording change edits one place. */
export const SUBAGENT_WRITE_DENIAL_REASON =
  'Zotero write tools are reserved for the root agent. A subagent cannot modify the personal library; return the intended change to the calling agent instead.'

const WRITE_NAME_SET: ReadonlySet<string> = new Set(LIBRARY_WRITE_TOOL_NAMES)

interface ActiveRestriction {
  readonly ctx: Context
  names: string
  dispose?: () => void
}

/** The lifecycle operations ZoteroService needs when its write surface changes. */
export interface SubagentGuard {
  /** Apply the current write-capability state to every tracked child. */
  refresh(writeEnabled: boolean): void
  /** Lift every per-agent restriction owned by this guard. */
  dispose(): void
}

/**
 * Track live child agents and keep Zotero's write surface out of their view.
 * @param ctx - the Zotero service context.
 * @param diagnostics - the service's diagnostics recorder.
 * @returns refresh and teardown operations owned by ZoteroService.
 */
export function createSubagentGuard(ctx: Context, diagnostics: DiagnosticsRecorder): SubagentGuard {
  const active = new Map<Agent, ActiveRestriction>()
  let registry: AgentRegistry | undefined
  let writeEnabled = false
  let disposed = false

  /** Resolve the registry lazily: a registry mounted after this service still counts. */
  const agentRegistry = (): AgentRegistry | undefined => (registry ??= ctx.get('agents', false))

  const isRestricted = (agent: Agent): boolean => {
    const header = agent.session?.header
    return header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0
  }

  /**
   * One `view()` rebuild per refresh instead of one per write name per agent:
   * `definitions()` resolves the same global `view().visible` that `get(name)`
   * reads, so the registered-name set is identical for every tracked child.
   */
  const registeredGlobalNames = (): ReadonlySet<string> =>
    new Set(ctx.tools.definitions().map(({ name }) => name))

  /** restrict() rejects unknown names; observe global registrations before masking. */
  const denyNamesOf = (registered: ReadonlySet<string>): readonly string[] =>
    LIBRARY_WRITE_TOOL_NAMES.filter(
      (name) => (writeEnabled || name === SCHOLARLY_SAVE_TOOL_NAME) && registered.has(name),
    )

  const apply = (restriction: ActiveRestriction, deny: readonly string[]): void => {
    const names = deny.join(',')
    if (names === restriction.names) return
    const previousNames = restriction.names
    // Set this before restrict/dispose emit tools/change, preventing recursion.
    restriction.names = names
    let dispose: (() => void) | undefined
    try {
      if (deny.length > 0) dispose = restriction.ctx.tools.restrict({ deny: [...deny] })
    } catch (error) {
      restriction.names = previousNames
      throw error
    }
    const previous = restriction.dispose
    restriction.dispose = dispose
    previous?.()
  }

  const release = (restriction: ActiveRestriction): void => {
    const dispose = restriction.dispose
    restriction.dispose = undefined
    restriction.names = ''
    dispose?.()
  }

  const retire = (agent: Agent): void => {
    const restriction = active.get(agent)
    if (restriction === undefined) return
    active.delete(agent)
    release(restriction)
  }

  const track = (agent: Agent): void => {
    if (disposed || active.has(agent) || !isRestricted(agent)) return
    if (agentRegistry() === undefined) return

    const restriction: ActiveRestriction = { ctx: agent.ctx, names: '' }
    // A custom registry may omit `agent/disposed`; the agent's own scope
    // unwind still retires the map entry, and the restriction unwinds with it.
    agent.ctx.effect(() => () => retire(agent), 'zotero: subagent guard retire')
    active.set(agent, restriction)
    apply(restriction, denyNamesOf(registeredGlobalNames()))
  }

  ctx.on('agent/created', ({ agent }) => {
    track(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    retire(agent)
  })

  // A denial that must hold regardless of listener order: the tool remains
  // callable by name, so the view-layer restriction alone cannot enforce it.
  ctx.tools.guard((execution: Readonly<ToolExecution>) => {
    if (disposed || !WRITE_NAME_SET.has(execution.name)) return undefined
    const agent = execution.agent
    return agent !== undefined && isRestricted(agent) ? SUBAGENT_WRITE_DENIAL_REASON : undefined
  })

  const refresh = (): void => {
    if (
      disposed ||
      (ctx.fiber.state !== FIBER_STATE.ACTIVE && ctx.fiber.state !== FIBER_STATE.LOADING)
    )
      return
    const deny = denyNamesOf(registeredGlobalNames())
    const errors: unknown[] = []
    for (const [agent, restriction] of active) {
      try {
        apply(restriction, deny)
      } catch (error) {
        diagnostics.sink.warn('subagent.restriction.failed', messageOf(error), { agent: agent.id })
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'zotero: subagent write restriction refresh failed')
    }
  }

  /**
   * `refresh()` must keep surfacing failures on the explicit config-commit path
   * (`reconcileWriteTools` calls it directly). The event listener contains each
   * failure instead, matching the harness `notifyChange()` listener discipline:
   * an emit from an unrelated tool registration must not fail that registration.
   */
  const onToolsChange = (): void => {
    try {
      refresh()
    } catch (error) {
      diagnostics.sink.warn('subagent.refresh.failed', messageOf(error))
    }
  }
  // Also covers Scholarly mounting after existing children, and unloading it.
  ctx.on('tools/change', onToolsChange)

  for (const agent of agentRegistry()?.list() ?? []) track(agent)

  return {
    refresh(next) {
      writeEnabled = next
      refresh()
    },
    dispose() {
      if (disposed) return
      disposed = true
      const restrictions = [...active.values()]
      active.clear()
      const errors: unknown[] = []
      for (const restriction of restrictions) {
        try {
          release(restriction)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'zotero: subagent write restriction teardown failed')
      }
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
