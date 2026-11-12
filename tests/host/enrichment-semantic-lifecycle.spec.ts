/**
 * Semantic ranking lifecycle at the service level: an admitted ranking scope
 * keeps its model generation across a tier switch, and a core re-injection
 * builds a new loader instead of reusing a closed one.
 *
 * The two defects these cover were both "resource released while its consumer
 * still held it": the vector cache generation and the loader itself.
 * @module tests/host/enrichment-semantic-lifecycle
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/service.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE } from '../../src/errors.ts'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import { deferred } from '../helpers/sync.ts'

const owned: Context[] = []

afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (ctx) => await ctx.fiber.dispose()))
})

/** A scripted embedder: every text lands on the first axis, so every chunk passes the floor. */
function scriptedEmbedder(dimension: number, disposed: string[], key: string): Embedder {
  return {
    dimension,
    embed: async (texts) =>
      texts.map(() => Float32Array.from({ length: dimension }, (_, i) => (i === 0 ? 1 : 0))),
    dispose: async () => {
      disposed.push(key)
    },
  }
}

/** One enrichment service over a counting loader factory. */
function world(options: { readonly core?: boolean } = {}) {
  const ctx = new Context()
  owned.push(ctx)
  const disposed: string[] = []
  const opened: string[] = []
  const factories = vi.fn(
    () =>
      new SemanticEmbedderLoader({
        open: async (target) => {
          opened.push(target.spec.key)
          return scriptedEmbedder(target.spec.dimension, disposed, target.spec.key)
        },
      }),
  )
  const service = new EnrichmentService(
    ctx,
    {
      enableSemanticSearch: true,
      semanticModel: 'lightweight',
      semanticModelDir: '/models',
    },
    { loader: factories },
  )
  const ready = deferred<void>()
  if (options.core !== false) {
    ctx.provide('zotero', {
      setFulltextEnhancer: () => undefined,
      setEvidenceRanker: () => ready.resolve(),
      resolveAttachment: async () => {
        throw new Error('unused')
      },
    } as unknown as Context['zotero'])
  }
  return { ctx, service, factories, opened, disposed, ready: ready.promise }
}

/** The core contract makes `admit` optional; these cases exercise the semantic ranker. */
function admitScope(ranker: { admit?: () => { handle: symbol; release: () => void } }): {
  handle: symbol
  release: () => void
} {
  if (ranker.admit === undefined) throw new Error('expected a ranker that admits scopes')
  return ranker.admit()
}

const request = {
  query: 'attention',
  chunks: [{ text: 'attention is all you need', index: 0 }],
}

describe('the admitted ranking scope owns its model generation', () => {
  it('keeps ranking through the old generation after the tier changes', async () => {
    const { service, ready } = world()
    await ready
    const ranker = service.liveEvidenceRanker
    const first = admitScope(ranker)
    const before = await ranker.rank({ ...request, scope: first.handle })
    expect(before.matches.length).toBeGreaterThan(0)

    // A tier switch retires the generation. The admitted scope was fixed before
    // it, and its vector cache must still answer: disposing it here used to make
    // this call throw `the vector cache generation is retired`.
    service.config = { ...service.config, semanticModel: 'balanced' }
    const second = admitScope(ranker)
    const after = await ranker.rank({ ...request, scope: first.handle })
    expect(after.matches.length).toBeGreaterThan(0)
    const switched = await ranker.rank({ ...request, scope: second.handle })
    expect(switched.matches.length).toBeGreaterThan(0)

    first.release()
    second.release()
  })

  it('retires the resident model when its files are deleted', async () => {
    const ctx = new Context()
    owned.push(ctx)
    let gone = false
    const disposed: string[] = []
    const factories = () =>
      new SemanticEmbedderLoader({
        open: async (target) => {
          // The files are gone: reopening must fail, which is what the settings
          // page and the configuration docs promise after a deletion.
          if (gone) throw new Error('the bundle is gone')
          return scriptedEmbedder(target.spec.dimension, disposed, target.spec.key)
        },
      })
    const downloads = {
      remove: async () => {
        gone = true
        return {
          success: true,
          model: 'lightweight',
          path: '/models/qwen3-0.6b',
          removed: true,
          removedFiles: 2,
          removedBytes: 10,
        }
      },
      dispose: async () => undefined,
    }
    const service = new EnrichmentService(
      ctx,
      { enableSemanticSearch: true, semanticModel: 'lightweight', semanticModelDir: '/models' },
      { loader: factories, downloads: downloads as never },
    )
    const ready = deferred<void>()
    ctx.provide('zotero', {
      setFulltextEnhancer: () => undefined,
      setEvidenceRanker: () => ready.resolve(),
      resolveAttachment: async () => {
        throw new Error('unused')
      },
    } as unknown as Context['zotero'])
    await ready.promise

    const ranker = service.liveEvidenceRanker
    const scope = admitScope(ranker)
    expect((await ranker.rank({ ...request, scope: scope.handle })).matches.length).toBeGreaterThan(
      0,
    )
    scope.release()

    await service.deleteSemanticModel({}, new AbortController().signal)

    // The resident instance was retired with the files: the next admission
    // re-opens from disk and fails closed instead of serving the deleted model.
    const after = admitScope(ranker)
    await expect(ranker.rank({ ...request, scope: after.handle })).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    })
    after.release()
  })

  it('releases a borrowed generation when rank runs without an admitted scope', async () => {
    const { service, disposed, ready } = world()
    await ready
    const ranker = service.liveEvidenceRanker
    const result = await ranker.rank(request)
    expect(result.matches.length).toBeGreaterThan(0)
    // The borrowed scope released both handles; a second call reuses the still
    // resident embedder rather than opening a second one.
    const again = await ranker.rank(request)
    expect(again.matches.length).toBeGreaterThan(0)
    expect(disposed).toEqual([])
  })
})

describe('the loader belongs to one core injection', () => {
  /**
   * A core stand-in whose `zotero` service lives exactly as long as its own
   * fiber, which is what makes a plugin re-mount a new injection generation.
   */
  class CoreStub {
    constructor(readonly ctx: Context) {
      ctx.provide('zotero', {
        setFulltextEnhancer: () => undefined,
        setEvidenceRanker: () => undefined,
        resolveAttachment: async () => {
          throw new Error('unused')
        },
      } as unknown as Context['zotero'])
    }
  }

  it('builds a new loader after the core is replaced', async () => {
    const ctx = new Context()
    owned.push(ctx)
    const disposed: string[] = []
    const factories = vi.fn(
      () =>
        new SemanticEmbedderLoader({
          open: async (target) =>
            scriptedEmbedder(target.spec.dimension, disposed, target.spec.key),
        }),
    )
    const service = new EnrichmentService(
      ctx,
      { enableSemanticSearch: true, semanticModel: 'lightweight', semanticModelDir: '/models' },
      { loader: factories },
    )
    const ranker = service.liveEvidenceRanker

    const core = ctx.plugin(CoreStub)
    await core
    await vi.waitFor(() => expect(factories.mock.calls.length).toBe(1))
    const scope = admitScope(ranker)
    scope.release()

    // The host replaced the core: its fiber goes away and a new instance takes
    // its place. The closed loader must not be reused — admission has to work
    // again, which it did not while one loader was constructed for the whole
    // service lifetime.
    await core.dispose()
    const replacement = ctx.plugin(CoreStub)
    await replacement
    await vi.waitFor(() => expect(factories.mock.calls.length).toBe(2))
    const again = admitScope(ranker)
    const result = await ranker.rank({ ...request, scope: again.handle })
    expect(result.matches.length).toBeGreaterThan(0)
    again.release()

    expect(factories.mock.calls.length).toBeGreaterThanOrEqual(2)
    await replacement.dispose()
  })

  it('fails closed instead of going lexical when semantic ranking has no loader', async () => {
    const { service } = world({ core: false })
    expect(() => admitScope(service.liveEvidenceRanker)).toThrow(/no model loader is installed/)
  })
})
