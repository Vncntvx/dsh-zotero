/**
 * The scholarly component's own prompt section.
 *
 * The section is part of the component's capability: it appears while the
 * component is mounted, it routes the seven tools, and it carries the honesty
 * rule the source layer depends on (an unanswered index is not a negative
 * answer). The parent component's policy describes no external retrieval
 * tool; it only classifies the save entry when that entry is on the step's
 * surface. That boundary is pinned in the host lane
 * (`tests/host/lifecycle.spec.ts`).
 * @module tests/scholarly/prompt
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import ScholarlyService from '../../src/scholarly/index.js'
import {
  SCHOLARLY_PROMPT_ORDER_OFFSET,
  SCHOLARLY_PROMPT_SECTION_NAME,
  SCHOLARLY_ROUTE_SENTENCE,
  SCHOLARLY_ROUTE_TAIL,
  SCHOLARLY_SAVE_SENTENCE,
  SCHOLARLY_TOOL_ROUTING,
  SCHOLARLY_UNANSWERED_SENTENCE,
  SCHOLARLY_UNTRUSTED_SENTENCE,
  scholarlyRoutingTextOf,
} from '../../src/scholarly/prompt.js'
import { PROMPT_BAND_CEILING } from '../../src/prompt-band.js'
import { bootScholarlyContext } from './fixtures.js'
import { admittedToolSet } from '../helpers/tool-set.js'
import { sectionPosition, withBandProbes } from '../helpers/prompt-band.js'

/** The step's admission over the context's registered definitions. */
function admitted(ctx: Context, agent: object, names: readonly string[]) {
  const definitions = names.map((name) => {
    const definition = ctx.tools.get(name)
    if (definition === undefined) throw new Error(`tool ${name} not registered`)
    return definition
  })
  return admittedToolSet(agent, definitions)
}

function sectionOf(assembly: PromptAssembly): string {
  return assembly.sections.find((entry) => entry.name === SCHOLARLY_PROMPT_SECTION_NAME)?.text ?? ''
}

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
    expect(section!.text).toContain(SCHOLARLY_ROUTE_SENTENCE)
    expect(section!.text).toContain('Generic web access remains available')
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

  it('omits the section when the step admits no scholarly tools', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const agent = {}
    const assembly = await ctx.systemPrompt.assemble({
      toolSet: admitted(ctx, agent, []),
      scope: agent,
    })

    expect(renderPrompt(assembly)).not.toContain('Scholarly tools:')
    expect(sectionOf(assembly)).toBe('')
  })

  it('keeps admitted scholarly routes, the web_fetch ban, and their guidance', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const agent = {}
    const assembly = await ctx.systemPrompt.assemble({
      toolSet: admitted(ctx, agent, ['scholarly_search']),
      scope: agent,
    })
    const text = sectionOf(assembly)

    expect(text).toContain('scholarly_search finds papers')
    expect(text).toContain('at most 20 papers per search')
    expect(text).toContain(SCHOLARLY_UNANSWERED_SENTENCE)
    // The ban follows every external scholarly tool, not only get/cite/verify.
    expect(text).toContain(SCHOLARLY_ROUTE_TAIL)
    expect(text).not.toContain('scholarly_get')
    expect(text).not.toContain(SCHOLARLY_SAVE_SENTENCE)
  })

  it('keeps the web_fetch ban and the citations cap for a citations-only step', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const agent = {}
    const assembly = await ctx.systemPrompt.assemble({
      toolSet: admitted(ctx, agent, ['scholarly_citations']),
      scope: agent,
    })
    const text = sectionOf(assembly)

    expect(text).toContain('scholarly_citations follows citations')
    expect(text).toContain('at most 20 citation records')
    expect(text).toContain(SCHOLARLY_ROUTE_TAIL)
    expect(text).not.toContain('scholarly_search')
  })

  it('keeps the save guard and one routing sentence when only saving is admitted', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const agent = {}
    const assembly = await ctx.systemPrompt.assemble({
      toolSet: admitted(ctx, agent, ['scholarly_save_to_zotero']),
      scope: agent,
    })
    const text = sectionOf(assembly)

    expect(text).toContain(
      'Scholarly tools: scholarly_save_to_zotero saves a result to local Zotero. scholarly_save_to_zotero writes to the local library through the Zotero write policy.',
    )
    expect(text.match(/scholarly_save_to_zotero/g)).toHaveLength(2)
    expect(text).not.toContain('..')
    expect(text).toContain(SCHOLARLY_SAVE_SENTENCE)
    expect(text).not.toContain('scholarly_search returns')
    expect(text).not.toContain(SCHOLARLY_ROUTE_SENTENCE)
    expect(text).not.toContain(SCHOLARLY_ROUTE_TAIL)
  })

  it('returns no routing sentence for an empty admission', () => {
    expect(scholarlyRoutingTextOf([], false)).toBe('')
  })

  it('keeps the full section when the assembly names no scope', async () => {
    const ctx = await bootScholarlyContext()
    await ctx.plugin(ScholarlyService, {})
    const full = await ctx.systemPrompt.assemble()
    const agent = {}
    // A set captured for one agent reads as empty for every other scope, so an
    // assembly that names no scope must not be mistaken for an empty step.
    const noScope = await ctx.systemPrompt.assemble({
      toolSet: admitted(ctx, agent, ['scholarly_search']),
    })

    expect(sectionOf(noScope)).toBe(sectionOf(full))
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
