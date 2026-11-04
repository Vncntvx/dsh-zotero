/**
 * Shared lane fixture for the subagent write-guard specs.
 *
 * The two specs split by responsibility — the scoped tool view / lifecycle
 * (`subagent-view.spec.ts`) and the execution-time guard
 * (`subagent-guard.spec.ts`) — both need the same boot over the real tool
 * runtime and a stub agent registry. Module support owns that setup so neither
 * spec imports the other (`tests/README.md`).
 * @module tests/host/support/subagent-guard
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, expect, vi } from 'vitest'
import { ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.js'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../../helpers/approval-stub.js'
import { type HostLane, setupHostLane } from '../../helpers/lanes/host-lane.js'

export interface HeaderPatch {
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
}

export interface RegistryState {
  agents: Agent[]
  roots: Agent[]
}

export interface ScopedFixture {
  readonly agent: Agent
  readonly scope: Scope
}

/** One booted lane plus the fixture factory every case shares. */
export interface LaneFixture {
  readonly lane: HostLane
  readonly registry: RegistryState
  /** The agents seeded before the plugin mounted, in seed order. */
  readonly seeded: readonly ScopedFixture[]
  /**
   * Create one agent the way the registry would: mint its scope, register the
   * agent, and hand the scope to the module teardown.
   */
  spawn(id: string, patch?: HeaderPatch): ScopedFixture
}

export function headerOf(id: string, patch: HeaderPatch = {}): SessionHeader {
  return { version: 4, id: SessionId(id), createdAt: 0, isSeeded: false, ...patch }
}

/**
 * Mint one agent from a context carrying the loop's inject set. `createScope`
 * gives the scope the minting context's dependency API, and `ReactLoopAgent`
 * mints from a context that injects `tools`: that inheritance is what makes
 * `agent.ctx.tools.restrict()` resolvable. Minted from an uninjected context,
 * the scope throws `cannot get property "tools" without inject`.
 */
export function mintFrom(base: Context): (id: string, patch?: HeaderPatch) => ScopedFixture {
  return (id, patch = {}) => {
    const agent = { id: SessionId(id), session: { header: headerOf(id, patch) } } as Agent
    const scope = createScope(base, agent)
    Object.defineProperty(agent, 'ctx', { value: scope.ctx, enumerable: true })
    return { agent, scope }
  }
}

export function namesInView(setup: LaneFixture, agent: Agent): string[] {
  return setup.lane.ctx.tools.definitions(agent).map(({ name }) => name)
}

export function expectWriteToolsHidden(setup: LaneFixture, agent: Agent): void {
  const names = namesInView(setup, agent)
  for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(names).not.toContain(name)
}

export function expectWriteToolsVisible(setup: LaneFixture, agent: Agent): void {
  expect(namesInView(setup, agent)).toEqual(expect.arrayContaining([...ZOTERO_WRITE_TOOL_NAMES]))
}

export function diagnosticEvents(setup: LaneFixture): string[] {
  const zotero = setup.lane.ctx.get('zotero')
  return zotero?.diagnostics.snapshot().entries.map(({ event }) => event) ?? []
}

/** The lanes and scopes booted by the current case; the hook closes them all. */
const openLanes: HostLane[] = []
const scopes: Scope[] = []

/**
 * Boot a lane over the real tool runtime and a stub registry. `withRegistry:
 * false` leaves the registry unmounted, which is the "no `agents` service"
 * composition the guard has to tolerate.
 */
export async function setupLaneWithAgents(
  config: Parameters<typeof setupHostLane>[0] = {},
  seed: readonly { readonly id: string; readonly patch?: HeaderPatch }[] = [],
  options: { readonly withRegistry?: boolean } = {},
): Promise<LaneFixture> {
  const registry: RegistryState = { agents: [], roots: [] }
  const seeded: ScopedFixture[] = []
  let spawn: LaneFixture['spawn'] | undefined
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      // The write gate needs *both* confirmations before it runs anything: the
      // approval service and the plan review. Without them a write fails with
      // "the approval gate or plan-review could not be asked", which is a
      // different failure than the guard's denial.
      await ctx.plugin(StubApproval)
      await ctx.plugin(ApprovingQuestions)
      // The scope base stands in for the loop's context: same inject set, so a
      // scope minted from it resolves `.tools` exactly as a live agent does.
      let loopCtx: Context | undefined
      await ctx.plugin({
        name: 'loopScopeBase',
        inject: ['tools'],
        apply: (injected: Context) => {
          loopCtx = injected
        },
      })
      if (loopCtx === undefined) throw new Error('the injected context never ran')
      const mint = mintFrom(loopCtx)
      spawn = (id, patch = {}) => {
        const fixture = mint(id, patch)
        scopes.push(fixture.scope)
        if (options.withRegistry !== false) registry.agents.push(fixture.agent)
        return fixture
      }

      if (options.withRegistry !== false) {
        class StubAgentRegistry extends Service {
          constructor(registryCtx: Context) {
            super(registryCtx, 'agents')
          }

          list(): Agent[] {
            return registry.agents
          }

          roots(): Agent[] {
            return registry.roots
          }
        }

        await ctx.plugin(StubAgentRegistry)
      }
      for (const item of seed) seeded.push(spawn(item.id, item.patch))
    },
  })
  if (spawn === undefined) throw new Error('the compose step never minted a scope base')
  openLanes.push(lane)
  return { lane, registry, seeded, spawn }
}

export async function created(
  lane: HostLane,
  agent: Agent,
  source: 'startup' | 'resume' = 'startup',
): Promise<void> {
  await lane.ctx.serial('agent/created', { agent, source })
}

/** Install the shared teardown in each spec that uses this support module. */
export function useSubagentGuardLanes(): void {
  afterEach(async () => {
    vi.restoreAllMocks()
    resetApprovalStub()
    for (const scope of scopes.splice(0)) await scope.dispose()
    for (const lane of openLanes.splice(0)) {
      await lane.ctx.fiber.dispose()
      await lane.teardown()
    }
  })
}
