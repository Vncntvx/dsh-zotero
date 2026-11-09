import SkillRegistry from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it } from 'vitest'
import { CORE_SOPS } from '../../src/skills/core.js'
import { EXTERNAL_AUTHORIZATION_RULE } from '../../src/skills/definition.js'
import { SCHOLARLY_SOPS } from '../../src/skills/scholarly.js'
import ScholarlyService from '../../src/scholarly/service.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

describe('core research skills', () => {
  it('keeps the Scholarly catalog when core is removed and removes it with its component', async () => {
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          await ctx.plugin(SkillRegistry, {})
        },
      },
    )
    const scholarly = lane.ctx.plugin(ScholarlyService, {})
    await scholarly
    expect(await lane.ctx.skills.list()).toHaveLength(CORE_SOPS.length + SCHOLARLY_SOPS.length)
    await lane.zoteroFiber.dispose()
    expect(await lane.ctx.skills.list()).toHaveLength(SCHOLARLY_SOPS.length)
    await scholarly.dispose()
    expect(await lane.ctx.skills.list()).toEqual([])
  })
  it('registers only core summaries and loads complete instructions on demand', async () => {
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          await ctx.plugin(SkillRegistry, {})
        },
      },
    )
    const catalog = await lane.ctx.skills.list()
    expect(catalog.map(({ name }) => name).sort()).toEqual(CORE_SOPS.map(({ name }) => name).sort())
    for (const summary of catalog) {
      expect(summary.description.length).toBeLessThan(300)
      expect(summary.invocation).toEqual({ modelInvocable: true, userInvocable: false })
      expect(summary).not.toHaveProperty('content')
      const loaded = await lane.ctx.skills.get(summary.name)
      expect(loaded?.content).toContain('## Phase 1:')
      expect(loaded?.content).toContain('## Failure modes and termination')
      expect(loaded?.metadata?.component).toBe('core')
    }
    expect(lane.mock.requests).toEqual([])
  })

  it('keeps SOP bodies out of the system prompt', async () => {
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          await ctx.plugin(SkillRegistry, {})
        },
      },
    )
    const assembly = await lane.ctx.systemPrompt.assemble()
    for (const section of assembly.sections) {
      expect(section.text).not.toContain('## Execution contract')
      expect(section.text).not.toContain('## Phase 1:')
    }
  })

  it('withdraws every skill with the Zotero service fiber', async () => {
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          await ctx.plugin(SkillRegistry, {})
        },
      },
    )
    await lane.zoteroFiber.dispose()
    expect(await lane.ctx.skills.list()).toEqual([])
    expect(await lane.ctx.skills.get('zotero-evidence-synthesis')).toBeUndefined()
  })

  it('supports a missing registry and registers when it arrives later', async () => {
    lane = await setupHostLane()
    expect(lane.ctx.get('zotero')).toBeDefined()
    expect(lane.ctx.get('skills')).toBeUndefined()
    await lane.ctx.plugin(SkillRegistry, {})
    expect(await lane.ctx.skills.list()).toHaveLength(CORE_SOPS.length)
  })

  it('rebinds cleanly when the registry is replaced', async () => {
    lane = await setupHostLane()
    const first = lane.ctx.plugin(SkillRegistry, {})
    await first
    expect(await lane.ctx.skills.list()).toHaveLength(CORE_SOPS.length)
    await first.dispose()
    await lane.ctx.plugin(SkillRegistry, {})
    expect(await lane.ctx.skills.list()).toHaveLength(CORE_SOPS.length)
  })

  it('exposes only core SOPs and pins conditional external recipes without Scholarly', async () => {
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          await ctx.plugin(SkillRegistry, {})
        },
      },
    )
    const names = (await lane.ctx.skills.list()).map(({ name }) => name).sort()
    expect(names).toEqual(CORE_SOPS.map(({ name }) => name).sort())
    for (const { name } of SCHOLARLY_SOPS) expect(await lane.ctx.skills.get(name)).toBeUndefined()
    expect(lane.ctx.tools.get('scholarly_save_to_zotero')).toBeUndefined()
    for (const sop of CORE_SOPS) {
      const loaded = await lane.ctx.skills.get(sop.name)
      expect(loaded?.content).toContain(EXTERNAL_AUTHORIZATION_RULE)
    }
  })
})
