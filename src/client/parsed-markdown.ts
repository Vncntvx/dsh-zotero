/**
 * MinerU writes inline HTML into its Markdown — affiliation superscripts,
 * emphasis, and occasionally whole tables — while the host renderer
 * deliberately parses no HTML: raw tags would show as literal text. This
 * projection rewrites the inline subset a paper actually uses into the
 * Markdown/TeX the renderer understands, and drops the tags it cannot express,
 * keeping their text. Code fences pass through untouched.
 * @module dsh-zotero/client/parsed-markdown
 */

/** Escape the characters that would end a KaTeX `\text{}` group early. */
function texText(value: string): string {
  return value.replace(/[\\{}$%&#_]/gu, (character) => `\\${character}`)
}

/** The paired tags worth keeping as formatting; the rest lose only their tags. */
const REWRITES: readonly (readonly [RegExp, (match: string, inner: string) => string])[] = [
  [
    /<sup\b[^>]*>([^<]*)<\/sup\s*>/giu,
    (_match: string, inner: string) => `$^{\\text{${texText(inner)}}}$`,
  ],
  [
    /<sub\b[^>]*>([^<]*)<\/sub\s*>/giu,
    (_match: string, inner: string) => `$_{\\text{${texText(inner)}}}$`,
  ],
  [
    /<(?:b|strong)\b[^>]*>([^<]*)<\/(?:b|strong)\s*>/giu,
    (_match: string, inner: string) => `**${inner}**`,
  ],
  [/<(?:i|em)\b[^>]*>([^<]*)<\/(?:i|em)\s*>/giu, (_match: string, inner: string) => `*${inner}*`],
]

/** One block of prose, without code fences or their contents. */
function rewriteProse(source: string): string {
  let text = source.replace(/<!--[\s\S]*?-->/gu, '').replace(/<br\s*\/?>/giu, '  \n')
  // Nested inline tags resolve one level per pass; three passes cover the
  // depth a paper's affiliation markers reach.
  for (let pass = 0; pass < 3; pass++) {
    const next = REWRITES.reduce((value, [pattern, render]) => value.replace(pattern, render), text)
    if (next === text) break
    text = next
  }
  // Figures keep their authored destination: the reader resolves the ones the
  // artifact carries, and a miss leaves the alt text rather than a broken frame.
  return text.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/giu, '')
}

/**
 * Project one parsed artifact's Markdown onto what the host renderer draws.
 * @param markdown - the artifact text, as read from the store.
 * @returns the same document with inline HTML resolved and fences preserved.
 */
export function parsedDisplayMarkdown(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```)/gu)
    .map((chunk, index) => (index % 2 === 1 ? chunk : rewriteProse(chunk)))
    .join('')
}
