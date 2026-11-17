/** Fulltext windows preserve Unicode pairs, precise offsets and explicit empty-source facts. */
import { expect, it } from 'vitest'
import { fulltextWindowOf } from '../../src/local/retrieve-fulltext.js'
import { truncateText } from '../../src/normalize-context.js'

function document(text: string) {
  return {
    text,
    textFormat: 'text' as const,
    sourceKind: 'attachment' as const,
    sourceLabel: 'attachment',
  }
}
it.each([1, 2, 3])('preserves complete surrogate pairs with a %i-unit requested window', (size) => {
  const source = document('a😀b𠀀c')
  let start = 0,
    joined = ''
  do {
    const { read } = fulltextWindowOf(source, start, size, 100)
    expect(read.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
    expect(read.end).toBeGreaterThan(start)
    joined += read.text
    if (!read.isTruncated) break
    start = read.nextStart!
  } while (start < source.text.length)
  expect(joined).toBe(source.text)
})
it('rejects a caller offset inside a surrogate pair or beyond the document', () => {
  expect(() => fulltextWindowOf(document('a😀b'), 2, 2, 100)).toThrow('surrogate pair')
  expect(() => fulltextWindowOf(document('a😀b'), 5, 2, 100)).toThrow('within the document')
})
it('cuts the input budget before an incomplete surrogate pair', () => {
  expect(truncateText('a😀b', 2)).toEqual({ text: 'a', truncated: true })
  expect(fulltextWindowOf(document('a😀b'), 0, 10, 2).read).toMatchObject({
    text: 'a',
    totalChars: 1,
    inputTruncated: true,
  })
})
it('distinguishes an empty source from an exhausted nonempty source through its total length', () => {
  expect(fulltextWindowOf(document(''), 0, 2, 100).read).toMatchObject({
    text: '',
    totalChars: 0,
    start: 0,
    end: 0,
    isTruncated: false,
  })
  expect(fulltextWindowOf(document('abc'), 3, 2, 100).read).toMatchObject({
    text: '',
    totalChars: 3,
    start: 3,
    end: 3,
    isTruncated: false,
  })
})
