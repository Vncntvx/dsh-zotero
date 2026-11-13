/**
 * MinerU's inline HTML becomes what the host renderer draws: superscripts and
 * subscripts as TeX, emphasis as Markdown, everything else as its own text.
 * Fenced code keeps its contents verbatim.
 * @module tests/client/parsed-markdown
 */

import { describe, expect, it } from 'vitest'
import { parsedDisplayMarkdown } from '../../src/client/parsed-markdown.ts'

describe('parsedDisplayMarkdown', () => {
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
      '![x](https://example.org/f.png)',
    )
  })

  it('leaves fenced code untouched', () => {
    const code = '```\n<span>a</span> <sup>b</sup>\n```'
    expect(parsedDisplayMarkdown(`before\n${code}\nafter <sup>c</sup>`)).toBe(
      `before\n${code}\nafter $^{\\text{c}}$`,
    )
  })
})
