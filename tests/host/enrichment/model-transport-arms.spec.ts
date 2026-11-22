/**
 * The download client's real filesystem seams and its abort/discard arms.
 * These are host-runtime paths that the scripted-fetch unit specs do not reach.
 * @module tests/host/enrichment/model-transport-arms
 */

import { createHash } from 'node:crypto'
import { readFile, symlink, writeFile } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
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

/** Proxy variables the harness policy reads, restored after every test. */
const proxyEnvNames = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
  'all_proxy',
  'ALL_PROXY',
  'NODE_USE_ENV_PROXY',
] as const
const proxyEnvSnapshot: Record<string, string | undefined> = {}
const installedDisposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of installedDisposers.splice(0)) await dispose()
  for (const name of proxyEnvNames) {
    const value = proxyEnvSnapshot[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    delete proxyEnvSnapshot[name]
  }
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
      /destination parent is not a directory/,
    )
  })

  it('refuses a regular file sitting at the destination parent', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'file'), 'not a directory')
    await expect(hostDownloadFsDeps.mkdir(join(root, 'file'))).rejects.toThrow(
      /destination parent is not a directory/,
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

  it('sends a proxied egress through the route dispatcher without pinning addresses', async () => {
    const root = await tempRoot()
    const bytes = Buffer.from('alpha')
    // A proxied route skips the DNS seam entirely: the proxy performs it. The
    // policy dispatcher is shared and must never be closed by the transfer.
    const resolver = vi.fn(async () => {
      throw new Error('a proxied download must not resolve addresses')
    })
    const dispatcher = vi.fn(() => {
      throw new Error('a proxied download must not build a pinned dispatcher')
    })
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        start(handle) {
          handle.enqueue(new Uint8Array(bytes))
          handle.close()
        },
      }),
    })
    for (const name of proxyEnvNames) proxyEnvSnapshot[name] = process.env[name]
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9/'
    installedDisposers.push(
      await installProxyFromEnvironment(
        {
          get: (name) =>
            process.env[name] === undefined ? undefined : { value: process.env[name] },
        },
        () => undefined,
      ),
    )
    const result = await downloadPinnedFile({
      model: spec(),
      file: {
        path: 'config.json',
        bytes: 5,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      dir: root,
      sources: ['hf-mirror'],
      deps: {
        fetch,
        resolver: resolver as unknown as DownloadClientDeps['resolver'],
        dispatcher: dispatcher as unknown as DownloadClientDeps['dispatcher'],
      },
    })
    expect(result.source).toBe('hf-mirror')
    expect(resolver).not.toHaveBeenCalled()
    expect(dispatcher).not.toHaveBeenCalled()
  })
})
