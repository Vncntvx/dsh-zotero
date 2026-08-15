/**
 * Opt-in integration tests against a real Zotero Local API at
 * `127.0.0.1:23119`. Skipped unless `ZOTERO_INTEGRATION=1` is set, because
 * they assert live-library behavior the mock server cannot prove: real
 * item JSON, real Server-ID headers (Zotero 10+), real citation HTML, and
 * the `/children` and `/fulltext` endpoints.
 *
 *   ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
 *
 * Zotero must be running with the local API enabled. An empty library is
 * tolerated for browse-only checks; item-dependent checks record a pass
 * with a note instead of failing on a fresh library.
 * @module tests/integration/zotero.integration
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { ZoteroHttpClient } from '../../src/http-client.js'
import { LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'

const BASE_URL = process.env.ZOTERO_BASE_URL ?? 'http://127.0.0.1:23119/api'

let provider: LocalApiProvider
let firstItemRef: string | undefined

describe.runIf(process.env.ZOTERO_INTEGRATION === '1')('live Zotero local API', () => {
  beforeAll(() => {
    provider = new LocalApiProvider(
      new ZoteroHttpClient({
        baseUrl: BASE_URL,
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024 * 1024,
      }),
      {
        maxNoteScanRecords: 200,
        maxDetailChars: 3000,
        maxNoteBodyChars: 30_000,
        maxNoteChars: 2000,
        maxNoteRecords: 50,
        maxAnnotationRecords: 100,
        fulltextChunkWords: 200,
        maxEvidenceChars: 6000,
        maxEvidencePassages: 4,
        maxFulltextChars: 250_000,
        maxExportChars: 1_000_000,
        defaultStyle: 'apa',
        defaultLocale: 'en-US',
      },
    )
  })

  it('reports a connected status with API version 3', async () => {
    const status = await provider.status()
    expect(status).toEqual(
      expect.objectContaining({
        providerId: 'local',
        connected: true,
        apiVersion: '3',
        diagnosis: 'ok',
      }),
    )
  })

  it('browses the library and yields valid item refs', async () => {
    const result = await provider.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 3,
    })
    expect(result.total).toBeGreaterThanOrEqual(result.returned)
    expect(result.items).toHaveLength(result.returned)
    for (const item of result.items) {
      expect(item.ref).toMatch(/^zotero:\/\/user\/0\/item\/[A-Z0-9]{8}/)
      expect(parseRef(item.ref).kind).toBe('item')
    }
    firstItemRef = result.items[0]?.ref
  })

  it('reads the first hit back through getItem', async () => {
    if (firstItemRef === undefined) {
      console.log('[integration] library has no items; skipping getItem check')
      return
    }
    const detail = await provider.getItem({ ref: parseRef(firstItemRef), include: new Set() })
    expect(detail.ref).toMatch(/^zotero:\/\/user\/0\/item\/[A-Z0-9]{8}/)
    expect(detail.itemType).not.toBe('')
    expect(detail.children.total).toBeGreaterThanOrEqual(0)
  })

  it('exports a citation for the first hit', async () => {
    if (firstItemRef === undefined) {
      console.log('[integration] library has no items; skipping export check')
      return
    }
    const result = await provider.export({ refs: [parseRef(firstItemRef)], format: 'citation' })
    if (result.format !== 'citation') throw new Error('unreachable')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]!.ref).toBe(firstItemRef)
    expect(result.citations[0]!.text.length).toBeGreaterThan(0)
  })

  it('gathers abstract evidence through retrieve', async () => {
    if (firstItemRef === undefined) {
      console.log('[integration] library has no items; skipping retrieve check')
      return
    }
    const result = await provider.retrieve({
      ref: parseRef(firstItemRef),
      query: 'a',
      sources: ['abstract'],
      passages: 1,
    })
    expect(result.ref).toMatch(/^zotero:\/\/user\/0\/item\/[A-Z0-9]{8}/)
    expect(Array.isArray(result.evidence)).toBe(true)
  })
})
