/**
 * The inline branch's one-pass encoder contract: `inlineJson` must reproduce
 * exactly the text `JSON.stringify` used to produce, count the same bytes, and
 * keep the early-exit and cancellation behaviour the previous two-pass code
 * had. Buffering chunks through a streaming decoder is what makes the single
 * pass safe across UTF-8 boundaries.
 * @module tests/host/result-delivery-inline-json
 */

import { describe, expect, it } from 'vitest'
import { inlineJson } from '../../src/result-delivery.ts'

const UNBOUNDED = Number.MAX_SAFE_INTEGER

async function encoded(value: unknown): Promise<{ bytes: number; canonical: string }> {
  const result = await inlineJson(value, UNBOUNDED)
  if (result === undefined) throw new Error('expected the value to fit the limit')
  return result
}

/** A high surrogate lands exactly at the 4096-byte chunk boundary. */
const pairAtBoundary = `${'a'.repeat(4095)}😀${'b'.repeat(120)}`

const cases: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'the inline envelope', value: { delivery: 'inline', data: { items: [1, 2, 3] } } },
  { name: 'a string spanning several 4096-character chunks', value: { text: 'x'.repeat(10_000) } },
  { name: 'a surrogate pair at a chunk boundary', value: { text: pairAtBoundary } },
  { name: 'Chinese text and emoji', value: { text: '国家储备数字化\u0000 😀' } },
  { name: 'escaped control characters', value: { text: '\u0000\n\t\r"\\/\u001f' } },
  { name: 'an undefined object property', value: { kept: 1, skipped: undefined } },
  { name: 'non-finite numbers', value: { nan: NaN, positive: Infinity, negative: -Infinity } },
  { name: 'undefined array entries', value: { list: [1, undefined, 3] } },
  { name: 'non-finite array entries', value: { list: [NaN, Infinity, -0] } },
  { name: 'nested records and arrays', value: { rows: [{ a: [1, null, 'z'] }, { b: false }] } },
]

describe('inlineJson canonical text', () => {
  for (const { name, value } of cases) {
    it(`matches JSON.stringify for ${name}`, async () => {
      const result = await encoded(value)
      expect(result.canonical).toBe(JSON.stringify(value))
      expect(result.bytes).toBe(new TextEncoder().encode(result.canonical).byteLength)
    })
  }
})

describe('inlineJson bounds and cancellation', () => {
  it('returns undefined at the first chunk past the limit', async () => {
    const value = { text: 'x'.repeat(10_000) }
    const full = await encoded(value)
    expect(await inlineJson(value, full.bytes)).toEqual(full)
    expect(await inlineJson(value, full.bytes - 1)).toBeUndefined()
    expect(await inlineJson(value, 1)).toBeUndefined()
  })

  it('stops before encoding a value that cannot fit', async () => {
    const value = { text: '😀'.repeat(5000) }
    expect(await inlineJson(value, 8, new AbortController().signal)).toBeUndefined()
  })

  it('propagates a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(inlineJson({ a: 1 }, UNBOUNDED, controller.signal)).rejects.toThrow()
  })

  it('propagates a signal aborted while a long string is streaming', async () => {
    const controller = new AbortController()
    const pending = inlineJson({ text: 'y'.repeat(50_000) }, UNBOUNDED, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})
