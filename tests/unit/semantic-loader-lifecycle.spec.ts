/**
 * WP7 loader lifecycle: transactional model switch, failed B leaving A
 * managed, scope draining on teardown, exactly-once release, and A→B→A.
 * @module tests/unit/semantic-loader-lifecycle
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE } from '../../src/errors.ts'
import {
  SemanticEmbedderLoader,
  semanticUnavailable,
} from '../../src/enrichment/semantic/loader.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import type { SemanticModelTarget } from '../../src/enrichment/semantic/loader.ts'
import { deferred } from '../helpers/sync.ts'
import { tinyModel } from '../helpers/semantic-model-bundle.ts'

function target(key: string): SemanticModelTarget {
  return { spec: { ...tinyModel, key: key as typeof tinyModel.key }, dir: `/models/${key}` }
}

async function loadOnce(
  loader: SemanticEmbedderLoader,
  target: SemanticModelTarget,
): Promise<void> {
  const lease = await loader.get(target)
  await lease.dispose()
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
  it('preserves the semantic-unavailable error identity when already normalized', () => {
    const error = semanticUnavailable(new Error('model missing'))
    expect(semanticUnavailable(error)).toBe(error)
  })

  it('preserves a retained inference lease while released scopes stay permanently closed', async () => {
    const dispose = vi.fn(async () => {})
    const loader = new SemanticEmbedderLoader({
      open: async () => ({
        dimension: 2,
        embed: async () => [new Float32Array([1, 0])],
        dispose,
      }),
    })
    const scope = loader.scope({ spec: tinyModel, dir: '/synthetic/retained-model' })
    const borrowed = await scope.embedder(),
      retained = borrowed.retain!()
    scope.release()
    await expect(scope.embedder()).rejects.toThrow('ranking scope has been released')
    expect(() => borrowed.retain!()).toThrow('ranking scope has been released')
    const draining = loader.dispose()
    expect(await retained.embed(['accepted'], 'query')).toEqual([new Float32Array([1, 0])])
    expect(dispose).not.toHaveBeenCalled()
    await Promise.all([retained.dispose(), retained.dispose()])
    await draining
    expect(dispose).toHaveBeenCalledOnce()
    await expect(retained.embed(['late'], 'query')).rejects.toThrow(
      'inference lease has been released',
    )
    expect(() => retained.retain!()).toThrow('inference lease has been released')
  })
  it('commits B as resident only after its load succeeds', async () => {
    const disposed: string[] = []
    const keys: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        keys.push(requested.spec.key)
        return embedderOf(disposed, requested.spec.key)
      },
    })
    await loadOnce(loader, target('a'))
    await loadOnce(loader, target('b'))
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
    await loadOnce(loader, target('a'))
    await expect(loadOnce(loader, target('b'))).rejects.toThrow(/B failed/)
    // A is still resident: the next A call does not reopen it.
    await loadOnce(loader, target('a'))
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
    await loadOnce(loader, target('a'))
    await loadOnce(loader, target('b'))
    await loadOnce(loader, target('a'))
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
    await loadOnce(loader, target('a'))
    expect(opened).toEqual(['a', 'a'])
    expect(disposed).toEqual([])
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual(['a'])
    await loader.dispose()
  })

  it('does not revive a pending load retired before it resolves', async () => {
    const disposed: string[] = []
    const opened: string[] = []
    const started = deferred<void>()
    const first = deferred<Embedder>()
    let calls = 0
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        opened.push(requested.spec.key)
        calls += 1
        if (calls === 1) {
          started.resolve()
          return await first.promise
        }
        return embedderOf(disposed, requested.spec.key)
      },
    })
    const scope = loader.scope(target('a'))
    const pending = scope.embedder()
    await started.promise
    loader.retire(target('a'))
    first.resolve(embedderOf(disposed, 'a'))
    await pending
    // The retired instance serves its accepted scope, but never becomes
    // resident: the next caller opens the bundle from disk again.
    await loadOnce(loader, target('a'))
    expect(opened).toEqual(['a', 'a'])
    scope.release()
    await Promise.resolve()
    expect(disposed).toEqual(['a'])
    await loader.dispose()
    expect(disposed).toEqual(['a', 'a'])
  })

  it('does not start a load released before opening and serves a later scope freshly', async () => {
    const disposed: string[] = [],
      opened: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        opened.push(requested.spec.key)
        return embedderOf(disposed, requested.spec.key)
      },
    })
    const unused = loader.scope(target('a'))
    unused.release()
    await loadOnce(loader, target('a'))
    expect(opened).toEqual(['a'])
    expect(disposed).toEqual([])
    await loader.dispose()
    expect(disposed).toEqual(['a'])
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

  it('lets a scope admitted before teardown use its model, then disposes it on release', async () => {
    const disposed: string[] = []
    const loader = new SemanticEmbedderLoader({ open: async () => embedderOf(disposed, 'a') })
    const scope = loader.scope(target('a'))
    await loader.dispose()
    // Teardown closes admission, not the work already admitted: this scope was
    // accepted while the component lived, and its fixed model must serve it.
    await expect(scope.embedder()).resolves.toBeDefined()
    expect(disposed).toEqual([])
    scope.release()
    await vi.waitFor(() => expect(disposed).toEqual(['a']))
  })
})

describe('configured model directory validation', () => {
  it('opens the canonical directory for a configured root with .. segments', async () => {
    const base = await mkdtemp(join(tmpdir(), 'loader-model-dir-'))
    try {
      await mkdir(join(base, 'nested'))
      const opened: string[] = []
      const loader = new SemanticEmbedderLoader({
        open: async (requested) => {
          opened.push(requested.dir)
          return embedderOf([], requested.spec.key)
        },
      })
      // The configured root is the same directory spelled with a traversing
      // segment; the reader must open the canonical path.
      const configuredDir = `${join(base, 'nested')}${sep}..`
      await loadOnce(loader, {
        spec: { ...tinyModel, physicalKey: 'qwen3-0.6b' },
        dir: `${configuredDir}${sep}qwen3-0.6b`,
        configuredDir,
      })
      expect(opened).toEqual([join(await realpath(base), 'qwen3-0.6b')])
      await loader.dispose()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('opens an already canonical configured directory without changing its target', async () => {
    const base = await mkdtemp(join(tmpdir(), 'loader-canonical-dir-'))
    const opened: SemanticModelTarget[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (requested) => {
        opened.push(requested)
        return embedderOf([], requested.spec.key)
      },
    })
    try {
      const configuredDir = await realpath(base)
      const requested = {
        spec: tinyModel,
        dir: join(configuredDir, tinyModel.physicalKey),
        configuredDir,
      }
      await loadOnce(loader, requested)
      expect(opened).toEqual([requested])
    } finally {
      await loader.dispose()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('fails closed when the configured root is a credential directory', async () => {
    const loader = new SemanticEmbedderLoader({ open: async () => embedderOf([], 'x') })
    const configuredDir = join(homedir(), '.ssh', 'models')
    await expect(
      loadOnce(loader, {
        spec: { ...tinyModel, physicalKey: 'qwen3-0.6b' },
        dir: join(configuredDir, 'qwen3-0.6b'),
        configuredDir,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE })
  })
})
