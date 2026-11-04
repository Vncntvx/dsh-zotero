/** Scoped tool view and restriction lifecycle for child agents. */
import { ToolsService } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  SCHOLARLY_SAVE_TOOL_NAME,
  ZOTERO_READ_TOOL_NAMES,
  ZOTERO_WRITE_TOOL_NAMES,
} from '../../src/constants.js'
import ScholarlyService from '../../src/scholarly/service.js'
import { SUBAGENT_WRITE_DENIAL_REASON } from '../../src/subagent-guard.js'
import { commitLive } from '../helpers/lanes/host-lane.js'
import {
  created,
  diagnosticEvents,
  expectWriteToolsHidden,
  expectWriteToolsVisible,
  namesInView,
  setupLaneWithAgents,
  useSubagentGuardLanes,
} from './support/subagent-guard.js'

useSubagentGuardLanes()

describe('Zotero subagent write view and lifecycle', () => {
  it('masks a late Scholarly save entry even with local writes disabled and follows remounts', async () => {
    const setup = await setupLaneWithAgents()
    const child = setup.spawn('scholarly-child', { origin: 'subagent' })
    const root = setup.spawn('scholarly-root')
    await created(setup.lane, child.agent)
    await created(setup.lane, root.agent)
    const scholarly = setup.lane.ctx.plugin(ScholarlyService, {})
    await scholarly
    expect(namesInView(setup, root.agent)).toContain(SCHOLARLY_SAVE_TOOL_NAME)
    expect(namesInView(setup, child.agent)).not.toContain(SCHOLARLY_SAVE_TOOL_NAME)
    expect(namesInView(setup, child.agent)).toContain('scholarly_search')
    const result = await setup.lane.runTool(
      SCHOLARLY_SAVE_TOOL_NAME,
      { title: 'Never saved' },
      child.agent,
    )
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.message).toBe(SUBAGENT_WRITE_DENIAL_REASON)
    expect(setup.lane.mock.requests).toEqual([])
    await scholarly.dispose()
    expect(namesInView(setup, root.agent)).not.toContain(SCHOLARLY_SAVE_TOOL_NAME)
    await setup.lane.ctx.plugin(ScholarlyService, {})
    expect(namesInView(setup, child.agent)).not.toContain(SCHOLARLY_SAVE_TOOL_NAME)
    expect(namesInView(setup, root.agent)).toContain(SCHOLARLY_SAVE_TOOL_NAME)
  })

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
