/** Leases retain queued and actual inference; caller deadlines only end that caller's wait. */
import { expect, it } from 'vitest'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import {
  createVectorCache,
  type VectorCacheIdentity,
} from '../../src/enrichment/semantic/vector-cache.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import { tinyModel } from '../helpers/semantic-model-bundle.ts'
import { deferred } from '../helpers/sync.ts'

const target = (name: string) => ({ spec: tinyModel, dir: `/synthetic/${name}` })
const identity: VectorCacheIdentity = {
  key: tinyModel.key,
  physicalKey: tinyModel.physicalKey,
  revision: tinyModel.revision,
  dimension: 2,
  maxTokens: 16,
  fileDigests: {},
  pooling: 'mean',
  normalize: true,
  queryPrefix: '',
  documentPrefix: '',
  scoringVersion: 'test',
}

it('retains an actual inference after its owning lease is released and the model switches', async () => {
  const started = deferred<void>()
  const finish = deferred<void>()
  const released = deferred<void>()
  const disposed: string[] = []
  const loader = new SemanticEmbedderLoader({
    open: async ({ dir }) => ({
      dimension: 2,
      embed: async () => {
        started.resolve()
        await finish.promise
        return [new Float32Array([1, 0])]
      },
      dispose: async () => {
        disposed.push(dir)
        if (dir.endsWith('/a')) released.resolve()
      },
    }),
  })
  try {
    const a = await loader.get(target('a'))
    const inference = a.embed(['input'], 'document')
    await started.promise
    await a.dispose()
    const b = await loader.get(target('b'))
    await b.dispose()
    expect(disposed).not.toContain('/synthetic/a')
    finish.resolve()
    await inference
    await released.promise
    expect(disposed.filter((dir) => dir.endsWith('/a'))).toHaveLength(1)
    await expect(a.embed(['late'], 'document')).rejects.toThrow(/scope has been released/)
  } finally {
    finish.resolve()
    await loader.dispose()
  }
})

it('ends a caller wait at its own abort and eventually releases the late model exactly once', async () => {
  const started = deferred<void>()
  const finish = deferred<Embedder>()
  let releases = 0
  const loader = new SemanticEmbedderLoader({
    open: async () => {
      started.resolve()
      return await finish.promise
    },
  })
  const controller = new AbortController()
  const pending = loader.get(target('a'), controller.signal)
  try {
    await started.promise
    const reason = new Error('original provider deadline')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  } finally {
    finish.resolve({
      dimension: 2,
      embed: async () => [],
      dispose: async () => {
        releases += 1
      },
    })
    await loader.dispose()
  }
  expect(releases).toBe(1)
})

it('retains a queued shared batch after its initiating caller leaves', async () => {
  const started = deferred<void>()
  const finish = deferred<void>()
  const cache = createVectorCache(identity)
  let runs = 0
  const loader = new SemanticEmbedderLoader({
    open: async () => ({
      dimension: 2,
      embed: async (texts) => {
        if (++runs === 1) {
          started.resolve()
          await finish.promise
        }
        return texts.map(() => new Float32Array([1, 0]))
      },
      dispose: async () => {},
    }),
  })
  const controller = new AbortController()
  try {
    const firstLease = await loader.get(target('a'))
    const run = async (texts: readonly string[], signal: AbortSignal) =>
      await firstLease.embed(texts, 'document', signal)
    const first = cache.embed(
      Array.from({ length: 9 }, (_, i) => `text${i}`),
      'document',
      run,
      controller.signal,
      () => {
        const retained = firstLease.retain!()
        return {
          run: async (texts, signal) => await retained.embed(texts, 'document', signal),
          release: async () => await retained.dispose(),
        }
      },
    )
    await started.promise
    const survivor = cache.embed(['text8'], 'document', run)
    controller.abort(new Error('initiator left'))
    await expect(first).rejects.toThrow('initiator left')
    await firstLease.dispose()
    finish.resolve()
    expect(await survivor).toHaveLength(1)
    expect(runs).toBe(2)
  } finally {
    finish.resolve()
    cache.dispose()
    await loader.dispose()
  }
})

it('serializes three distinct model opens and releases each accepted instance once', async () => {
  const starts = [deferred<void>(), deferred<void>(), deferred<void>()]
  const finishes = [deferred<void>(), deferred<void>(), deferred<void>()]
  const opened: string[] = []
  const disposed: string[] = []
  const loader = new SemanticEmbedderLoader({
    open: async ({ dir }) => {
      const index = opened.length
      opened.push(dir)
      starts[index]!.resolve()
      await finishes[index]!.promise
      return {
        dimension: 2,
        embed: async () => [],
        dispose: async () => {
          disposed.push(dir)
        },
      }
    },
  })
  const scopes = ['a', 'b', 'c'].map((name) => loader.scope(target(name)))
  try {
    const loaded = scopes.map((scope) => scope.embedder())
    for (let i = 0; i < 3; i += 1) {
      await starts[i]!.promise
      expect(opened).toEqual(['a', 'b', 'c'].slice(0, i + 1).map((name) => `/synthetic/${name}`))
      finishes[i]!.resolve()
    }
    await Promise.all(loaded)
  } finally {
    for (const finish of finishes) finish.resolve()
    for (const scope of scopes) scope.release()
    await loader.dispose()
  }
  expect(disposed.sort()).toEqual(['/synthetic/a', '/synthetic/b', '/synthetic/c'])
})
