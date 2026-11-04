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
import { ZOTERO_WRITE_TOOL_NAMES } from './constants.js'
import type { DiagnosticsRecorder } from './diagnostics.js'

/** The model-facing denial. One constant, so a wording change edits one place. */
export const SUBAGENT_WRITE_DENIAL_REASON =
  'Zotero write tools are reserved for the root agent. A subagent cannot modify the personal library; return the intended change to the calling agent instead.'

const WRITE_NAME_SET: ReadonlySet<string> = new Set(ZOTERO_WRITE_TOOL_NAMES)

interface ActiveRestriction {
  readonly ctx: Context
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
    const header = agent.session.header
    return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
  }

  const apply = (restriction: ActiveRestriction): void => {
    restriction.dispose = restriction.ctx.tools.restrict({ deny: ZOTERO_WRITE_TOOL_NAMES })
  }

  const release = (restriction: ActiveRestriction): void => {
    const dispose = restriction.dispose
    restriction.dispose = undefined
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

    const restriction: ActiveRestriction = { ctx: agent.ctx }
    // A custom registry may omit `agent/disposed`; the agent's own scope
    // unwind still retires the map entry, and the restriction unwinds with it.
    agent.ctx.effect(() => () => retire(agent), 'zotero: subagent guard retire')
    active.set(agent, restriction)
    if (writeEnabled) apply(restriction)
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
    if (!writeEnabled || !WRITE_NAME_SET.has(execution.name)) return undefined
    const agent = execution.agent
    return agent !== undefined && active.has(agent) ? SUBAGENT_WRITE_DENIAL_REASON : undefined
  })

  for (const agent of agentRegistry()?.list() ?? []) track(agent)

  return {
    refresh(next) {
      if (disposed || next === writeEnabled) return
      // Set the intent first: the execution guard must deny even if a
      // per-agent view restriction below cannot be registered.
      writeEnabled = next
      const errors: unknown[] = []
      for (const [agent, restriction] of active) {
        try {
          if (next) {
            if (restriction.dispose === undefined) apply(restriction)
          } else {
            release(restriction)
          }
        } catch (error) {
          diagnostics.sink.warn('subagent.restriction.failed', messageOf(error), {
            agent: agent.id,
          })
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'zotero: subagent write restriction refresh failed')
      }
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
