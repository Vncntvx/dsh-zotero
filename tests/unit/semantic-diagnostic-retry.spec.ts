/** A diagnostic failure is retryable on the same live embedder. */
import { expect, it, vi } from 'vitest'
import { probeSeparationOf } from '../../src/enrichment/semantic/ranker.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'

it('drops a rejected probe promise while retaining successful measurements', async () => {
  let fail = true
  const embed = vi.fn(async (texts: readonly string[]) => {
    if (fail) throw new Error('transient inference failure')
    return texts.map(() => new Float32Array([1, 0]))
  })
  const embedder: Embedder = { dimension: 2, embed, dispose: async () => {} }
  await expect(probeSeparationOf(embedder)).rejects.toThrow('transient inference failure')
  fail = false
  const measured = await probeSeparationOf(embedder)
  const calls = embed.mock.calls.length
  expect(await probeSeparationOf(embedder)).toEqual(measured)
  expect(embed).toHaveBeenCalledTimes(calls)
})
