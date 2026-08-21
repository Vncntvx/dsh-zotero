/**
 * Opt-in integration tests against a real Zotero Local API at
 * `127.0.0.1:23119`. Skipped unless `ZOTERO_INTEGRATION=1` is set, because
 * they assert live-library behavior the mock server cannot prove: real
 * item JSON, real Server-ID headers (Zotero 10+), real citation HTML, the
 * `/children` and `/fulltext` endpoints, real browse pagination on
 * `/searches` and `/tags`, and the parent-mediated collection membership
 * of child notes.
 *
 *   ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
 *
 * Zotero must be running with the local API enabled. An empty library is
 * tolerated for browse-only checks; item-dependent checks record a pass
 * with a note instead of failing on a fresh library. The child-note
 * membership check needs a "collection → item → child note" arrangement;
 * when the library has none, it prints how to build one and passes.
 * @module tests/integration/zotero.integration
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { ZoteroHttpClient } from '../../src/http-client.js'
import { LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import type { ZoteroItemDetail } from '../../src/types.js'

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
    if (status.serverId === undefined) {
      // Zotero 9 serves no identity header; provenance just stays off.
      console.log('[integration] no Zotero-Server-ID header (Zotero 9?)')
    } else {
      expect(status.serverId.length).toBeGreaterThan(0)
    }
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

  it('browses itemTypes globally', async () => {
    const result = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 50 })
    expect(result.kind).toBe('itemTypes')
    expect(result.total).toBeGreaterThan(0)
    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items as { itemType: string }[]) {
      expect(item.itemType).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
    }
  })

  it('browses tags through the server-side q + pagination window', async () => {
    const first = await provider.browse({ kind: 'tags', offset: 0, limit: 5 })
    expect(first.total).toBeGreaterThanOrEqual(first.returned)
    if (first.total === 0) {
      console.log('[integration] library has no tags; skipping tag browse checks')
      return
    }
    expect(first.returned).toBe(Math.min(5, first.total))
    if (first.total > first.returned) {
      expect(first.nextOffset).toBe(first.returned)
      const second = await provider.browse({ kind: 'tags', offset: first.nextOffset!, limit: 5 })
      expect(second.offset).toBe(first.nextOffset)
      expect(second.returned).toBe(Math.min(5, second.total - second.offset))
      // Tag names are not unique (same name with different types coexist),
      // so pages are checked by arithmetic, not by name disjointness.
    }
  })

  it('browses collections with coherent breadcrumbs and paginates the snapshot', async () => {
    const first = await provider.browse({ kind: 'collections', offset: 0, limit: 5 })
    if (first.total === 0) {
      console.log('[integration] library has no collections; skipping collection browse checks')
      return
    }
    for (const item of first.items as {
      ref: string
      name: string
      parentRef?: string
      path: string[]
      depth: number
    }[]) {
      expect(item.path.length).toBeGreaterThan(0)
      expect(item.depth).toBe(item.path.length - 1)
      expect(item.path[item.path.length - 1]).toBe(item.name)
      // Top-level pages carry top-level collections only.
      expect(item.depth).toBe(0)
    }
    if (first.nextOffset === undefined) return
    const second = await provider.browse({
      kind: 'collections',
      offset: first.nextOffset,
      limit: 5,
    })
    const firstRefs = new Set((first.items as unknown as { ref: string }[]).map((item) => item.ref))
    for (const item of second.items as unknown as { ref: string }[]) {
      expect(firstRefs.has(item.ref)).toBe(false)
    }
  })

  it('navigates into a collection and lists its children with real breadcrumbs', async () => {
    const top = await provider.browse({ kind: 'collections', offset: 0, limit: 5 })
    if (top.total === 0) {
      console.log('[integration] library has no collections; skipping child navigation')
      return
    }
    const parent = top.items[0] as unknown as { ref: string; name: string; depth: number }
    if (parent.depth !== 0) {
      console.log('[integration] first browse page held no top-level collection; skipping')
      return
    }
    const children = await provider.browse({
      kind: 'collections',
      parentRef: parent.ref,
      offset: 0,
      limit: 10,
    })
    for (const item of children.items as unknown as {
      name: string
      path: string[]
      parentRef?: string
    }[]) {
      expect(item.path[0]).toBeDefined()
      expect(item.path[item.path.length - 1]).toBe(item.name)
      if (item.path.length > 1) expect(item.parentRef).toBeDefined()
    }
  })

  it('explores an item graph through children with attachment-nested annotations', async () => {
    const search = await provider.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 5,
    })
    for (const hit of search.items.slice(0, 3)) {
      const graph = await provider.children({
        ref: parseRef(hit.ref),
        include: new Set(['notes', 'attachments', 'annotations']),
      })
      expect(graph.itemType).toBeDefined()
      if (graph.annotations !== undefined) {
        for (const annotation of graph.annotations.items) {
          // Annotations are provenance-linked to their PDF, not to the paper.
          expect(annotation.ref).toContain('/annotation/')
        }
      }
      if (graph.attachments !== undefined) {
        const pdf = graph.attachments.items.find(
          (attachment) => attachment.contentType === 'application/pdf',
        )
        if (pdf !== undefined) {
          const nested = await provider.children({
            ref: parseRef(pdf.ref),
            include: new Set(['annotations']),
          })
          expect(nested.itemType).toBe('attachment')
        }
      }
    }
  })

  it('takes a changes baseline reading and diffs from it', async () => {
    const baseline = await provider.changes({})
    expect(baseline.toVersion).toBeDefined()
    expect(Object.keys(baseline.changed)).toHaveLength(0)
    const diff = await provider.changes({ since: baseline.toVersion! })
    expect(diff.fromVersion).toBe(baseline.toVersion!)
    expect(diff.toVersion).toBeGreaterThanOrEqual(baseline.toVersion!)
    // A same-version diff is empty but well-formed.
    expect(Array.isArray(diff.changed.items)).toBe(true)
  })

  it('browses saved searches through the server-side pagination window', async () => {
    const result = await provider.browse({ kind: 'savedSearches', offset: 0, limit: 10 })
    expect(result.total).toBeGreaterThanOrEqual(result.returned)
    if (result.total === 0) {
      console.log('[integration] library has no saved searches; skipping saved-search checks')
      return
    }
    for (const item of result.items as { ref: string; name: string; conditions?: unknown }[]) {
      expect(item.ref).toMatch(/^zotero:\/\/user\/0\/search\/[A-Z0-9]{8}/)
      expect(item.name).toBeDefined()
    }
  })

  it('reads a group library end-to-end when one exists', async () => {
    const libraries = await provider.browse({ kind: 'libraries', offset: 0, limit: 50 })
    const group = (
      libraries.items as { library: { type: string; id: number }; name: string }[]
    ).find((item) => item.library.type === 'group')
    if (group === undefined) {
      console.log('[integration] no group libraries; skipping group read checks')
      return
    }
    const search = await provider.search({
      scope: { kind: 'library' },
      library: { type: 'group', id: group.library.id },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 3,
    })
    expect(search.scope).toMatchObject({ kind: 'library', library: { id: group.library.id } })
    for (const item of search.items) {
      expect(item.ref).toMatch(new RegExp(`^zotero://group/${group.library.id}/item/[A-Z0-9]{8}`))
    }
    if (search.items.length > 0) {
      const detail = await provider.getItem({
        ref: parseRef(search.items[0]!.ref),
        include: new Set(),
      })
      expect(detail.ref).toBe(search.items[0]!.ref)
    }
  })

  it('finds a child note through its parent collection (membership regression)', async () => {
    // The mock suite cannot prove this against real Zotero: child notes carry
    // no `collections` of their own, so a collection-scope body scan must
    // resolve membership through the parent item. Fixture discovery walks
    // the same endpoints the provider's scan uses (notes listing, then the
    // parent item) instead of guessing from recent top items.
    const client = new ZoteroHttpClient({
      baseUrl: BASE_URL,
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024 * 1024,
    })
    const notes = await client.getJson<unknown>(
      'users/0/items',
      new URLSearchParams([
        ['itemType', 'note'],
        ['limit', '100'],
      ]),
    )
    const rows = Array.isArray(notes.json) ? notes.json : []
    let noteKey: string | undefined
    let parentKey: string | undefined
    let token: string | undefined
    for (const row of rows) {
      const record = row as { key?: string; data?: { parentItem?: string; note?: string } }
      if (record.key === undefined || record.data?.parentItem === undefined) continue
      const body = String(record.data.note ?? '').replace(/<[^>]*>/g, ' ')
      const ascii = body.match(/[A-Za-z]{5,}/)
      const cjk = body.match(/[\u4e00-\u9fff]{2}/)
      const candidate = ascii?.[0]?.toLowerCase() ?? cjk?.[0]
      if (candidate === undefined) continue
      noteKey = record.key
      parentKey = record.data.parentItem
      token = candidate
      break
    }
    if (noteKey === undefined || parentKey === undefined || token === undefined) {
      console.log(
        '[integration] no child note with a searchable body found; to exercise this ' +
          'check, add a child note with text to an item inside a collection and rerun',
      )
      return
    }
    const parent = await client.getJson<unknown>(`users/0/items/${parentKey}`)
    const collections = (
      (parent.json as { data?: { collections?: unknown[] } })?.data?.collections ?? []
    ).filter((entry): entry is string => typeof entry === 'string')
    if (collections.length === 0) {
      console.log(
        `[integration] parent ${parentKey} of note ${noteKey} sits in no collection; skipping`,
      )
      return
    }
    const result = await provider.search({
      scope: { kind: 'collection', refOrName: `zotero://user/0/collection/${collections[0]}` },
      mode: 'metadata',
      query: token,
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 20,
    })
    expect(result.scope).toMatchObject({ kind: 'collection' })
    expect(result.returned).toBe(result.items.length)
    // The membership regression itself: the child note (whose own
    // `collections` are empty) must surface via the parent resolution.
    const supplementKeys = new Set(
      (result.supplemental?.items ?? []).map((item) => parseRef(item.ref).key),
    )
    expect(supplementKeys.has(noteKey)).toBe(true)
  })
})
