import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { ToolsService } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZOTERO_READ_TOOL_NAMES, ZOTERO_WRITE_TOOL_NAMES } from '../../src/constants.js'
import { SUBAGENT_WRITE_DENIAL_REASON } from '../../src/subagent-guard.js'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../helpers/approval-stub.js'
import { commitLive, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

interface HeaderPatch {
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
}

interface RegistryState {
  agents: Agent[]
  roots: Agent[]
}

interface ScopedFixture {
  readonly agent: Agent
  readonly scope: Scope
}

/** One booted lane plus the fixture factory every case shares. */
interface LaneFixture {
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

function headerOf(id: string, patch: HeaderPatch = {}): SessionHeader {
  return { version: 4, id: SessionId(id), createdAt: 0, isSeeded: false, ...patch }
}

/**
 * Mint one agent from a context carrying the loop's inject set. `createScope`
 * gives the scope the minting context's dependency API, and `ReactLoopAgent`
 * mints from a context that injects `tools`: that inheritance is what makes
 * `agent.ctx.tools.restrict()` resolvable. Minted from an uninjected context,
 * the scope throws `cannot get property "tools" without inject`.
 */
function mintFrom(base: Context): (id: string, patch?: HeaderPatch) => ScopedFixture {
  return (id, patch = {}) => {
    const agent = { id: SessionId(id), session: { header: headerOf(id, patch) } } as Agent
    const scope = createScope(base, agent)
    Object.defineProperty(agent, 'ctx', { value: scope.ctx, enumerable: true })
    return { agent, scope }
  }
}

function namesInView(setup: LaneFixture, agent: Agent): string[] {
  return setup.lane.ctx.tools.definitions(agent).map(({ name }) => name)
}

function expectWriteToolsHidden(setup: LaneFixture, agent: Agent): void {
  const names = namesInView(setup, agent)
  for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(names).not.toContain(name)
}

function expectWriteToolsVisible(setup: LaneFixture, agent: Agent): void {
  expect(namesInView(setup, agent)).toEqual(expect.arrayContaining([...ZOTERO_WRITE_TOOL_NAMES]))
}

function diagnosticEvents(setup: LaneFixture): string[] {
  const zotero = setup.lane.ctx.get('zotero')
  return zotero?.diagnostics.snapshot().entries.map(({ event }) => event) ?? []
}

/**
 * Boot a lane over the real tool runtime and a stub registry. `withRegistry:
 * false` leaves the registry unmounted, which is the "no `agents` service"
 * composition the guard has to tolerate.
 */
async function setupLaneWithAgents(
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

async function created(lane: HostLane, agent: Agent, source: 'startup' | 'resume' = 'startup') {
  await lane.ctx.serial('agent/created', { agent, source })
}

/** The lanes and scopes booted by the current case; the hook closes them all. */
const openLanes: HostLane[] = []
const scopes: Scope[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  resetApprovalStub()
  for (const scope of scopes.splice(0)) await scope.dispose()
  for (const lane of openLanes.splice(0)) {
    await lane.ctx.fiber.dispose()
    await lane.teardown()
  }
})

describe('Zotero subagent write guard', () => {
  it('keeps every registered write tool out of a child agent scope', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('child', { origin: 'subagent', delegationDepth: 1 })

    await created(setup.lane, child.agent)

    expect(namesInView(setup, child.agent)).toEqual(
      expect.arrayContaining([...ZOTERO_READ_TOOL_NAMES]),
    )
    expectWriteToolsHidden(setup, child.agent)
  })

  it("leaves a root agent's write tools visible", async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const root = setup.spawn('root')

    await created(setup.lane, root.agent)

    expectWriteToolsVisible(setup, root.agent)
  })

  it('restricts a resumed fork that the registry still lists as a root', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const fork = setup.spawn('fork', { delegationDepth: 2 })
    setup.registry.roots.push(fork.agent)

    await created(setup.lane, fork.agent, 'resume')

    expectWriteToolsHidden(setup, fork.agent)
  })

  it('restricts a subagent-origin session without a delegation depth', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('origin-child', { origin: 'subagent' })

    await created(setup.lane, child.agent)

    expectWriteToolsHidden(setup, child.agent)
  })

  it('restricts agents already present when the service mounts', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true }, [
      { id: 'seeded', patch: { origin: 'subagent', delegationDepth: 1 } },
    ])
    const seeded = setup.seeded[0]
    if (seeded === undefined) throw new Error('the seed was not created')

    expectWriteToolsHidden(setup, seeded.agent)
  })

  it('releases one child restriction without touching its sibling', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const first = setup.spawn('first', { origin: 'subagent', delegationDepth: 1 })
    const second = setup.spawn('second', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, first.agent)
    await created(setup.lane, second.agent)

    await setup.lane.ctx.emit('agent/disposed', { agent: first.agent })

    expectWriteToolsVisible(setup, first.agent)
    expectWriteToolsHidden(setup, second.agent)
  })

  it('retires a tracked child when its scope unwinds without agent/disposed', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('unwound', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)
    expectWriteToolsHidden(setup, child.agent)

    await child.scope.dispose()
    await commitLive(setup.lane, { writeEnabled: false })

    expect(diagnosticEvents(setup)).not.toContain('subagent.restriction.failed')
  })

  it('registers a restriction when write capability turns on', async () => {
    const setup = await setupLaneWithAgents()
    const child = setup.spawn('late-child', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)

    await commitLive(setup.lane, { writeEnabled: true })

    expect(setup.lane.ctx.tools.definitions().map(({ name }) => name)).toEqual(
      expect.arrayContaining([...ZOTERO_WRITE_TOOL_NAMES]),
    )
    expectWriteToolsHidden(setup, child.agent)
  })

  it('lifts the restriction when write capability turns off', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('toggle', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)

    await commitLive(setup.lane, { writeEnabled: false })

    expect(setup.lane.tool('zotero_create_note')).toBeUndefined()
    expect(diagnosticEvents(setup)).not.toContain('subagent.restriction.failed')
  })

  it('does not rebuild restrictions for a non-write transport change', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('steady', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)
    const restrict = vi.spyOn(ToolsService.prototype, 'restrict')

    await commitLive(setup.lane, { timeoutMs: 12_345 })

    expect(restrict).not.toHaveBeenCalled()
    expectWriteToolsHidden(setup, child.agent)
  })

  it('installs safely when no agent registry is mounted', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true }, [], { withRegistry: false })
    const child = setup.spawn('unregistered', { origin: 'subagent', delegationDepth: 1 })
    const restrict = vi.spyOn(ToolsService.prototype, 'restrict')

    await expect(created(setup.lane, child.agent)).resolves.toBeUndefined()
    expect(restrict).not.toHaveBeenCalled()
  })

  it('denies a write call from a tracked child even when the name is supplied', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('denied', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)

    const result = await setup.lane.runTool('zotero_create_note', { markdown: 'x' }, child.agent)

    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    // The exact reason, because the guard is the only layer that can refuse a
    // call the model reached by name, and the text is what tells it where the
    // write belongs instead.
    expect(result.error.message).toBe(SUBAGENT_WRITE_DENIAL_REASON)
    // Denied before dispatch: nothing reached the Local API.
    expect(setup.lane.mock.requests).toEqual([])
  })

  it('does not deny a write call from a root agent', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const root = setup.spawn('root-caller')
    await created(setup.lane, root.agent)

    const result = await setup.lane.runTool('zotero_create_note', { markdown: 'x' }, root.agent)

    // This lane scripts no write route, so the call fails inside the tool. What
    // the case asserts is that it got that far: the guard passed the root
    // through, and the request would have gone to the library.
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.message).not.toContain(SUBAGENT_WRITE_DENIAL_REASON)
    expect(setup.lane.mock.requests.length).toBeGreaterThan(0)
  })

  it('collects per-agent restriction failures and keeps applying the rest', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const first = setup.spawn('first-failure', { origin: 'subagent', delegationDepth: 1 })
    const second = setup.spawn('second-failure', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, first.agent)
    await created(setup.lane, second.agent)
    await commitLive(setup.lane, { writeEnabled: false })
    vi.spyOn(ToolsService.prototype, 'restrict').mockImplementationOnce(() => {
      throw new Error('injected restriction failure')
    })

    await commitLive(setup.lane, { writeEnabled: true })

    expectWriteToolsHidden(setup, second.agent)
    const events = diagnosticEvents(setup)
    expect(events).toContain('subagent.restriction.failed')
    expect(events).toContain('config.apply.failed')
  })

  it('releases every restriction when the service fiber is disposed', async () => {
    const setup = await setupLaneWithAgents()
    const child = setup.spawn('teardown', { origin: 'subagent', delegationDepth: 1 })
    await created(setup.lane, child.agent)

    const releases: string[] = []
    const original = ToolsService.prototype.restrict
    vi.spyOn(ToolsService.prototype, 'restrict').mockImplementation(function (
      this: ToolsService,
      filter,
    ) {
      const dispose = original.call(this, filter)
      return () => {
        releases.push('released')
        dispose()
      }
    })
    await commitLive(setup.lane, { writeEnabled: true })
    expect(releases).toHaveLength(0)

    await setup.lane.zoteroFiber.dispose()

    expect(releases).toHaveLength(1)
  })

  it('does not restrict when write capability is off at mount', async () => {
    const setup = await setupLaneWithAgents()
    const child = setup.spawn('off', { origin: 'subagent', delegationDepth: 1 })
    const restrict = vi.spyOn(ToolsService.prototype, 'restrict')

    await created(setup.lane, child.agent)

    expect(restrict).not.toHaveBeenCalled()
    expect(setup.lane.tool('zotero_create_note')).toBeUndefined()
  })
})
