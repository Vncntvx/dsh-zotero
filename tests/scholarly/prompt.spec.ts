/**
 * The scholarly component's own prompt section.
 *
 * The section is part of the component's capability: it appears while the
 * component is mounted, it routes the seven tools, and it carries the honesty
 * rule the source layer depends on (an unanswered index is not a negative
 * answer). The parent component's policy stays silent about these tools,
 * because it cannot know whether they exist; that fact is pinned in the host
 * lane (`tests/host/lifecycle.spec.ts`).
 * @module tests/scholarly/prompt
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ScholarlyService from '../../src/scholarly/index.js'
import {
  SCHOLARLY_PROMPT_ORDER_OFFSET,
  SCHOLARLY_PROMPT_SECTION_NAME,
  SCHOLARLY_SAVE_SENTENCE,
  SCHOLARLY_TOOL_ROUTING,
  SCHOLARLY_UNANSWERED_SENTENCE,
  SCHOLARLY_UNTRUSTED_SENTENCE,
} from '../../src/scholarly/prompt.js'
import { PROMPT_BAND_CEILING } from '../../src/prompt-band.js'
import { bootScholarlyContext } from './fixtures.js'
import { sectionPosition, withBandProbes } from '../helpers/prompt-band.js'

describe('the scholarly component prompt section', () => {
  it('appears only while the component is mounted', async () => {
    const withoutComponent = new Context()
    await withoutComponent.plugin(SystemPrompt, {})
    const bare = await withoutComponent.systemPrompt.assemble()
    expect(bare.sections.some((entry) => entry.name === SCHOLARLY_PROMPT_SECTION_NAME)).toBe(false)

    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === SCHOLARLY_PROMPT_SECTION_NAME)).toBe(
      true,
    )
  })

  it('routes the seven tools and states the honesty rules', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === SCHOLARLY_PROMPT_SECTION_NAME)
    expect(section).toBeDefined()

    // The routing sentence is one exported constant, so a wording change
    // shows up here.
    expect(section!.text).toContain(SCHOLARLY_TOOL_ROUTING)
    expect(section!.text).toContain(SCHOLARLY_UNANSWERED_SENTENCE)
    expect(section!.text).toContain(SCHOLARLY_UNTRUSTED_SENTENCE)
    expect(section!.text).toContain(SCHOLARLY_SAVE_SENTENCE)
  })

  it('states the live tool caps the model must stay within', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === SCHOLARLY_PROMPT_SECTION_NAME)

    expect(section!.text).toContain('at most 20 papers per search')
    expect(section!.text).toContain('at most 20 citation records')
    expect(section!.text).toContain('at most 12000 characters')
    // The tools clamp: a request above the cap is reduced to it, and a chunk
    // that stops early reports where to continue.
    expect(section!.text).toContain('reduced to it')
    expect(section!.text).toContain('is_truncated with next_start')
    expect(section!.text).not.toContain('Exceeding a cap errors')
  })

  it('assembles strictly inside the first-party band', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    await withBandProbes(ctx, PROMPT_BAND_CEILING, (assembly) => {
      expect(sectionPosition(assembly, SCHOLARLY_PROMPT_SECTION_NAME)).toBeGreaterThan(
        sectionPosition(assembly, 'test:band-floor'),
      )
      expect(sectionPosition(assembly, SCHOLARLY_PROMPT_SECTION_NAME)).toBeLessThan(
        sectionPosition(assembly, 'test:band-ceiling'),
      )
      expect(SCHOLARLY_PROMPT_ORDER_OFFSET).toBe(40)
    })
  })
})
