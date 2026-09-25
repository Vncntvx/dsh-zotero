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
import { LocalApiProvider } from '../../src/local/provider.js'
import { parseRef } from '../../src/refs.js'
import { zoteroError } from '../helpers/provider-harness.js'
import type { ZoteroItemDetail } from '../../src/types.js'

const BASE_URL = process.env.ZOTERO_BASE_URL ?? 'http://127.0.0.1:23119/api'

/** A keepable one-line summary of a retrieve attempt: code plus a short reason. */
function describeOutcome(result: unknown): string {
  if (!(result instanceof Error)) return 'read succeeded'
  const code = (result as { code?: string }).code ?? result.name
  return `${code}: ${result.message.slice(0, 120)}`
}

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
        maxBrowseResults: 50,
        maxChangesResults: 50,
      },
    )
  })

  it('reports a connected status with API version 3 and the answering build', async () => {
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
      // A build that serves no identity header: provenance just stays off.
      console.log('[integration] no Zotero-Server-ID header; provenance stays off')
    } else {
      expect(status.serverId.length).toBeGreaterThan(0)
    }
    // The API and schema versions are the same on every API-v3 build, so the
    // build header is the only fact that names which Zotero is answering.
    if (status.zoteroVersion === undefined) {
      console.log('[integration] no X-Zotero-Version header; the build stays unnamed')
    } else {
      console.log(`[integration] answering Zotero build: ${status.zoteroVersion}`)
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

  it('proves a specified attachment belongs to the item it is read for', async () => {
    // Two real items that each have an attachment: naming one item's file
    // while reading another is exactly the false attribution the identity
    // proof exists to stop, and only a live library has same-key neighbours
    // from other items to try.
    const candidates: { ref: string; attachmentRef: string }[] = []
    for (let offset = 0; offset < 60 && candidates.length < 2; offset += 20) {
      const page = await provider.search({
        scope: { kind: 'library' },
        mode: 'metadata',
        sort: 'dateModified',
        direction: 'desc',
        offset,
        limit: 20,
      })
      for (const item of page.items) {
        if (item.bestAttachmentRef === undefined) continue
        candidates.push({ ref: item.ref, attachmentRef: item.bestAttachmentRef })
        if (candidates.length === 2) break
      }
    }
    if (candidates.length < 2) {
      console.log('[integration] fewer than two items with attachments; skipping ownership check')
      return
    }
    const [mine, theirs] = candidates as [
      { ref: string; attachmentRef: string },
      { ref: string; attachmentRef: string },
    ]
    const attempt = async (item: { ref: string }, attachment: { attachmentRef: string }) => {
      try {
        return await provider.retrieve({
          ref: parseRef(item.ref),
          query: 'the',
          sources: ['fulltext'],
          passages: 1,
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef(attachment.attachmentRef)],
        })
      } catch (error) {
        return error
      }
    }
    const verdicts = [
      { label: 'own', result: await attempt(mine, mine) },
      { label: 'foreign', result: await attempt(mine, theirs) },
      { label: 'swapped', result: await attempt(theirs, mine) },
    ]
    for (const { label, result } of verdicts) {
      console.log(`[integration] ownership ${label}: ${describeOutcome(result)}`)
    }
    // A file that is not this item's child is refused, in both directions.
    for (const { label, result } of verdicts) {
      if (label === 'own') continue
      expect(result).toBeInstanceOf(Error)
      expect((result as { code?: string }).code).toBe('ZOTERO_INVALID_ARGUMENT')
      expect((result as Error).message).toMatch(/attached to item|top-level attachment/)
    }
  })

  it('accounts for each full-text source it considered', async () => {
    const page = await provider.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 20,
    })
    const withAttachment = page.items.find((item) => item.bestAttachmentRef !== undefined)
    if (withAttachment === undefined) {
      console.log('[integration] no item with an attachment; skipping per-source accounting check')
      return
    }
    const result = await provider.retrieve({
      ref: parseRef(withAttachment.ref),
      query: 'the',
      sources: ['fulltext'],
      passages: 1,
      attachmentPolicy: 'allIndexed',
    })
    expect(result.attachments).toBeDefined()
    expect(result.attachments!.length).toBeGreaterThan(0)
    for (const source of result.attachments!) {
      expect(['indexed', 'unindexed', 'unread']).toContain(source.status)
      if (source.status !== 'indexed') continue
      // An indexed source states what it gave: coverage, its own passage
      // count, and whether the call's budget cut its text.
      expect(source.coverage).toBeDefined()
      expect(typeof source.passages).toBe('number')
      expect(typeof source.inputTruncated).toBe('boolean')
    }
    console.log(
      `[integration] full-text sources: ${result
        .attachments!.map((source) => `${source.status}(${source.passages ?? 0})`)
        .join(', ')}`,
    )
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

  it('returns live annotations through /children?itemType=annotation', async () => {
    // Seed one real annotation from the library listing, then prove the
    // plugin surfaces that same row through both children contracts.
    const seed = new ZoteroHttpClient({
      baseUrl: BASE_URL,
      timeoutMs: 10_000,
      maxResponseBytes: 8 * 1024 * 1024,
    })
    const listing = await seed.getJson<unknown[]>(
      'users/0/items',
      new URLSearchParams({ itemType: 'annotation', limit: '1' }),
    )
    const rows = Array.isArray(listing.json) ? listing.json : []
    if (rows.length === 0) {
      console.log('[integration] library has no annotations; annotation contract pin skipped')
      return
    }
    const annotationRow = rows[0] as {
      key?: string
      data?: { parentItem?: string; annotationText?: string; annotationComment?: string }
    }
    const annotationKey = annotationRow.key
    const attachmentKey = annotationRow.data?.parentItem
    expect(annotationKey).toBeTruthy()
    expect(attachmentKey).toBeTruthy()
    const attachment = await seed.getJson<{ data?: { parentItem?: string; itemType?: string } }>(
      `users/0/items/${attachmentKey}`,
    )
    expect(attachment.json?.data?.itemType).toBe('attachment')
    const itemKey = attachment.json?.data?.parentItem
    expect(itemKey).toBeTruthy()

    const itemGraph = await provider.children({
      ref: parseRef(`zotero://user/0/item/${itemKey}`),
      include: new Set(['annotations']),
    })
    const itemRefs = (itemGraph.annotations?.items ?? []).map((entry) => entry.ref)
    expect(itemRefs.some((ref) => ref.includes(annotationKey!))).toBe(true)

    const attachmentGraph = await provider.children({
      ref: parseRef(`zotero://user/0/attachment/${attachmentKey}`),
      include: new Set(['annotations']),
    })
    const attachmentRefs = (attachmentGraph.annotations?.items ?? []).map((entry) => entry.ref)
    expect(attachmentRefs.some((ref) => ref.includes(annotationKey!))).toBe(true)

    const query =
      annotationRow.data?.annotationText ||
      annotationRow.data?.annotationComment ||
      annotationRow.data?.annotationText?.slice(0, 20) ||
      ''
    const retrieved = await provider.retrieve({
      ref: parseRef(`zotero://user/0/item/${itemKey}`),
      query: query === '' ? 'a' : query,
      sources: ['annotation'],
      passages: 8,
    })
    // Annotations exist under this item, so the filtered listing must not
    // report the source as unavailable.
    expect(retrieved.sourcesSkipped).not.toContain('annotation')
    expect(retrieved.evidence.some((entry) => entry.source === 'annotation')).toBe(true)
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

  it('takes a baseline reading, then diffs from the cursor it minted', async () => {
    const baseline = await provider.changes({})
    expect(baseline.cursor).toBeDefined()
    expect(baseline.cursor?.serverId).toBeTruthy()
    expect(baseline.cursor?.library).toEqual({ type: 'user', id: 0 })
    expect(Object.keys(baseline.changed)).toHaveLength(0)
    const diff = await provider.changes({ since: baseline.cursor! })
    expect(diff.fromVersion).toBe(baseline.cursor!.version)
    // The unbounded per-resource read is what lets the live server hand back a
    // cursor: a diff that verified its whole range reports one, and its totals
    // match the rows it listed whenever nothing was capped.
    expect(diff.cursor).toBeDefined()
    expect(diff.cursor?.serverId).toBe(baseline.cursor!.serverId)
    expect(diff.truncated).toBeUndefined()
    expect(diff.changed.items?.length ?? 0).toBe(diff.totals?.items ?? 0)
    expect(diff.changed.childItems?.length ?? 0).toBe(diff.totals?.childItems ?? 0)
    // The default diff leaves out the full-text listing: that endpoint filters
    // on the index's own counter, not the library version (live-verified).
    expect(diff.changed.fulltextAttachments).toBeUndefined()
    // A same-version diff is empty but well-formed.
    expect(Array.isArray(diff.changed.items)).toBe(true)
    expect(Array.isArray(diff.changed.childItems)).toBe(true)
  })

  it('reports the tombstone kind this build does not serve, with that reason', async () => {
    // Zotero 10.0.2-beta.9 has no /deleted route. The diff must say so instead
    // of leaving removals looking like "nothing was deleted", and the cursor
    // still stands: removals were never observable on this build.
    const baseline = await provider.changes({})
    const diff = await provider.changes({
      since: baseline.cursor!,
      include: new Set(['items', 'deleted']),
    })
    expect(diff.deleted).toBeUndefined()
    expect(diff.unobservable).toContainEqual({ kind: 'deleted', reason: 'not-served' })
    expect(diff.cursor).toBeDefined()
  })

  it('reports a child object change that a top-level-only diff would drop', async () => {
    // The bug this pins: a note, attachment or annotation carries its own
    // version, so editing one advances the library version without touching a
    // top-level item. A diff over /items/top alone reports "0 items changed"
    // and hands back a cursor that steps over it.
    const baseline = await provider.changes({})
    const whole = await provider.changes({
      since: { ...baseline.cursor!, version: 0 },
      include: new Set(['items']),
    })
    const topKeys = new Set((whole.changed.items ?? []).map((entry) => entry.key))
    const childKeys = (whole.changed.childItems ?? []).map((entry) => entry.key)
    console.log(
      `[integration] item space: ${whole.totals?.items ?? 0} top-level, ` +
        `${whole.totals?.childItems ?? 0} child objects, ` +
        `${whole.totals?.trashedItems ?? 0} trashed`,
    )
    // The two listings are the API's own partition, so they cannot overlap.
    for (const key of childKeys) expect(topKeys.has(key)).toBe(false)
    const newestChild = whole.changed.childItems?.[0]
    if (newestChild === undefined || newestChild.version === 0) {
      console.log(
        '[integration] no versioned child object to narrow onto; skipping the window check',
      )
      return
    }
    const narrowed = await provider.changes({
      since: { ...baseline.cursor!, version: newestChild.version - 1 },
      include: new Set(['items']),
    })
    expect(narrowed.changed.childItems?.map((entry) => entry.key)).toContain(newestChild.key)
    expect(narrowed.changed.items?.map((entry) => entry.key) ?? []).not.toContain(newestChild.key)
  })

  it('refuses a cursor minted by another instance', async () => {
    // The claim travels as Zotero-Server-ID, so the live server itself rejects
    // a cursor from a different database with 412 instead of diffing this one's
    // unrelated counter. This is the guard that survives a plugin rebuild, a
    // settings hot-reload or a host restart, where client memory is gone.
    await zoteroError(
      provider.changes({
        since: {
          serverId: 'not-this-instance',
          library: { type: 'user', id: 0 },
          version: 1,
          include: ['items'],
        },
        include: new Set(['items']),
      }),
      'ZOTERO_SERVER_MISMATCH',
    )
  })

  it('refuses a cursor that names another library before any read', async () => {
    const status = await provider.status()
    await zoteroError(
      provider.changes({
        library: { type: 'group', id: 1 },
        since: {
          serverId: status.serverId ?? 'unknown',
          library: { type: 'user', id: 0 },
          version: 1,
          include: ['items'],
        },
        include: new Set(['items']),
      }),
      'ZOTERO_INVALID_ARGUMENT',
      'belongs to user/0',
    )
  })

  it('reads a whole-library diff and caps only what it lists', async () => {
    // The scenario that used to lose data: a window far larger than the
    // listing cap. The listing is capped, but the read was whole, so the
    // cursor is still reported and totals carries the true count.
    const baseline = await provider.changes({})
    const result = await provider.changes({
      since: { ...baseline.cursor!, version: 0 },
      include: new Set(['items']),
    })
    const listed = result.changed.items?.length ?? 0
    const total = result.totals?.items ?? 0
    const children = result.totals?.childItems ?? 0
    console.log(
      `[integration] full-library diff: ${listed} top-level listed of ${total}, ${children} child objects`,
    )
    expect(result.cursor).toBeDefined()
    expect(total).toBeGreaterThanOrEqual(listed)
    expect(listed).toBeLessThanOrEqual(50)
    // The child listing is read in the same window, so a library with child
    // objects reports them rather than folding them into the top-level count.
    expect(result.changed.childItems?.length ?? 0).toBeLessThanOrEqual(50)
    if (total > listed) expect(result.truncated).toBe(true)
    // The newest rows lead, so the capped listing is the useful end of the window.
    const versions = result.changed.items?.map((entry) => entry.version) ?? []
    expect([...versions].sort((a, b) => b - a)).toEqual(versions)
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
