/** Write payload bounds reject scalar and aggregate oversize before approval. */
import { expect, it } from 'vitest'
import { assertWritePayload } from '../../src/tools/write-bounds.ts'

it('rejects an oversized scalar field', () => {
  expect(() => assertWritePayload({ title: '12345' }, 4)).toThrow(/character bound/)
})

it('rejects a payload whose aggregate UTF-8 body exceeds its byte cap', () => {
  expect(() => assertWritePayload({ title: '12345' }, 10, 4)).toThrow(/byte payload limit/)
})

it('accepts bounded nested write values', () => {
  expect(() => assertWritePayload({ title: 'ok', tags: ['a', 'b'] }, 4, 100)).not.toThrow()
})
