/**
 * The scholarly PDF branch with an optional enhancer: a cache `lookup` hit
 * returns without downloading, `ok` short-circuits with MinerU provenance,
 * `fatal` propagates, and `fallback`/short text keeps the local extraction
 * path.
 * @module tests/scholarly/parsing-read-enhancer
 */

import { describe, expect, it, vi } from 'vitest'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.ts'
import type { ScholarlyHttp } from '../../src/scholarly/transport/http.ts'
import type { FulltextEnhancer } from '../../src/local/fulltext-enhancer.ts'
import { ZoteroError } from '../../src/errors.ts'

/**
 * A PDF header plus junk: `extractPdfText` will fail, proving the local arm ran.
 * Encoded per call because the PDF parser may detach the transferred buffer.
 */
function pdfHeaderOnly(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7 not really a pdf')
}

function httpOf(): { http: ScholarlyHttp; bytes: ReturnType<typeof vi.fn> } {
  const bytes = vi.fn(async () => pdfHeaderOnly())
  const http = {
    bytes,
    text: async () => {
      throw new Error('not used')
    },
    json: async () => {
      throw new Error('not used')
    },
  } as unknown as ScholarlyHttp
  return { http, bytes }
}

const longText = '# Enhanced body long enough to pass the length check '.repeat(20)

function enhancerOf(
  enhance: FulltextEnhancer['enhance'],
  lookup: FulltextEnhancer['lookup'] = async () => ({ outcome: undefined }),
): FulltextEnhancer {
  return { lookup, enhance }
}

describe('resolveScholarlyFullText with an enhancer', () => {
  it('uses a lookup hit without downloading the PDF', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(
      async () => {
        throw new Error('enhance should not run on a lookup hit')
      },
      async () => ({
        outcome: { kind: 'ok', text: longText, source: 'MinerU (free)' },
        stamp: { kind: 'url', url: 'https://example.org/a.pdf', etag: '"v1"' },
      }),
    )
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: 'https://example.org/a.pdf' },
      { http, enhancer },
    )
    expect(record.source).toBe('MinerU (free)')
    expect(record.text).toBe(longText)
    expect(bytes).not.toHaveBeenCalled()
  })

  it('uses the enhanced text and records MinerU provenance after a miss', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(async () => ({
      kind: 'ok',
      text: longText,
      source: 'MinerU (free)',
    }))
    const record = await resolveScholarlyFullText(
      { kind: 'url', id: 'https://example.org/a.pdf' },
      { http, enhancer },
    )
    expect(record.source).toBe('MinerU (free)')
    expect(record.text).toContain('# Enhanced body')
    expect(bytes).toHaveBeenCalledTimes(1)
  })

  it('passes the lookup stamp to enhance after a miss', async () => {
    const { http } = httpOf()
    const stamp = {
      kind: 'url' as const,
      url: 'https://example.org/a.pdf',
      etag: '"v1"',
    }
    const seen: Array<unknown> = []
    const enhancer = enhancerOf(
      async (input) => {
        seen.push(input.sourceStamp)
        return { kind: 'ok', text: longText, source: 'MinerU (free)' }
      },
      async () => ({ outcome: undefined, stamp }),
    )
    await resolveScholarlyFullText(
      { kind: 'url', id: 'https://example.org/a.pdf' },
      { http, enhancer },
    )
    expect(seen).toEqual([stamp])
  })

  it('propagates a fatal lookup failure without downloading', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(
      async () => {
        throw new Error('enhance should not run')
      },
      async () => ({
        outcome: {
          kind: 'fatal',
          error: new ZoteroError('token missing', 'ZOTERO_PARSING_CREDENTIAL_UNRESOLVED'),
        },
      }),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_PARSING_CREDENTIAL_UNRESOLVED' })
    expect(bytes).not.toHaveBeenCalled()
  })

  it('propagates a fatal enhance failure', async () => {
    const { http } = httpOf()
    const enhancer = enhancerOf(async () => ({
      kind: 'fatal',
      error: new ZoteroError('token missing', 'ZOTERO_PARSING_CREDENTIAL_UNRESOLVED'),
    }))
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_PARSING_CREDENTIAL_UNRESOLVED' })
  })

  it('falls back to local extraction when the enhancer declines', async () => {
    const { http } = httpOf()
    const enhancer = enhancerOf(async () => ({
      kind: 'fallback',
      reason: 'MinerU unavailable',
    }))
    // The bytes carry a PDF header but no extractable text, so the local arm
    // runs and reports its own classified failure.
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toThrow(/did not yield readable PDF text/)
  })

  it('keeps the original path when no enhancer is supplied', async () => {
    const { http } = httpOf()
    await expect(
      resolveScholarlyFullText({ kind: 'url', id: 'https://example.org/a.pdf' }, { http }),
    ).rejects.toThrow(/did not yield readable PDF text/)
  })

  it('tries local extraction when the enhanced body is too short', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(async () => ({ kind: 'ok', text: 'short' }))
    // The fake PDF is invalid, so the local extractor reports its own parse
    // failure; reaching it proves the short enhanced text did not short-circuit.
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toThrow(/\(parse:/)
    expect(bytes).toHaveBeenCalledTimes(1)
  })

  it('downloads and tries local extraction when a cached lookup is short', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(
      async () => {
        throw new Error('enhance should not run after a settled lookup')
      },
      async () => ({
        outcome: { kind: 'ok', text: 'short' },
        stamp: { kind: 'url', url: 'https://example.org/a.pdf' },
      }),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toThrow(/\(parse:/)
    expect(bytes).toHaveBeenCalledTimes(1)
  })

  it('downloads and tries local extraction when lookup declines with a reason', async () => {
    const { http, bytes } = httpOf()
    const enhancer = enhancerOf(
      async () => {
        throw new Error('enhance should not run after a settled lookup')
      },
      async () => ({
        outcome: { kind: 'fallback', reason: 'cached text too short' },
        stamp: { kind: 'url', url: 'https://example.org/a.pdf' },
      }),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.org/a.pdf' },
        { http, enhancer },
      ),
    ).rejects.toThrow(/\(parse:/)
    expect(bytes).toHaveBeenCalledTimes(1)
  })
})
