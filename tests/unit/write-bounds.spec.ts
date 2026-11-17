/** Write payload bounds reject scalar and aggregate oversize before approval. */
import { expect, it } from 'vitest'
import { assertWritePayload } from '../../src/write-bounds.ts'

it('rejects an oversized scalar field', () => {
  expect(() => assertWritePayload({ title: '12345' }, 4)).toThrow(/character bound/)
})

it('rejects a payload whose aggregate UTF-8 body exceeds its byte cap', () => {
  expect(() => assertWritePayload(Array(32).fill('字'.repeat(16_000)), 16_384)).toThrow(
    /byte payload limit/,
  )
})

it('accepts bounded nested write values', () => {
  expect(() => assertWritePayload({ title: 'ok', tags: ['a', 'b'] }, 4)).not.toThrow()
})

it('refuses circular and excessive-depth requests before JSON serialization can fail', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(() => assertWritePayload(cyclic)).toThrow('circular reference')
  let nested: unknown = 'value'
  for (let depth = 0; depth < 66; depth++) nested = { child: nested }
  expect(() => assertWritePayload(nested)).toThrow('nesting limit')
})

it.each([1n, () => {}, Symbol('unsupported')])(
  'rejects unsupported non-JSON request values',
  (value) => {
    expect(() => assertWritePayload({ value })).toThrow('JSON values')
  },
)

it('accepts JSON primitives and optional values without losing surrogate pairs', () => {
  expect(() =>
    assertWritePayload({
      missing: undefined,
      values: [null, true, 1, undefined],
      body: 'x'.repeat(4095) + '😀',
    }),
  ).not.toThrow()
})
