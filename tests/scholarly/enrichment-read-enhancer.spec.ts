/**
 * The scholarly PDF reader consumes cached enrichment only. Cache misses use
 * the real PDF extractor, faults propagate before downloading, and the extra
 * upload-capable method on the boundary must never be called by a read.
 * @module tests/scholarly/enrichment-read-enhancer
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.ts'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.ts'
import type { ScholarlyHttp } from '../../src/scholarly/transport/http.ts'
import type { FulltextEnhancer, FulltextLookupResult } from '../../src/local/fulltext-enhancer.ts'
import { ZoteroError } from '../../src/errors.ts'
import { createMockHttp } from './fixtures.ts'

const pdfUrl = 'https://example.org/a.pdf'
const pdfSentence = 'Local PDF extraction keeps attention evidence after a cache miss.'
const longText = '# Cached attention analysis\n\n' + 'Detailed attention evidence. '.repeat(30)
let transports: ScholarlyHttp[] = []
let directories: string[] = []

async function storeOf(): Promise<ScholarlyTextStore> {
  const directory = await mkdtemp(join(tmpdir(), 'scholarly-enrichment-'))
  directories.push(directory)
  return new ScholarlyTextStore(directory)
}

afterEach(async () => {
  await Promise.all(transports.map((http) => http.dispose()))
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  transports = []
  directories = []
})

/** A synthetic, valid single-page PDF, so a miss exercises the real extractor. */
function readablePdf(): Uint8Array {
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td\n${Array.from(
    { length: 12 },
    () => `(${pdfSentence}) Tj T*`,
  ).join('\n')}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

function httpOf(body: () => Uint8Array = readablePdf) {
  const fetch = vi.fn(
    async () =>
      new Response(Buffer.from(body()), { headers: { 'content-type': 'application/pdf' } }),
  )
  const http = createMockHttp(fetch)
  transports.push(http)
  return { http, fetch }
}

function enhancerOf(lookup: FulltextEnhancer['lookup']) {
  // This structural object intentionally retains a parse entry from an older
  // service: ordinary PDF reading has no authorization to invoke it.
  return {
    lookup: vi.fn(lookup),
    enhance: vi.fn(async () => {
      throw new Error(
        'ordinary scholarly reading must not upload a document without explicit parse authorization',
      )
    }),
  }
}

function cached(
  text: string,
  generation = '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
): FulltextLookupResult {
  return {
    kind: 'hit',
    text,
    format: 'markdown',
    source: 'MinerU (free)',
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'cached-url-artifact',
      fingerprint: 'b'.repeat(64),
      sourceId: 'a'.repeat(64),
      generation,
    },
    pageCount: 1,
  }
}

describe('PDF cache source revalidation', () => {
  it.each(['memory', 'disk'] as const)(
    'sees an active artifact after an ordinary %s cache read',
    async (tier) => {
      const { http, fetch } = httpOf()
      const store = await storeOf()
      const first = await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store })
      expect(first.text).toContain(pdfSentence)
      const enhancer = enhancerOf(async () => cached(longText))
      const activeStore = tier === 'disk' ? new ScholarlyTextStore(store.root) : store

      const active = await resolveScholarlyFullText(
        { kind: 'url', id: pdfUrl },
        { http, store: activeStore, enhancer },
      )
      expect(active).toMatchObject({ provider: 'mineru', format: 'markdown', text: longText })
      expect(enhancer.lookup).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('sees a reparse immediately and never persists artifact content in the ordinary cache', async () => {
    const { http, fetch } = httpOf()
    const store = await storeOf()
    let text = longText
    let generation = '24e3e1af-1b8e-4da3-933d-0139d6f748bf'
    const enhancer = enhancerOf(async () => cached(text, generation))
    await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store, enhancer })
    text = '# Reparsed artifact\n\nNew attention findings.'
    generation = '75e7251e-d4f1-4d5e-8f53-57c5fa7d0f65'
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: pdfUrl },
      { http, store, enhancer },
    )

    expect(record).toMatchObject({ text, provenance: { generation } })
    const files = await readdir(join(store.root, 'v3'))
    expect(files).toHaveLength(1)
    const disk = await readFile(join(store.root, 'v3', files[0]!), 'utf8')
    expect(disk).not.toContain(longText)
    expect(disk).not.toContain(text)
    expect(enhancer.lookup).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates lookup faults even while a local PDF body is cached', async () => {
    const { http, fetch } = httpOf()
    const store = await storeOf()
    await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store })
    const error = new Error('source index is unreadable')
    const enhancer = enhancerOf(async () => ({ kind: 'fault', error }))

    await expect(
      resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store, enhancer }),
    ).rejects.toBe(error)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('invalidates memory and disk plain text on expiry even if refetch fails', async () => {
    let body = readablePdf()
    const { http, fetch } = httpOf(() => body)
    const store = await storeOf()
    await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store })
    body = new TextEncoder().encode('the source is no longer a PDF')
    const enhancer = enhancerOf(async () => ({ kind: 'miss', reason: 'expired' }))
    await expect(
      resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store, enhancer }),
    ).rejects.toThrow(/not-a-pdf/)
    enhancer.lookup.mockResolvedValue({ kind: 'miss', reason: 'absent' })

    for (const current of [store, new ScholarlyTextStore(store.root)]) {
      await expect(
        resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store: current, enhancer }),
      ).rejects.toThrow(/not-a-pdf/)
    }
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('refetches after an artifact expires and never returns the previous artifact', async () => {
    const { http, fetch } = httpOf()
    const store = await storeOf()
    const enhancer = enhancerOf(async () => cached(longText))
    await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store, enhancer })
    enhancer.lookup.mockResolvedValue({ kind: 'miss', reason: 'expired' })
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: pdfUrl },
      { http, store, enhancer },
    )
    expect(record).toMatchObject({ provider: 'pdf-extract', format: 'text' })
    expect(record.text).toContain(pdfSentence)
    expect(record.text).not.toContain(longText)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses plain text only after a same-source absent lookup', async () => {
    const { http, fetch } = httpOf()
    const store = await storeOf()
    await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, store })
    const enhancer = enhancerOf(async () => ({ kind: 'miss', reason: 'absent' }))
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: pdfUrl },
      { http, store, enhancer },
    )
    expect(record.text).toContain(pdfSentence)
    expect(enhancer.lookup).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps query variants distinct while normalizing URL spelling and fragments', async () => {
    const { http, fetch } = httpOf()
    const store = await storeOf()
    const firstUrl = 'https://EXAMPLE.org:443/a.pdf?copy=one#page=1'
    await resolveScholarlyFullText({ kind: 'url', id: firstUrl }, { http, store })
    const enhancer = enhancerOf(async () => ({ kind: 'miss', reason: 'absent' }))
    const same = await resolveScholarlyFullText(
      { kind: 'url', id: 'https://example.org/a.pdf?copy=one#page=2' },
      { http, store, enhancer },
    )
    expect(same).toMatchObject({ sourceIdentity: 'https://example.org/a.pdf?copy=one' })
    await resolveScholarlyFullText(
      { kind: 'url', id: 'https://example.org/a.pdf?copy=two' },
      { http, store, enhancer },
    )
    expect(enhancer.lookup.mock.calls.map(([input]) => input.source)).toEqual([
      { kind: 'url', url: 'https://example.org/a.pdf?copy=one' },
      { kind: 'url', url: 'https://example.org/a.pdf?copy=two' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('resolveScholarlyFullText with cached enrichment', () => {
  it('uses a lookup hit with MinerU provenance without downloading the PDF', async () => {
    const { http, fetch } = httpOf()
    const enhancer = enhancerOf(async () => cached(longText))
    const signal = new AbortController().signal
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: pdfUrl },
      { http, enhancer, signal },
    )

    expect(record).toMatchObject({
      provider: 'mineru',
      format: 'markdown',
      source: 'MinerU (free)',
      text: longText,
      url: pdfUrl,
      sourceIdentity: pdfUrl,
      provenance: expect.objectContaining({
        sourceId: 'a'.repeat(64),
        generation: '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
      }),
    })
    expect(enhancer.lookup).toHaveBeenCalledExactlyOnceWith(
      { key: pdfUrl, source: { kind: 'url', url: pdfUrl }, contentType: 'application/pdf' },
      signal,
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it.each(['absent', 'expired'] as const)(
    'extracts the PDF locally after an %s cache miss without calling enhance',
    async (reason) => {
      const { http, fetch } = httpOf()
      const enhancer = enhancerOf(async () => ({ kind: 'miss', reason }))
      const record = await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, enhancer })

      expect(record).toMatchObject({ source: 'the PDF at that URL', url: pdfUrl })
      expect(record.text).toContain('[page 1]')
      expect(record.text).toContain(pdfSentence)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(enhancer.lookup).toHaveBeenCalledExactlyOnceWith(
        { key: pdfUrl, source: { kind: 'url', url: pdfUrl }, contentType: 'application/pdf' },
        undefined,
      )
      expect(enhancer.enhance).not.toHaveBeenCalled()
    },
  )

  it.each([
    { name: 'cache validation', error: new Error('cached result invalid') },
    {
      name: 'authorization',
      error: new ZoteroError('token missing', 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED'),
    },
  ])('propagates a $name lookup fault before downloading', async ({ error }) => {
    const { http, fetch } = httpOf()
    const enhancer = enhancerOf(async () => ({ kind: 'fault', error }))

    await expect(
      resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, enhancer }),
    ).rejects.toBe(error)
    expect(fetch).not.toHaveBeenCalled()
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('keeps the local PDF extraction path when no enhancer is supplied', async () => {
    const { http, fetch } = httpOf()
    const record = await resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http })

    expect(record).toMatchObject({ source: 'the PDF at that URL', url: pdfUrl })
    expect(record.text).toContain('[page 1]')
    expect(record.text).toContain(pdfSentence)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains valid short cached output without downloading', async () => {
    const { http, fetch } = httpOf()
    const enhancer = enhancerOf(async () => cached('short'))

    await expect(
      resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, enhancer }),
    ).resolves.toMatchObject({ text: 'short', source: 'MinerU (free)' })
    expect(fetch).not.toHaveBeenCalled()
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('reports a local PDF parse failure after a miss without attempting an upload', async () => {
    // The signature passes the PDF gate, but the real extractor rejects the body.
    const { http, fetch } = httpOf(() => new TextEncoder().encode('%PDF-1.7 not really a pdf'))
    const enhancer = enhancerOf(async () => ({ kind: 'miss', reason: 'absent' }))

    await expect(
      resolveScholarlyFullText({ kind: 'url', id: pdfUrl }, { http, enhancer }),
    ).rejects.toThrow(/did not yield readable PDF text \(parse:/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })
})
