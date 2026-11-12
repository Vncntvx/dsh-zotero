/**
 * WP7 loader lifecycle: transactional model switch, failed B leaving A
 * managed, scope draining on teardown, exactly-once release, and A→B→A.
 * @module tests/unit/semantic-loader-lifecycle
 */

import { describe, expect, it } from 'vitest'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import type { SemanticModelTarget } from '../../src/enrichment/semantic/loader.ts'
import { deferred } from '../helpers/sync.ts'

function target(key: string): SemanticModelTarget {
  return { spec: { key } as never, dir: `/models/${key}` }
}

function embedderOf(disposed: string[], key: string): Embedder {
  return {
    dimension: 2,
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
    dispose: async () => {
      disposed.push(key)
    },
  }
}

describe('SemanticEmbedderLoader lifecycle', () => {
  it('commits B as resident only after its load succeeds', async () => {
    const disposed: string[] = []
    const keys: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        keys.push(requested.spec.key)
        return embedderOf(disposed, requested.spec.key)
      },
    })
    const a = await loader.get(target('a'))
    const b = await loader.get(target('b'))
    expect(a).not.toBe(b)
    expect(disposed).toEqual(['a'])
    await loader.dispose()
    expect(disposed).toEqual(['a', 'b'])
    expect(keys).toEqual(['a', 'b'])
  })

  it('keeps A managed and reports to B when B fails', async () => {
    const disposed: string[] = []
    let calls = 0
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        calls += 1
        if ((requested.spec.key as string) === 'b' && calls === 2) throw new Error('B failed')
        return embedderOf(disposed, requested.spec.key)
      },
    })
    await loader.get(target('a'))
    await expect(loader.get(target('b'))).rejects.toThrow(/B failed/)
    // A is still resident: the next A call does not reopen it.
    await loader.get(target('a'))
    expect(calls).toBe(2)
    await loader.dispose()
    expect(disposed).toEqual(['a'])
  })

  it('does not release an instance while an accepted scope is outstanding', async () => {
    const disposed: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async () => embedderOf(disposed, 'a'),
    })
    const scope = loader.scope(target('a'))
    await scope.embedder()
    await loader.dispose()
    // The admitted scope still owns the instance; teardown only closes admission.
    expect(disposed).toEqual([])
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual(['a'])
  })

  it('handles A→B→A without duplicate loads or double release', async () => {
    const disposed: string[] = []
    const opened: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        opened.push(requested.spec.key)
        return embedderOf(disposed, requested.spec.key)
      },
    })
    await loader.get(target('a'))
    await loader.get(target('b'))
    await loader.get(target('a'))
    await loader.dispose()
    // A is reopened after B displaced it; each instance is released once.
    expect(opened).toEqual(['a', 'b', 'a'])
    expect(disposed).toHaveLength(3)
  })

  it('reopens a retired target and keeps the accepted scope instance alive', async () => {
    const disposed: string[] = []
    const opened: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        opened.push(requested.spec.key)
        return embedderOf(disposed, requested.spec.key)
      },
    })
    const scope = loader.scope(target('a'))
    await scope.embedder()
    loader.retire(target('a'))
    // The accepted scope still holds the instance; nothing is released yet.
    expect(disposed).toEqual([])
    // The next caller opens the bundle again rather than reusing the retired
    // instance: that is how deleting a model's files becomes visible.
    await loader.get(target('a'))
    expect(opened).toEqual(['a', 'a'])
    expect(disposed).toEqual([])
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual(['a'])
    await loader.dispose()
  })

  it('rejects new admission after disposal', async () => {
    const loader = new SemanticEmbedderLoader({ open: async () => embedderOf([], 'a') })
    await loader.dispose()
    expect(() => loader.scope(target('a'))).toThrow(/cannot serve/)
  })

  it('keeps an in-flight load alive for an accepted scope when teardown closes admission', async () => {
    const disposed: string[] = []
    const started = deferred<void>()
    const opened = deferred<Embedder>()
    const loader = new SemanticEmbedderLoader({
      open: async () => {
        started.resolve()
        return await opened.promise
      },
    })
    const scope = loader.scope(target('a'))
    // The scope is accepted and the open has genuinely started; teardown then
    // arrives while the load is still in flight, so `dispose()` waits for it.
    const pending = scope.embedder()
    await started.promise
    const disposing = loader.dispose()
    opened.resolve(embedderOf(disposed, 'a'))
    const embedder = await pending
    await disposing
    // The accepted scope received a live instance, not a released one.
    expect(disposed).toEqual([])
    expect(await embedder.embed(['x'], 'query')).toHaveLength(1)
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual(['a'])
  })

  it('reports semantic-unavailable when teardown lands before the open starts', async () => {
    const disposed: string[] = []
    const loader = new SemanticEmbedderLoader({ open: async () => embedderOf(disposed, 'a') })
    const scope = loader.scope(target('a'))
    await loader.dispose()
    await expect(scope.embedder()).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE',
    })
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual([])
  })
})
