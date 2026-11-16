/** Parsed titles come from real Markdown headings, never code examples. */
import { describe, expect, it } from 'vitest'
import { extractMarkdownTitleOf } from '../../src/parsed-title.js'

describe('parsed document title', () => {
  it.each([
    '```sh\n# fake\n```',
    '~~~~markdown\n# fake\n~~~~',
    '    # fake',
    '\t# fake',
    '````md\n```\n# fake\n````',
  ])('ignores code before the title: %s', (prefix) => {
    expect(extractMarkdownTitleOf(`${prefix}\n# **Real** \`title\` ###\nBody`)).toBe('Real title')
  })
  it('does not invent a title for an unclosed code fence', () => {
    expect(extractMarkdownTitleOf('```\n# fake')).toBeUndefined()
  })
  it('does not treat a backtick inside a fence info string as a code opener', () => {
    expect(extractMarkdownTitleOf('```bad`info\n# Real title')).toBe('Real title')
  })
  it('keeps an empty H1 unnamed', () => {
    expect(extractMarkdownTitleOf('#   \nBody')).toBeUndefined()
  })
})
