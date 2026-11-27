import { expect, it } from 'vitest'
import { isCharacterBoundary, textPrefix } from '../../../src/client/reader/text-boundary.ts'

it('accepts boundaries around complete code points and rejects a split surrogate pair', () => {
  const text = 'a😀b'
  expect(isCharacterBoundary(text, 0)).toBe(true)
  expect(isCharacterBoundary(text, 1)).toBe(true)
  expect(isCharacterBoundary(text, 2)).toBe(false)
  expect(isCharacterBoundary(text, 3)).toBe(true)
  expect(isCharacterBoundary(text, 4)).toBe(true)
})

it('drops a trailing high surrogate and leaves other prefixes intact', () => {
  const text = 'ax😀'
  expect(textPrefix(text, 3)).toBe('ax')
  expect(textPrefix(text, 4)).toBe('ax😀')
  expect(textPrefix(text, 2)).toBe('ax')
  expect(textPrefix(text, 0)).toBe('')
  expect(textPrefix(text, 99)).toBe(text)
})
