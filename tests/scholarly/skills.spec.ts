import type { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it } from 'vitest'
import ScholarlyService from '../../src/scholarly/service.js'
import { SCHOLARLY_SOPS } from '../../src/skills/scholarly.js'
import { bootScholarlyContext } from './fixtures.js'

let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('Scholarly research skills', () => {
  it('registers exactly the external SOPs only while the authorized component exists', async () => {
    ctx = await bootScholarlyContext()
    await ctx.plugin(SkillRegistry, {})
    expect(await ctx.skills.list()).toEqual([])
    const scholarly = ctx.plugin(ScholarlyService, {})
    await scholarly
    expect((await ctx.skills.list()).map(({ name }) => name).sort()).toEqual(
      SCHOLARLY_SOPS.map(({ name }) => name).sort(),
    )
    for (const sop of SCHOLARLY_SOPS) {
      expect((await ctx.skills.get(sop.name))?.metadata?.component).toBe('scholarly')
    }
    await scholarly.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(await ctx.skills.get('zotero-literature-intake')).toBeUndefined()
  })
})
