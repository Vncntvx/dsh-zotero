/**
 * Source-byte acquisition and cache probing: caller-supplied bytes win, a
 * local attachment is `stat`ed for the cache and read for a parse, a URL gets
 * a token-free HEAD for the cache and a GET for a parse, and every parse arm
 * validates the PDF signature and the size cap before anything is sent.
 * @module tests/host/enrichment-source-bytes
 */

import { describe, expect, it, vi } from 'vitest'
import {
  obtainSourceBytes,
  probeSource,
  type ResolvedAttachment,
  type SourceBytesDeps,
} from '../../src/enrichment/source-bytes.ts'
import type { MineruClient } from '../../src/enrichment/transport.ts'
import { ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT } from '../../src/errors.ts'
import { HEAD_TIMEOUT_MS, SOURCE_TRANSFER_TIMEOUT_MS } from '../../src/enrichment/limits.ts'
import { deferred } from '../helpers/sync.ts'
import { clientOf } from './support/mineru-transport.ts'

const encoder = new TextEncoder()
const PDF = encoder.encode('%PDF-1.7 payload')
const LIMIT = 1024

function depsOf(overrides: Partial<SourceBytesDeps> & { attachment?: ResolvedAttachment } = {}) {
  const get = vi.fn(async (finalUrl: string) => ({
    bytes: PDF,
    headers: new Headers({ etag: '"v1"', 'content-length': String(PDF.byteLength) }),
    finalUrl,
  }))
  const head = vi.fn(async (finalUrl: string) => ({
    status: 200,
    headers: new Headers({ etag: '"v1"', 'content-length': String(PDF.byteLength) }),
    finalUrl,
  }))
  const stat = vi.fn(async () => ({ size: PDF.byteLength, mtimeMs: 1 }))
  const readFile = vi.fn(async () => PDF)
  const resolveAttachment = vi.fn(
    async () => overrides.attachment ?? { kind: 'file' as const, path: '/tmp/a.pdf' },
  )
  const deps: SourceBytesDeps = {
    resolveAttachment,
    stat,
    readFile,
    client: { get, head } as unknown as MineruClient,
    ...overrides,
  }
  return { deps, get, head, stat, readFile, resolveAttachment }
}

const local = { key: 'local', source: { kind: 'local' as const, attachmentRef: 'r' } }
const url = { key: 'u', source: { kind: 'url' as const, url: 'https://example.org/a.pdf' } }

describe('obtainSourceBytes', () => {
  it('uses caller-supplied bytes and skips every host seam', async () => {
    const { deps, get, resolveAttachment } = depsOf()
    const result = await obtainSourceBytes({ ...local, bytes: PDF }, LIMIT, deps)
    expect(result.bytes).toBe(PDF)
    expect(result.stamp).toMatchObject({ kind: 'bytes' })
    expect(result.urlSource).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
    expect(resolveAttachment).not.toHaveBeenCalled()
  })

  it('reads a local file attachment from disk and stamps its stat', async () => {
    const { deps, stat, readFile } = depsOf({
      attachment: { kind: 'file', path: '/tmp/a.pdf' },
    })
    const result = await obtainSourceBytes(local, LIMIT, deps)
    expect(result.bytes).toBe(PDF)
    expect(result.stamp).toEqual({ kind: 'file', size: PDF.byteLength, mtimeMs: 1 })
    expect(result.urlSource).toBeUndefined()
    expect(stat).toHaveBeenCalledWith('/tmp/a.pdf')
    expect(readFile).toHaveBeenCalled()
  })

  it.each([
    {
      label: 'direct URL',
      input: {
        ...url,
        source: { kind: 'url' as const, url: 'https://example.org/start.pdf?version=1#page=2' },
      },
      attachment: undefined,
    },
    {
      label: 'linked URL',
      input: local,
      attachment: { kind: 'url' as const, url: 'https://example.org/start.pdf?version=1#page=2' },
    },
  ])(
    'records terminal provenance and identical GET/HEAD stamps for a $label',
    async ({ input, attachment }) => {
      const requestedUrl = 'https://example.org/start.pdf?version=1'
      const terminalUrl = 'https://cdn.example/final.pdf?signature=abc'
      const { client, calls } = clientOf(async (request, init) =>
        request === requestedUrl
          ? new Response(null, { status: 302, headers: { location: `${terminalUrl}#page=7` } })
          : new Response(init?.method === 'HEAD' ? null : PDF, {
              headers: { etag: '"v2"', 'content-length': String(PDF.byteLength) },
            }),
      )
      const { deps } = depsOf({ client, ...(attachment === undefined ? {} : { attachment }) })
      const result = await obtainSourceBytes(input, LIMIT, deps)
      expect(result.bytes).toEqual(PDF)
      expect(result.urlSource).toEqual({ requestedUrl, finalUrl: terminalUrl })
      expect(result.stamp).toEqual({
        kind: 'url',
        url: terminalUrl,
        etag: '"v2"',
        contentLength: PDF.byteLength,
      })
      expect(await probeSource(input, LIMIT, deps)).toEqual(result.stamp)
      expect(calls.map(({ url, init }) => [init.method, url])).toEqual([
        ['GET', requestedUrl],
        ['GET', `${terminalUrl}#page=7`],
        ['HEAD', requestedUrl],
        ['HEAD', `${terminalUrl}#page=7`],
      ])
    },
  )

  it('downloads a public URL source through the client', async () => {
    const { deps, get } = depsOf()
    const result = await obtainSourceBytes(url, LIMIT, deps)
    expect(result.bytes).toBe(PDF)
    expect(result.stamp).toMatchObject({ kind: 'url', url: 'https://example.org/a.pdf' })
    expect(result.urlSource).toEqual({ requestedUrl: url.source.url, finalUrl: url.source.url })
    expect(get).toHaveBeenCalledWith(
      'https://example.org/a.pdf',
      expect.objectContaining({ method: 'GET', timeoutMs: SOURCE_TRANSFER_TIMEOUT_MS }),
    )
  })

  it('hashes supplied bytes instead of trusting an older URL stamp', async () => {
    const { deps, get } = depsOf()
    const stamp = { kind: 'url' as const, url: 'https://example.org/a.pdf', etag: '"v1"' }
    const result = await obtainSourceBytes({ ...url, bytes: PDF, sourceStamp: stamp }, LIMIT, deps)
    expect(result.stamp).toEqual(await probeSource({ ...url, bytes: PDF }, LIMIT, deps))
    expect(result.stamp.kind).toBe('bytes')
    expect(get).not.toHaveBeenCalled()
  })

  it('refuses bytes without a PDF signature', async () => {
    const { deps } = depsOf()
    await expect(
      obtainSourceBytes({ ...local, bytes: encoder.encode('html') }, LIMIT, deps),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT })
  })

  it.each([
    { label: 'invalid magic', bytes: encoder.encode('<html>error</html>') },
    { label: 'stream over cap', bytes: encoder.encode(`%PDF-1.7 ${'x'.repeat(LIMIT)}`) },
  ])('validates a downloaded PDF despite a transport success: $label', async ({ bytes }) => {
    const { deps, get } = depsOf()
    get.mockResolvedValue({ bytes, headers: new Headers(), finalUrl: url.source.url })
    await expect(obtainSourceBytes(url, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
  })

  it('refuses file growth beyond the cap after stat', async () => {
    const { deps } = depsOf({
      readFile: async () => encoder.encode(`%PDF-1.7 ${'x'.repeat(LIMIT)}`),
    })
    await expect(obtainSourceBytes(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
  })

  it('refuses a file larger than the byte cap without reading it', async () => {
    const { deps, readFile } = depsOf({
      attachment: { kind: 'file', path: '/tmp/huge.pdf' },
      stat: async () => ({ size: 4096, mtimeMs: 1 }),
    })
    await expect(obtainSourceBytes(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
      message: expect.stringContaining('over the'),
    })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('refuses an attachment with neither a file nor a URL', async () => {
    const { deps } = depsOf({ attachment: { kind: 'file' } })
    await expect(obtainSourceBytes(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
  })

  it('reports a read failure after the file passed the size check', async () => {
    const { deps } = depsOf({
      attachment: { kind: 'file', path: '/tmp/a.pdf' },
      readFile: async () => {
        throw new Error('EIO')
      },
    })
    await expect(obtainSourceBytes(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
      message: expect.stringContaining('could not be read'),
    })
  })

  it('reports an unreadable attachment file', async () => {
    const { deps } = depsOf({
      attachment: { kind: 'file', path: '/tmp/a.pdf' },
      stat: async () => {
        throw new Error('EACCES')
      },
    })
    await expect(obtainSourceBytes(local, LIMIT, deps)).rejects.toMatchObject({
      message: expect.stringContaining('unreadable'),
    })
  })
})

describe('source cancellation', () => {
  it.each([
    ['parse resolve', obtainSourceBytes, local, 'resolve'],
    ['parse stat', obtainSourceBytes, local, 'stat'],
    ['parse read', obtainSourceBytes, local, 'read'],
    ['parse GET', obtainSourceBytes, url, 'GET'],
    ['probe resolve', probeSource, local, 'resolve'],
    ['probe stat', probeSource, local, 'stat'],
    ['probe HEAD', probeSource, url, 'HEAD'],
  ] as const)(
    'awaits owned %s work and preserves caller abort on either settlement',
    async (_label, run, input, blocked) => {
      for (const failure of [undefined, new Error('late I/O failure')]) {
        const entered = deferred()
        const cleanup = deferred()
        const controller = new AbortController()
        const reason = new Error('caller cancelled')
        const boundary = async <T>(name: string, value: T): Promise<T> => {
          if (name !== blocked) return value
          entered.resolve()
          await cleanup.promise
          if (failure !== undefined) throw failure
          return value
        }
        const { deps, get, head } = depsOf({
          resolveAttachment: async () =>
            await boundary('resolve', { kind: 'file', path: '/tmp/a.pdf' }),
          stat: async () => await boundary('stat', { size: PDF.byteLength, mtimeMs: 1 }),
          readFile: async () => await boundary('read', PDF),
        })
        get.mockImplementation(
          async (finalUrl) =>
            await boundary('GET', { bytes: PDF, headers: new Headers(), finalUrl }),
        )
        head.mockImplementation(
          async (finalUrl) =>
            await boundary('HEAD', { status: 200, headers: new Headers(), finalUrl }),
        )
        let settled = false
        const pending = run(input, LIMIT, deps, controller.signal).finally(() => {
          settled = true
        })
        const rejected = expect(pending).rejects.toBe(reason)
        await entered.promise
        controller.abort(reason)
        expect(settled).toBe(false)
        cleanup.resolve()
        await rejected
      }
    },
  )
})

describe('probeSource', () => {
  it('stats a local file without reading it', async () => {
    const { deps, stat, readFile } = depsOf({
      attachment: { kind: 'file', path: '/tmp/a.pdf' },
    })
    await expect(probeSource(local, LIMIT, deps)).resolves.toEqual({
      kind: 'file',
      size: PDF.byteLength,
      mtimeMs: 1,
    })
    expect(stat).toHaveBeenCalledWith('/tmp/a.pdf')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('HEADs a URL with the short timeout and no GET', async () => {
    const { deps, get, head } = depsOf()
    const stamp = await probeSource(url, LIMIT, deps)
    expect(stamp).toMatchObject({ kind: 'url', url: 'https://example.org/a.pdf' })
    expect(head).toHaveBeenCalledWith(
      'https://example.org/a.pdf',
      expect.objectContaining({ method: 'HEAD', timeoutMs: HEAD_TIMEOUT_MS }),
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('propagates a failed HEAD instead of validating stale content', async () => {
    const { deps } = depsOf({
      client: {
        head: async () => {
          throw new Error('offline')
        },
      } as unknown as MineruClient,
    })
    await expect(probeSource(url, LIMIT, deps)).rejects.toThrow('offline')
  })

  it('hashes supplied bytes without touching a host seam', async () => {
    const { deps, get, resolveAttachment } = depsOf()
    const stamp = await probeSource({ ...local, bytes: PDF }, LIMIT, deps)
    expect(stamp).toMatchObject({ kind: 'bytes' })
    expect(get).not.toHaveBeenCalled()
    expect(resolveAttachment).not.toHaveBeenCalled()
  })

  it('refuses a local file over the cap while probing', async () => {
    const { deps } = depsOf({
      attachment: { kind: 'file', path: '/tmp/huge.pdf' },
      stat: async () => ({ size: 4096, mtimeMs: 1 }),
    })
    await expect(probeSource(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
  })

  it('returns a caller-supplied stamp without resolving the source', async () => {
    const { deps, resolveAttachment } = depsOf()
    const stamp = { kind: 'file' as const, size: 1, mtimeMs: 2 }
    await expect(probeSource({ ...local, sourceStamp: stamp }, LIMIT, deps)).resolves.toBe(stamp)
    expect(resolveAttachment).not.toHaveBeenCalled()
  })

  it('HEADs a linked-URL attachment while probing', async () => {
    const { deps, head } = depsOf({
      attachment: { kind: 'url', url: 'https://example.org/linked.pdf' },
    })
    await expect(probeSource(local, LIMIT, deps)).resolves.toMatchObject({
      kind: 'url',
      url: 'https://example.org/linked.pdf',
    })
    expect(head).toHaveBeenCalledWith(
      'https://example.org/linked.pdf',
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it('refuses a probe attachment with neither a file nor a URL', async () => {
    const { deps } = depsOf({ attachment: { kind: 'file' } })
    await expect(probeSource(local, LIMIT, deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
  })

  it('refuses caller-supplied bytes over the cap', async () => {
    const { deps } = depsOf()
    await expect(
      obtainSourceBytes({ ...local, bytes: new Uint8Array(LIMIT + 1) }, LIMIT, deps),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT })
  })

  it('keeps only non-empty URL validators', async () => {
    const { deps } = depsOf({
      client: {
        head: async () => ({
          status: 200,
          headers: new Headers({ etag: '   ', 'last-modified': 'Mon' }),
          finalUrl: url.source.url,
        }),
      } as unknown as MineruClient,
    })
    await expect(probeSource(url, LIMIT, deps)).resolves.toEqual({
      kind: 'url',
      url: 'https://example.org/a.pdf',
      lastModified: 'Mon',
    })
  })
})
