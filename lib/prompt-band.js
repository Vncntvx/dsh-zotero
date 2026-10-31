/**
 * The first-party prompt band both policy sections place themselves in.
 *
 * The band belongs to the harness: it names the placements a repository
 * section may sit between. Both of this package's policy sections derive their
 * placement from the same ceiling, so a first-party section inserted inside
 * the band pushes both along.
 *
 * The module is dependency-free on purpose: the scholarly component imports it
 * without dragging the parent component's config and constants into its own
 * bundle.
 *
 * @module dsh-zotero/prompt-band
 */
/** The band ceiling: the placement just above the first-party tool guidance. */
export const PROMPT_BAND_CEILING = 'TOOL_COMPUTER_USE';
/** The band floor: the tail of the first-party tool-guidance band. */
export const PROMPT_BAND_FLOOR = 'TOOL_REPORT';
/**
 * The numeric order of a section placed `offset` below the band ceiling.
 *
 * The order derives from the upper bound, not from the floor: anchoring on the
 * last band placement would run off the end of the band as soon as the
 * harness adds one more `TOOL_*` name.
 * @param ctx - the plugin context.
 * @param offset - how far below the ceiling the section sits.
 * @returns the section's sort order.
 */
export function bandSectionOrder(ctx, offset) {
    return ctx.systemPrompt.getSectionOrder(PROMPT_BAND_CEILING) - offset;
}
//# sourceMappingURL=prompt-band.js.map