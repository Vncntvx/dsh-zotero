/**
 * Download-manager admission options the main manager spec does not name:
 * the default catalog model, the default `$DSH_HOME` root when no model
 * directory is configured, an unknown source, the explicit Hugging Face
 * source, and percentage arithmetic for a catalog entry with no pinned files.
 * @module tests/unit/enrichment-model-downloader-options
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../src/enrichment/model-downloader.ts'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.ts'
import type { FetchLike } from '../../src/enrichment/model-download-client.ts'

vi.mock('../../src/enrichment-model-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/enrichment-model-catalog.js')>()
  const fileA = Buffer.from('alpha')
  const fileB = Buffer.from('beta!')
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const base = {
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
  }
  const tiny = {
    ...base,
    key: 'balanced',
    physicalKey: 'tiny',
    files: [
      { path: 'config.json', bytes: fileA.length, sha256: sha(fileA) },
      { path: 'onnx/model_quantized.onnx', bytes: fileB.length, sha256: sha(fileB) },
    ],
  }
  const empty = {
    ...base,
    key: 'empty',
    physicalKey: 'empty-tiny',
    modelId: 'acme/empty',
    files: [{ path: 'empty.bin', bytes: 0, sha256: sha(Buffer.alloc(0)) }],
  }
  return {
    ...actual,
    SEMANTIC_MODEL_KEYS: ['balanced'],
    DEFAULT_SEMANTIC_MODEL: 'balanced',
    SEMANTIC_MODELS: [tiny, empty],
    semanticModelOf: (key: string) => {
      if (key === tiny.key) return tiny
      if (key === empty.key) return empty
      throw new TypeError(`unknown semantic model "${key}"; available: balanced, empty`)
    },
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

function managerOf(): ModelDownloadManager {
  return new ModelDownloadManager({
    client: {
      fetch: scriptedFetch(),
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
    },
  })
}

async function awaitReady(manager: ModelDownloadManager, modelDir?: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const status = await manager.status('balanced', modelDir)
      if (!status.ready) throw new Error(`not ready yet: ${JSON.stringify(status)}`)
    },
    { timeout: 5_000, interval: 20 },
  )
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  )
})
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mgr-options-'))
  roots.push(root)
  return root
}

describe('ModelDownloadManager admission options', () => {
  it('reports zero percent for a catalog entry with no pinned files', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    try {
      const status = await manager.status('empty', root)
      expect(status).toMatchObject({ ready: false, totalBytes: 0, downloadedBytes: 0, percent: 0 })
    } finally {
      await manager.dispose()
    }
  })

  it('refuses an unknown download source before creating the model directory', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    try {
      await expect(
        manager.start({ model: 'balanced', modelDir: root, source: 'ftp' }),
      ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
      await expect(readFile(join(root, 'tiny', 'config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await manager.dispose()
    }
  })

  it('accepts the explicit Hugging Face source and installs the bundle', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    try {
      const started = await manager.start({
        model: 'balanced',
        modelDir: root,
        source: 'huggingface',
      })
      expect(started).toMatchObject({ status: 'started', model: 'balanced' })
      await awaitReady(manager, root)
      expect(await readFile(join(root, 'tiny', 'config.json'), 'utf8')).toBe('alpha')
    } finally {
      await manager.dispose()
    }
  })

  it('starts the default catalog model when the request names none', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    try {
      const started = await manager.start({ modelDir: root })
      expect(started).toMatchObject({ status: 'started', model: 'balanced' })
      await awaitReady(manager, root)
    } finally {
      await manager.dispose()
    }
  })

  it('uses the models root under DSH_HOME when no model directory is configured', async () => {
    const home = await tempRoot()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const manager = managerOf()
    try {
      const started = await manager.start({ model: 'balanced' })
      expect(started.status).toBe('started')
      expect(started.path.endsWith(join('models', 'tiny'))).toBe(true)
      await awaitReady(manager)
      const status = await manager.status('balanced')
      expect(status.ready).toBe(true)
      expect(status.path.endsWith(join('models', 'tiny'))).toBe(true)
      expect(await readFile(join(home, 'models', 'tiny', 'config.json'), 'utf8')).toBe('alpha')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await manager.dispose()
    }
  }, 20_000)
})
