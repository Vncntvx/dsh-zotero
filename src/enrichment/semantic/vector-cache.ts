/**
 * Bounded cross-request cache of validated embedding vectors.
 *
 * One cache lives per loaded model generation. A key names the physical model,
 * its revision and per-file digests, the inference contract, the `query` or
 * `document` side, and the exact SHA-256 of the text — so a query prefix and a
 * document prefix can never share a value, and a model switch misses every
 * entry. Concurrent misses for one key coalesce through `sharedRead`: one
 * caller's cancellation does not abort the others, and a failed or cancelled
 * load is never cached.
 *
 * Capacity is bounded both by item count (16,384) and by a 64 MiB byte budget
 * over vectors and keys. Oversized single vectors are not cached. Values stay
 * private: a stored buffer is copied on write and on read, so a caller can
 * never mutate a cached vector. Retiring a generation drops its cache and its
 * pending work together.
 * @module dsh-zotero/enrichment/semantic/vector-cache
 */

import { createHash } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { sharedRead, type SharedOperation } from '../../concurrency.js'

export const VECTOR_CACHE_MAX_ITEMS = 16_384
export const VECTOR_CACHE_MAX_BYTES = 64 * 1024 * 1024

/** The identity and inference contract a cached vector belongs to. */
export interface VectorCacheIdentity {
  readonly key: string
  readonly physicalKey: string
  readonly revision: string
  /** SHA-256 of each pinned catalog file, by relative path. */
  readonly fileDigests: Readonly<Record<string, string>>
  readonly dimension: number
  readonly pooling: string
  readonly normalize: boolean
  readonly queryPrefix: string
  readonly documentPrefix: string
  readonly scoringVersion: string
}

export type EmbeddingSide = 'query' | 'document'

function digestOf(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** A stable key over the model identity, inference contract, side and text. */
export function vectorCacheKeyOf(
  identity: VectorCacheIdentity,
  side: EmbeddingSide,
  text: string,
): string {
  const contract = [
    identity.key,
    identity.physicalKey,
    identity.revision,
    identity.scoringVersion,
    String(identity.dimension),
    identity.pooling,
    String(identity.normalize),
    identity.queryPrefix,
    identity.documentPrefix,
    ...Object.entries(identity.fileDigests)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, digest]) => `${path}:${digest}`),
  ].join('|')
  return `${digestOf(contract)}|${side}|${digestOf(text)}`
}

function byteSizeOf(key: string, vector: Float32Array): number {
  return vector.byteLength + key.length * 2
}

/** A Map-shaped view over the real LRU so `sharedRead` can drive it. */
class LruMapView {
  constructor(private readonly lru: LRUCache<string, Float32Array>) {}

  get(key: string): Float32Array | undefined {
    const hit = this.lru.get(key)
    return hit === undefined ? undefined : new Float32Array(hit)
  }

  set(key: string, value: Float32Array): this {
    const size = byteSizeOf(key, value)
    if (size > VECTOR_CACHE_MAX_BYTES) return this
    this.lru.set(key, new Float32Array(value), { size })
    return this
  }
}

export interface VectorCache {
  /** Embed only the missing texts; hits come from the cache. */
  embed(
    texts: readonly string[],
    side: EmbeddingSide,
    run: (missing: readonly string[], signal: AbortSignal) => Promise<readonly Float32Array[]>,
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]>
  /** Drop every entry and cancel pending cooperative work. */
  dispose(): void
}

/**
 * Create one bounded cache for one model generation. `identity` is frozen: a
 * model switch constructs a new cache rather than mutating this one.
 */
export function createVectorCache(identity: VectorCacheIdentity): VectorCache {
  const lru = new LRUCache<string, Float32Array>({
    max: VECTOR_CACHE_MAX_ITEMS,
    maxSize: VECTOR_CACHE_MAX_BYTES,
    sizeCalculation: (value, key) => byteSizeOf(key, value),
  })
  const view = new LruMapView(lru)
  const inFlight = new Map<string, SharedOperation<Float32Array>>()
  const controllers = new Set<AbortController>()
  let disposed = false

  return {
    async embed(texts, side, run, signal) {
      if (disposed) throw new Error('the vector cache generation is retired')
      signal?.throwIfAborted()
      const keys = texts.map((text) => vectorCacheKeyOf(identity, side, text))
      const results = new Array<Float32Array>(texts.length)
      const missing = new Map<string, number[]>()
      for (const [index, key] of keys.entries()) {
        const hit = view.get(key!)
        if (hit !== undefined) results[index] = hit
        else missing.set(key!, [...(missing.get(key!) ?? []), index])
      }
      if (missing.size === 0) return results

      // Each distinct key owns one cooperative flight. `sharedRead` keeps a
      // single cancelled waiter from aborting the others and never caches a
      // failed load; the last waiter leaving stops the shared work.
      const settle = await Promise.all(
        [...missing.entries()].map(async ([key, positions]) => {
          const text = texts[positions[0]!]!
          const controller = new AbortController()
          controllers.add(controller)
          try {
            const vector = await sharedRead({
              cache: view as unknown as Map<string, Float32Array>,
              inFlight,
              keys: {
                flightKey: key,
                find: () => view.get(key),
                // `sharedRead` stores the value under every returned alias via
                // the Map-shaped view, which copies the buffer on write.
                store: () => [key],
              },
              load: async (sharedSignal) => {
                const vectors = await run([text], sharedSignal)
                const vector = vectors[0]
                if (vector === undefined || vector.length !== identity.dimension) {
                  throw new Error('the embedder returned no vector for a cached text')
                }
                return new Float32Array(vector)
              },
              signal,
            })
            for (const position of positions) results[position] = new Float32Array(vector)
          } finally {
            controllers.delete(controller)
          }
        }),
      )
      void settle
      return results
    },
    dispose() {
      disposed = true
      for (const controller of controllers) controller.abort(new Error('cache retired'))
      controllers.clear()
      inFlight.clear()
      lru.clear()
    },
  }
}
