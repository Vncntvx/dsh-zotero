/**
 * MinerU's inline HTML becomes what the host renderer draws: superscripts and
 * subscripts as TeX, emphasis as Markdown, everything else as its own text.
 * Fenced code keeps its contents verbatim.
 * @module tests/client/parsed-markdown
 */

import { describe, expect, it } from 'vitest'
import { parsedDisplayMarkdown } from '../../src/client/parsed-markdown.ts'

describe('parsedDisplayMarkdown', () => {
  it('keeps credential-bearing remote destinations inert and preserves an empty remote image label', () => {
    expect(parsedDisplayMarkdown('![secret](https://user:password@example.org/a.png)')).toBe(
      'secret',
    )
    expect(parsedDisplayMarkdown('![](https://example.org/a.png)')).toBe(
      '[https://example.org/a.png](<https://example.org/a.png>)',
    )
    expect(parsedDisplayMarkdown('![unknown][missing]')).toBe('![unknown][missing]')
  })
  it('turns affiliation superscripts into TeX text', () => {
    expect(parsedDisplayMarkdown('Weilan Suo <sup>a,*</sup>, Lin Wang <sup>b</sup>')).toBe(
      'Weilan Suo $^{\\text{a,*}}$, Lin Wang $^{\\text{b}}$',
    )
  })

  it('escapes characters that would end the TeX group', () => {
    expect(parsedDisplayMarkdown('<sub>x_1 {y}</sub>')).toBe('$_{\\text{x\\_1 \\{y\\}}}$')
  })

  it('keeps emphasis as Markdown and nested tags resolve', () => {
    expect(parsedDisplayMarkdown('<b>bold</b> and <i>italics</i>')).toBe('**bold** and *italics*')
    expect(parsedDisplayMarkdown('<sup><i>a</i></sup>')).toBe('$^{\\text{*a*}}$')
  })

  it('breaks lines at <br> and drops comments', () => {
    expect(parsedDisplayMarkdown('one<br/>two<!-- page 3 -->')).toBe('one  \ntwo')
  })

  it('keeps the text of tags it cannot express', () => {
    expect(parsedDisplayMarkdown('<div>Section</div> <span>kept</span>')).toBe('Section kept')
  })

  it('keeps figure destinations for the reader to resolve', () => {
    // The reader fetches the artifact's own figures and leaves the authored
    // caption when one is missing; the projection never guesses on its own.
    expect(parsedDisplayMarkdown('![Figure 1](images/f1.png)')).toBe('![Figure 1](images/f1.png)')
    expect(parsedDisplayMarkdown('![](images/f2.png)')).toBe('![](images/f2.png)')
    expect(parsedDisplayMarkdown('![x](https://example.org/f.png)')).toBe(
      '[x](<https://example.org/f.png>)',
    )
  })

  it('turns direct and reference images into explicit links without changing code or local figures', () => {
    const source =
      '![remote][tracking]\n\n[tracking]: https://example.org/t.png\n\n![local](images/f.png)\n\n`![code](https://example.org/code)`'
    const display = parsedDisplayMarkdown(source)
    expect(display).toContain('[remote](<https://example.org/t.png>)')
    expect(display).toContain('![local](images/f.png)')
    expect(display).toContain('`![code](https://example.org/code)`')
    expect(parsedDisplayMarkdown('![private](http://127.0.0.1:23119/api/items)')).toBe(
      '[private](<http://127.0.0.1:23119/api/items>)',
    )
  })

  it('leaves fenced code untouched', () => {
    const code = '```\n<span>a</span> <sup>b</sup>\n```'
    expect(parsedDisplayMarkdown(`before\n${code}\nafter <sup>c</sup>`)).toBe(
      `before\n${code}\nafter $^{\\text{c}}$`,
    )
  })
})
