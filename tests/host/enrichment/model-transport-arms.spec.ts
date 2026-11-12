/**
 * The download client's real filesystem seams and its abort/discard arms.
 * These are host-runtime paths that the scripted-fetch unit specs do not reach.
 * @module tests/host/enrichment/model-transport-arms
 */

import { createHash } from 'node:crypto'
import { readFile, symlink, writeFile } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hostDownloadFsDeps,
  downloadPinnedFile,
  type DownloadClientDeps,
  type FetchLike,
} from '../../../src/enrichment/model-download-client.ts'
import type {
  SemanticDownloadSource,
  SemanticModelEntry,
} from '../../../src/enrichment-model-catalog.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const sandbox = createModelSandbox('dsh-transport-arms-')
async function tempRoot(): Promise<string> {
  return await sandbox.root()
}
afterEach(async () => {
  await sandbox.settle()
})

function spec(): SemanticModelEntry {
  return {
    key: 'balanced',
    physicalKey: 'arms',
    label: 'arms',
    physicalModel: 'arms',
    note: 'arms',
    modelId: 'test/arms',
    revision: 'a'.repeat(40),
    dimension: 2,
    maxTokens: 16,
    languages: ['*'],
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [
      { path: 'config.json', bytes: 5, sha256: createHash('sha256').update('alpha').digest('hex') },
    ],
  } as SemanticModelEntry
}

function gateDeps(): DownloadClientDeps {
  return {
    resolver: async () => [{ address: '93.184.216.34', family: 4 as const }],
    dispatcher: () => ({ dispatcher: {}, close: async () => undefined }),
  }
}

describe('hostDownloadFsDeps', () => {
  it('creates a nested parent and writes through an exclusive stream', async () => {
    const root = await tempRoot()
    const nested = join(root, 'a', 'b')
    await hostDownloadFsDeps.mkdir(nested)
    const stream = await hostDownloadFsDeps.openExclusive(join(nested, 'file'))
    await new Promise<void>((resolve, reject) => {
      stream.end(Buffer.from('alpha'), (error?: Error | null) =>
        error ? reject(error) : resolve(),
      )
    })
    expect(await readFile(join(nested, 'file'), 'utf8')).toBe('alpha')
    await expect(hostDownloadFsDeps.openExclusive(join(nested, 'file'))).rejects.toMatchObject({
      code: 'EEXIST',
    })
  })

  it('refuses a symlink planted at a destination parent', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await symlink(outside, join(root, 'link'))
    await expect(hostDownloadFsDeps.mkdir(join(root, 'link', 'child'))).rejects.toThrow(
      /not a (regular )?directory/,
    )
  })

  it('renames and removes an owned file', async () => {
    const root = await tempRoot()
    await hostDownloadFsDeps.mkdir(root)
    await writeFile(join(root, 'a'), 'alpha')
    await hostDownloadFsDeps.rename(join(root, 'a'), join(root, 'b'))
    expect(await readFile(join(root, 'b'), 'utf8')).toBe('alpha')
    await hostDownloadFsDeps.rm(join(root, 'b'))
    await expect(readFile(join(root, 'b'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('downloadPinnedFile abort and discard arms', () => {
  it('preserves the caller reason when cancelled during the body', async () => {
    const root = await tempRoot()
    const reason = new Error('caller stopped')
    const controller = new AbortController()
    const fetch: FetchLike = async () => {
      controller.abort(reason)
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream({
          start(handle) {
            handle.enqueue(new Uint8Array([1]))
            handle.close()
          },
        }),
      }
    }
    await expect(
      downloadPinnedFile({
        model: spec(),
        file: { path: 'config.json', bytes: 5, sha256: 'x'.repeat(64) },
        dir: root,
        sources: ['hf-mirror', 'huggingface'],
        signal: controller.signal,
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toBe(reason)
  })

  it('cancels an error body and falls through to the next mirror', async () => {
    const root = await tempRoot()
    const bytes = Buffer.from('alpha')
    const served: string[] = []
    let cancelled = false
    const fetch: FetchLike = async (url) => {
      served.push(url)
      if (served.length === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          body: new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream({
          start(handle) {
            handle.enqueue(bytes)
            handle.close()
          },
        }),
      }
    }
    const result = await downloadPinnedFile({
      model: spec(),
      file: {
        path: 'config.json',
        bytes: 5,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      dir: root,
      sources: ['hf-mirror', 'huggingface'],
      deps: { ...gateDeps(), fetch },
    })
    expect(result.source).toBe('huggingface')
    expect(cancelled).toBe(true)
  })

  it('does not follow a redirect to an insecure scheme', async () => {
    const root = await tempRoot()
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 302,
      headers: { get: (name) => (name === 'location' ? 'http://evil.example.com/x' : null) },
      body: null,
    })
    await expect(
      downloadPinnedFile({
        model: spec(),
        file: { path: 'config.json', bytes: 5, sha256: 'x'.repeat(64) },
        dir: root,
        sources: ['hf-mirror'],
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toThrow(/insecure HTTP/)
  })
})

const pinnedFile = { path: 'config.json', bytes: 5, sha256: 'x'.repeat(64) }

describe('downloadPinnedFile source and redirect arms', () => {
  it('refuses a redirect target outside the public address gate', async () => {
    const root = await tempRoot()
    const served: string[] = []
    const fetch: FetchLike = async (url) => {
      served.push(String(url))
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => (name === 'location' ? 'https://127.0.0.1/model' : null) },
        body: null,
      }
    }

    await expect(
      downloadPinnedFile({
        model: spec(),
        file: pinnedFile,
        dir: root,
        sources: ['hf-mirror'],
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toThrow(/non-public address/)
    expect(served).toHaveLength(1)
  })

  it('reports an unknown mirror entry without issuing a request', async () => {
    const root = await tempRoot()
    const served: string[] = []
    const fetch: FetchLike = async (url) => {
      served.push(String(url))
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
      }
    }

    await expect(
      downloadPinnedFile({
        model: spec(),
        file: pinnedFile,
        dir: root,
        sources: ['unknown' as unknown as SemanticDownloadSource],
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toThrow(/unknown download source/)
    expect(served).toEqual([])
  })

  it('refuses more than five redirect hops', async () => {
    const root = await tempRoot()
    const served: string[] = []
    const fetch: FetchLike = async (url) => {
      served.push(String(url))
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => (name === 'location' ? 'https://cdn.example.com/loop' : null) },
        body: null,
      }
    }

    await expect(
      downloadPinnedFile({
        model: spec(),
        file: pinnedFile,
        dir: root,
        sources: ['hf-mirror'],
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toThrow(/more than 5 redirect hops/)
    expect(served).toHaveLength(6)
  })

  it('normalizes a non-Error rejection from the transport', async () => {
    const root = await tempRoot()
    const fetch: FetchLike = async () => {
      throw 'socket torn'
    }

    await expect(
      downloadPinnedFile({
        model: spec(),
        file: pinnedFile,
        dir: root,
        sources: ['hf-mirror'],
        deps: { ...gateDeps(), fetch },
      }),
    ).rejects.toThrow(/socket torn/)
  })

  it('reports every mirror failed when no source is listed', async () => {
    const root = await tempRoot()

    await expect(
      downloadPinnedFile({
        model: spec(),
        file: pinnedFile,
        dir: root,
        sources: [],
      }),
    ).rejects.toThrow(/every mirror failed for config.json/)
  })
})
