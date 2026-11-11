/**
 * The per-service download manager: status reconciliation, start/force/cancel,
 * manifest commit, and dispose ownership. The catalog module is mocked to a
 * tiny two-file spec so a download runs in milliseconds against a temp
 * directory with a scripted fetch; the real digests are pinned in the
 * production catalog and exercised by `assets:semantic:verify`.
 * @module tests/unit/enrichment-model-downloader
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../src/enrichment/model-downloader.ts'
import type { FetchLike } from '../../src/enrichment/model-download-client.ts'

vi.mock('../../src/enrichment-model-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/enrichment-model-catalog.js')>()
  const fileA = Buffer.from('alpha')
  const fileB = Buffer.from('beta!')
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const tiny = {
    key: 'balanced',
    physicalKey: 'tiny',
    label: 'tiny',
    physicalModel: 'tiny',
    note: 'tiny',
    modelId: 'acme/tiny',
    revision: 'b'.repeat(40),
    dimension: 2,
    maxTokens: 16,
    languages: ['*'],
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [
      { path: 'config.json', bytes: fileA.length, sha256: sha(fileA) },
      { path: 'onnx/model_quantized.onnx', bytes: fileB.length, sha256: sha(fileB) },
    ],
  }
  return {
    ...actual,
    SEMANTIC_MODEL_KEYS: ['balanced'],
    DEFAULT_SEMANTIC_MODEL: 'balanced',
    SEMANTIC_MODELS: [tiny],
    semanticModelOf: (key: string) => {
      if (key !== 'balanced') {
        throw new TypeError(`unknown semantic model "${key}"; available: balanced`)
      }
      return tiny
    },
    semanticModelBytes: () => tiny.files.reduce((sum, file) => sum + file.bytes, 0),
  }
})

const bytesOf: Record<string, Buffer> = {
  'config.json': Buffer.from('alpha'),
  'onnx/model_quantized.onnx': Buffer.from('beta!'),
}

function scriptedFetch(): FetchLike {
  return (async (url) => {
    const path = String(url).replace(/^.*\/resolve\/[^/]+\//, '')
    const bytes = bytesOf[path]
    if (bytes === undefined) {
      return { ok: false, status: 404, headers: { get: () => null }, body: null }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes))
          controller.close()
        },
      }),
    }
  }) as FetchLike
}

function managerOf(modelRoot?: string): ModelDownloadManager {
  return new ModelDownloadManager({
    client: {
      fetch: scriptedFetch(),
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
    },
    // The safe-directory resolver runs against the real filesystem; the model
    // root is a per-test temp directory, so nothing touches the user's home.
    ...(modelRoot === undefined ? {} : {}),
  })
}

/** Poll until the bundle is ready: `vi.waitFor` retries on throw, not on falsy. */
async function awaitReady(
  manager: ModelDownloadManager,
  root: string,
  timeout = 5_000,
): Promise<void> {
  await vi.waitFor(
    async () => {
      const status = await manager.status('balanced', root)
      if (!status.ready) throw new Error(`not ready yet: ${JSON.stringify(status)}`)
      return status
    },
    { timeout, interval: 20 },
  )
}

let roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mgr-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  const current = roots
  roots = []
  await Promise.all(current.map((root) => rm(root, { recursive: true, force: true })))
})

describe('ModelDownloadManager', () => {
  it('reports not-ready before the download and ready after it', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    const before = await manager.status('balanced', root)
    expect(before.ready).toBe(false)
    expect(before.model).toBe('balanced')

    const start = await manager.start({ model: 'balanced', modelDir: root })
    expect(start.status).toBe('started')

    const after = await awaitReady(manager, root).then(() => manager.status('balanced', root))
    expect(after.ready).toBe(true)
    expect(after.percent).toBe(100)
    // The manifest is the catalog's own record, written last.
    const manifest = JSON.parse(await readFile(join(root, 'tiny', 'manifest.json'), 'utf8'))
    expect(manifest.schema).toBe(2)
    expect(manifest.pooling).toBe('mean')
    expect(manifest.files['config.json'].sha256).toBe(
      createHash('sha256').update(bytesOf['config.json']!).digest('hex'),
    )
  }, 15_000)

  it('answers already-ready for an installed bundle and force replaces it', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    await manager.start({ model: 'balanced', modelDir: root })
    await awaitReady(manager, root)
    expect((await manager.start({ model: 'balanced', modelDir: root })).status).toBe(
      'already-ready',
    )
    expect((await manager.start({ model: 'balanced', modelDir: root, force: true })).status).toBe(
      'started',
    )
    await awaitReady(manager, root)
  }, 15_000)

  it('refuses an unknown model at the boundary', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    await expect(manager.start({ model: 'nope', modelDir: root })).rejects.toThrow(
      /unknown semantic model/,
    )
  })

  it('verify hashes every pinned file and catches a corrupted bundle', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    await manager.start({ model: 'balanced', modelDir: root })
    await awaitReady(manager, root)
    expect((await manager.verify('balanced', root)).ready).toBe(true)
    await rm(join(root, 'tiny', 'config.json'))
    expect((await manager.verify('balanced', root)).ready).toBe(false)
  }, 15_000)

  it('dispose aborts an in-flight download', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    const started = await manager.start({ model: 'balanced', modelDir: root })
    expect(started.status).toBe('started')
    await manager.dispose()
    const after = await manager.status('balanced', root)
    expect(after.downloading).toBe(false)
    // The temp download state is reconciled against the disk: nothing ready.
    expect(after.ready).toBe(false)
  }, 15_000)

  it('heals a stale error once the bundle appears on disk', async () => {
    const root = await tempRoot()
    const failing = new ModelDownloadManager({
      client: {
        fetch: (async () => ({
          ok: false,
          status: 500,
          headers: { get: () => null },
          body: null,
        })) as unknown as FetchLike,
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
    })
    await failing.start({ model: 'balanced', modelDir: root, source: 'hf-mirror' })
    await vi.waitFor(
      async () => {
        const status = await failing.status('balanced', root)
        if (status.error === undefined) throw new Error('not failed yet')
        return true
      },
      { timeout: 5_000, interval: 20 },
    )
    // (waitFor retries on throw, so this poll is correct as written)
    expect((await failing.status('balanced', root)).error).toBeDefined()
    // Out-of-band install through a working manager:
    const working = managerOf()
    await working.start({ model: 'balanced', modelDir: root })
    await awaitReady(working, root, 10_000)
    const healed = await failing.status('balanced', root)
    expect(healed.ready).toBe(true)
    expect(healed.error).toBeUndefined()
  }, 30_000)

  it('creates the model root under a validated directory', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    const status = await manager.status('balanced', join(root, 'nested'))
    // The resolver returns the canonical path, so assert the suffix only.
    expect(status.path.endsWith(join('nested', 'tiny'))).toBe(true)
    expect((await stat(join(root, 'nested'))).isDirectory()).toBe(true)
  })

  it('refuses a relative model directory', async () => {
    const manager = managerOf()
    await expect(manager.status('balanced', 'relative/dir')).rejects.toThrow(/not absolute/)
  })
})
