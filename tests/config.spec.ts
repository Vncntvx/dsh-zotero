import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies schema defaults for an empty config', () => {
    expect(resolveConfig({})).toEqual({
      baseUrl: 'http://127.0.0.1:23119/api',
      provider: 'local',
      timeoutMs: 5000,
      maxSearchResults: 20,
      maxNoteScanRecords: 200,
      maxEvidenceChars: 6000,
      maxEvidencePassages: 4,
      maxDetailChars: 3000,
      maxNoteBodyChars: 30_000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
      fulltextChunkWords: 200,
      maxFulltextChars: 250_000,
      maxResponseBytes: 16 * 1024 * 1024,
      maxExportChars: 1_000_000,
      maxExportRefs: 50,
      defaultStyle: 'apa',
      defaultLocale: 'en-US',
      webEnabled: true,
    })
  })

  it('honors explicit values', () => {
    expect(
      resolveConfig({
        timeoutMs: 900,
        maxExportChars: 42,
        defaultStyle: 'chicago-note-bibliography',
        maxNoteChars: 99,
        maxNoteRecords: 3,
        maxAnnotationRecords: 7,
        fulltextChunkWords: 12,
        maxNoteBodyChars: 123,
        maxNoteScanRecords: 9,
        maxExportRefs: 7,
      }),
    ).toMatchObject({
      timeoutMs: 900,
      maxExportChars: 42,
      defaultStyle: 'chicago-note-bibliography',
      maxNoteChars: 99,
      maxNoteRecords: 3,
      maxAnnotationRecords: 7,
      fulltextChunkWords: 12,
      maxNoteBodyChars: 123,
      maxNoteScanRecords: 9,
      maxExportRefs: 7,
    })
  })

  it('accepts loopback base URLs over http', () => {
    expect(resolveConfig({ baseUrl: 'http://127.0.0.1:23119/api' }).baseUrl).toBe(
      'http://127.0.0.1:23119/api',
    )
    // localhost is pinned to the IPv4 loopback literal, so a hosts-file
    // change after validation cannot redirect the API calls.
    expect(resolveConfig({ baseUrl: 'http://localhost:1234/api' }).baseUrl).toBe(
      'http://127.0.0.1:1234/api',
    )
    expect(resolveConfig({ baseUrl: 'http://[::1]:23119/api' }).baseUrl).toBe(
      'http://[::1]:23119/api',
    )
  })

  it('rejects base URLs that cannot parse', () => {
    expect(() => resolveConfig({ baseUrl: 'not a url' })).toThrowError(/baseUrl/)
  })

  it('rejects https base URLs (the Local API is plain loopback HTTP)', () => {
    expect(() => resolveConfig({ baseUrl: 'https://127.0.0.1:23119/api' })).toThrowError(/http:/)
  })

  it('rejects base URLs carrying credentials', () => {
    expect(() => resolveConfig({ baseUrl: 'http://user:pass@127.0.0.1:23119/api' })).toThrowError(
      /credentials/,
    )
  })

  it('rejects base URLs carrying a query string or fragment', () => {
    expect(() => resolveConfig({ baseUrl: 'http://127.0.0.1:23119/api?x=1' })).toThrowError(/query/)
    expect(() => resolveConfig({ baseUrl: 'http://127.0.0.1:23119/api#frag' })).toThrowError(
      /query/,
    )
  })

  it('rejects non-loopback hosts so the plugin cannot SSRF internal hosts', () => {
    expect(() => resolveConfig({ baseUrl: 'http://evil.example.com/api' })).toThrowError(/loopback/)
    expect(() => resolveConfig({ baseUrl: 'http://10.0.0.7:23119/api' })).toThrowError(/loopback/)
    expect(() => resolveConfig({ baseUrl: 'http://169.254.169.254/latest' })).toThrowError(
      /loopback/,
    )
  })

  it('rejects non-positive timeouts', () => {
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: Number.NaN })).toThrowError(/timeoutMs/)
  })

  it('rejects non-finite or non-integer limits', () => {
    expect(() => resolveConfig({ maxSearchResults: 0 })).toThrowError(/maxSearchResults/)
    expect(() => resolveConfig({ maxEvidenceChars: 1.5 })).toThrowError(/maxEvidenceChars/)
    expect(() => resolveConfig({ maxResponseBytes: -3 })).toThrowError(/maxResponseBytes/)
    expect(() => resolveConfig({ maxExportChars: Number.NaN })).toThrowError(/maxExportChars/)
    expect(() => resolveConfig({ maxFulltextChars: 0 })).toThrowError(/maxFulltextChars/)
    expect(() => resolveConfig({ maxNoteChars: 0 })).toThrowError(/maxNoteChars/)
    expect(() => resolveConfig({ maxNoteBodyChars: -1 })).toThrowError(/maxNoteBodyChars/)
    expect(() => resolveConfig({ maxNoteScanRecords: 0 })).toThrowError(/maxNoteScanRecords/)
    expect(() => resolveConfig({ maxExportRefs: 1.5 })).toThrowError(/maxExportRefs/)
    expect(() => resolveConfig({ maxExportRefs: -2 })).toThrowError(/maxExportRefs/)
    expect(() => resolveConfig({ maxNoteRecords: 1.5 })).toThrowError(/maxNoteRecords/)
    expect(() => resolveConfig({ maxAnnotationRecords: -2 })).toThrowError(/maxAnnotationRecords/)
    expect(() => resolveConfig({ fulltextChunkWords: 0 })).toThrowError(/fulltextChunkWords/)
  })

  it('rejects empty provider and style strings', () => {
    expect(() => resolveConfig({ provider: '' })).toThrowError(/provider/)
    expect(() => resolveConfig({ defaultStyle: '  ' })).toThrowError(/defaultStyle/)
  })
})
