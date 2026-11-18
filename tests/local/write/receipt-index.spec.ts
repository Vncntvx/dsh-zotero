import { expect, it } from 'vitest'
import { isWriteReceiptIndex } from '../../../src/local/write-verdicts.js'

it.each(['-1', '00', '01', '1.0', '1e0', 'three', '2', '9007199254740993', ''])(
  'refuses index %j in a two-object receipt',
  (index) => {
    expect(isWriteReceiptIndex(index, 2)).toBe(false)
  },
)

it('bounds canonical indices to the submitted object count', () => {
  expect(isWriteReceiptIndex('0', 0)).toBe(false)
  expect(isWriteReceiptIndex('0', 2)).toBe(true)
  expect(isWriteReceiptIndex('1', 2)).toBe(true)
})
