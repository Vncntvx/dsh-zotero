/**
 * The band probes every prompt-placement spec needs.
 *
 * A section's place in the assembled prompt is observed through its position
 * relative to two probe sections registered at the band's own edges
 * (`TOOL_REPORT` and the ceiling). Both specs that read a position use these
 * probes, so they prove it against the same edges.
 * @module tests/helpers/prompt-band
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PromptSectionOrderName } from '@deepseek-ai/dsh-system-prompt'

/** One assembled prompt section, as the specs read it. */
interface AssembledSection {
  readonly name: string
}

/** The assembly the probes are observed in. */
interface AssembledPrompt {
  readonly sections: readonly AssembledSection[]
}

/**
 * Register the two band probes, hand the assembled prompt to `observe`, and
 * release the probes afterwards.
 * @param ctx - the plugin context whose system prompt carries the probes.
 * @param ceiling - the band ceiling the upper probe sits at.
 * @param observe - what to assert about the assembled prompt.
 * @returns whatever `observe` returns.
 */
export async function withBandProbes<T>(
  ctx: Context,
  ceiling: PromptSectionOrderName,
  observe: (assembly: AssembledPrompt) => T,
): Promise<T> {
  const probes = [
    ctx.systemPrompt.section({
      name: 'test:band-floor',
      order: ctx.systemPrompt.getSectionOrder('TOOL_REPORT'),
      text: '',
    }),
    ctx.systemPrompt.section({
      name: 'test:band-ceiling',
      order: ctx.systemPrompt.getSectionOrder(ceiling),
      text: '',
    }),
  ]
  try {
    return observe(await ctx.systemPrompt.assemble())
  } finally {
    for (const dispose of probes) dispose()
  }
}

/**
 * The position of one section in the assembled prompt.
 * @param assembly - the assembled prompt.
 * @param name - the section's name.
 * @returns its index, or -1 when the assembly carries no such section.
 */
export function sectionPosition(assembly: AssembledPrompt, name: string): number {
  return assembly.sections.findIndex((entry) => entry.name === name)
}
