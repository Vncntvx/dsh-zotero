/**
 * The bounded cross-request vector cache: one encoding per distinct text,
 * coalesced concurrent misses, private buffers, distinct side/identity keys,
 * capacity bounds, and generation retirement.
 * @module tests/unit/semantic-vector-cache
 */

import { describe, expect, it } from 'vitest'
import {
  createVectorCache,
  vectorCacheKeyOf,
  VECTOR_CACHE_MAX_BYTES,
  VECTOR_CACHE_MAX_ITEMS,
  type VectorCacheIdentity,
} from '../../src/enrichment/semantic/vector-cache.ts'

function identity(overrides: Partial<VectorCacheIdentity> = {}): VectorCacheIdentity {
  return {
    key: 'balanced',
    physicalKey: 'qwen3-0.6b',
    revision: 'a'.repeat(40),
    fileDigests: { 'config.json': 'd'.repeat(64) },
    dimension: 2,
    pooling: 'mean',
    normalize: true,
    queryPrefix: 'query: ',
    documentPrefix: '',
    scoringVersion: 'fixed-reference-five-features-v1',
    ...overrides,
  }
}

/** A run function that records how many texts it actually encoded. */
function recorder(encoded: string[]) {
  return async (texts: readonly string[]): Promise<readonly Float32Array[]> => {
    encoded.push(...texts)
    return texts.map((text) => new Float32Array([text.length, 1]))
  }
}

describe('vectorCacheKeyOf', () => {
  it('separates sides, texts, model revisions and file digests', () => {
    const base = identity()
    const query = vectorCacheKeyOf(base, 'query', 'trust')
    expect(query).not.toBe(vectorCacheKeyOf(base, 'document', 'trust'))
    expect(query).not.toBe(vectorCacheKeyOf(base, 'query', 'compliance'))
    expect(query).not.toBe(
      vectorCacheKeyOf(identity({ revision: 'b'.repeat(40) }), 'query', 'trust'),
    )
    expect(query).not.toBe(
      vectorCacheKeyOf(
        identity({ fileDigests: { 'config.json': 'e'.repeat(64) } }),
        'query',
        'trust',
      ),
    )
    expect(query).toBe(vectorCacheKeyOf(base, 'query', 'trust'))
  })
})

describe('createVectorCache', () => {
  it('encodes a document once across repeated reads', async () => {
    const encoded: string[] = []
    const cache = createVectorCache(identity())
    const run = recorder(encoded)
    const first = await cache.embed(['trust', 'compliance'], 'document', run)
    const second = await cache.embed(['trust', 'compliance'], 'document', run)
    expect(encoded).toEqual(['trust', 'compliance'])
    expect(second.map((vector) => [...vector])).toEqual(first.map((vector) => [...vector]))
    cache.dispose()
  })

  it('coalesces concurrent misses for one text', async () => {
    const encoded: string[] = []
    const cache = createVectorCache(identity())
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = async (texts: readonly string[]) => {
      encoded.push(...texts)
      await gate
      return texts.map((text) => new Float32Array([text.length, 1]))
    }
    const first = cache.embed(['trust'], 'document', run)
    const second = cache.embed(['trust'], 'document', run)
    release()
    await Promise.all([first, second])
    expect(encoded).toEqual(['trust'])
    cache.dispose()
  })

  it('does not reuse a cancelled or failed load', async () => {
    const cache = createVectorCache(identity())
    let calls = 0
    const run = async (texts: readonly string[]) => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return texts.map((text) => new Float32Array([text.length, 1]))
    }
    await expect(cache.embed(['trust'], 'document', run)).rejects.toThrow('transient')
    const result = await cache.embed(['trust'], 'document', run)
    expect(calls).toBe(2)
    expect(result).toHaveLength(1)
    cache.dispose()
  })

  it('keeps cached buffers private from callers', async () => {
    const cache = createVectorCache(identity())
    const run = async (texts: readonly string[]) =>
      texts.map((text) => new Float32Array([text.length, 1]))
    const first = await cache.embed(['trust'], 'document', run)
    first[0]![0] = 999
    const second = await cache.embed(['trust'], 'document', run)
    expect(second[0]![0]).toBe(5)
    cache.dispose()
  })

  it('misses after an identity change and after retirement', async () => {
    const encoded: string[] = []
    const first = createVectorCache(identity())
    await first.embed(['trust'], 'document', recorder(encoded))
    const second = createVectorCache(identity({ revision: 'c'.repeat(40) }))
    await second.embed(['trust'], 'document', recorder(encoded))
    expect(encoded).toEqual(['trust', 'trust'])
    first.dispose()
    await expect(first.embed(['trust'], 'document', recorder(encoded))).rejects.toThrow(/retired/)
  })

  it('declares the bounded capacity', () => {
    expect(VECTOR_CACHE_MAX_ITEMS).toBe(16_384)
    expect(VECTOR_CACHE_MAX_BYTES).toBe(64 * 1024 * 1024)
  })
})
