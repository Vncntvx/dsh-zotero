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

const encoder = new TextEncoder()
const PDF = encoder.encode('%PDF-1.7 payload')
const LIMIT = 1024

function depsOf(overrides: Partial<SourceBytesDeps> & { attachment?: ResolvedAttachment } = {}) {
  const get = vi.fn(async () => ({
    bytes: PDF,
    headers: new Headers({ etag: '"v1"', 'content-length': String(PDF.byteLength) }),
  }))
  const head = vi.fn(async () => ({
    status: 200,
    headers: new Headers({ etag: '"v1"', 'content-length': String(PDF.byteLength) }),
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
    expect(stat).toHaveBeenCalledWith('/tmp/a.pdf')
    expect(readFile).toHaveBeenCalled()
  })

  it('downloads a linked-URL attachment through the client and stamps its headers', async () => {
    const { deps, get } = depsOf({
      attachment: { kind: 'url', url: 'https://example.org/linked.pdf' },
    })
    const result = await obtainSourceBytes(local, LIMIT, deps)
    expect(result.bytes).toBe(PDF)
    expect(result.stamp).toMatchObject({ kind: 'url', url: 'https://example.org/linked.pdf' })
    expect(get).toHaveBeenCalledWith(
      'https://example.org/linked.pdf',
      expect.objectContaining({ method: 'GET', timeoutMs: SOURCE_TRANSFER_TIMEOUT_MS }),
    )
  })

  it('downloads a public URL source through the client', async () => {
    const { deps, get } = depsOf()
    const result = await obtainSourceBytes(url, LIMIT, deps)
    expect(result.bytes).toBe(PDF)
    expect(result.stamp).toMatchObject({ kind: 'url', url: 'https://example.org/a.pdf' })
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
