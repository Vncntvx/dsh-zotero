/** Execution-time denial of child write calls, independent of listener order. */
import { ToolsService } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { LIBRARY_WRITE_TOOL_NAMES } from '../../src/constants.js'
import ScholarlyService from '../../src/scholarly/service.js'
import { SUBAGENT_WRITE_DENIAL_REASON } from '../../src/subagent-guard.js'
import { commitLive } from '../helpers/lanes/host-lane.js'
import {
  created,
  diagnosticEvents,
  expectWriteToolsHidden,
  setupLaneWithAgents,
  useSubagentGuardLanes,
} from './support/subagent-guard.js'

useSubagentGuardLanes()

describe('Zotero subagent write guard', () => {
  it.each(LIBRARY_WRITE_TOOL_NAMES)(
    'refuses an out-of-band child call to %s before dispatch',
    async (name) => {
      const setup = await setupLaneWithAgents({ writeEnabled: true })
      await setup.lane.ctx.plugin(ScholarlyService, {})
      const child = setup.spawn('all-write-paths', { delegationDepth: 1 })
      await created(setup.lane, child.agent)
      const result = await setup.lane.runTool(name, {}, child.agent)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect(result.error.message).toBe(SUBAGENT_WRITE_DENIAL_REASON)
      expect(setup.lane.mock.requests).toEqual([])
    },
  )

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

  it('contains a tools/change refresh failure so an emit cannot escape', async () => {
    const setup = await setupLaneWithAgents({ writeEnabled: true })
    const child = setup.spawn('emit-failure', { origin: 'subagent' })
    await created(setup.lane, child.agent)
    vi.spyOn(ToolsService.prototype, 'restrict').mockImplementation(() => {
      throw new Error('injected restriction failure')
    })

    // Mounting Scholarly registers scholarly_save_to_zotero, which emits
    // tools/change. The failed restriction must be contained by the listener
    // instead of failing the unrelated tool registration.
    await setup.lane.ctx.plugin(ScholarlyService, {})
    // The failed apply rolled back restriction.names, so a further emit retries
    // and must stay contained.
    expect(() => setup.lane.ctx.emit('tools/change')).not.toThrow()

    const events = diagnosticEvents(setup)
    expect(events).toContain('subagent.restriction.failed')
    expect(events).toContain('subagent.refresh.failed')
  })
})
