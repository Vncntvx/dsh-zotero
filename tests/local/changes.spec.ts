/**
 * The `changes()` provider contract: baseline readings (which mint the
 * cursor), `?since=` diffs over the unbound versions-format reads, the item
 * space in the API's own three reads (top-level items, child objects, the
 * trash), the fulltext listing, tombstones from `/deleted`, display caps with
 * true counts in `totals`, and the cursor rules — a cursor is handed back only
 * when the whole range was read under one version on one instance, and it
 * carries the instance and library it belongs to.
 * @module tests/provider/changes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cursorLibraryMismatchMessage } from '../../src/local/changes-domain.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  expectHeaderOnEveryRequest,
  expectRequestCount,
  zoteroError,
} from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  COLLECTION_KEY,
  GROUP_LIBRARY,
  ITEM_KEY,
  PERSONAL_LIBRARY,
  SECOND_ITEM_KEY,
  SERVER_ID,
  apiPath,
} from '../helpers/server/keys.js'
import { versionHeaders } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'
import { deferred } from '../helpers/sync.js'
import {
  at,
  changedKeys,
  diffRequests,
  routeItems,
  routeTombstones,
  routeVersions,
  versionMap,
} from './changes-server.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness

const diff = (
  since: ZoteroChangesCursor,
  include: Iterable<ZoteroChangesInclude> = since.include,
) => provider.changes({ since, include: new Set(include) })

beforeEach(async () => {
  harness = await setupProvider({ maxChangesResults: 3 })
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

describe('changes', () => {
  it('takes a baseline reading and mints the cursor the next call diffs from', async () => {
    mock.route('GET', `${apiPath()}/items/top`, (req, res, helpers, search) => {
      expect(search.get('limit')).toBe('1')
      helpers.json([], versionHeaders(SERVER_ID, 42))
    })
    const result = await provider.changes({})
    expect(result.cursor).toEqual(at(42))
    expect(result.serverId).toBe(SERVER_ID)
    expect(result.fromVersion).toBeUndefined()
    expect(result.versionUnavailable).toBeUndefined()
    expect(result.changed).toEqual({})
    // A baseline reads exactly one endpoint.
    expectRequestCount(mock, 1)
  })

  it('mints no cursor when the build names no instance to pin it to', async () => {
    // A version without a database identity is exactly the cursor that could
    // be handed to another instance later, so it is not offered at all.
    serveJson(mock, `${apiPath()}/items/top`, [], { 'Last-Modified-Version': '42' })
    const result = await provider.changes({})
    expect(result.cursor).toBeUndefined()
    expect(result.serverId).toBeUndefined()
    // The version was read, so this is not a versionless build.
    expect(result.versionUnavailable).toBeUndefined()
  })

  it('reports a build with no library version as cursor-less and version-unavailable', async () => {
    serveJson(mock, `${apiPath()}/items/top`, [], versionHeaders(SERVER_ID))
    const result = await provider.changes({})
    expect(result.cursor).toBeUndefined()
    expect(result.versionUnavailable).toBe(true)
    expect(result.changed).toEqual({})
  })

  it('reports a baseline on a build that serves no item read as version-unavailable', async () => {
    serveStatus(mock, `${apiPath()}/items/top`, 404, 'Not found')
    const result = await provider.changes({})
    expect(result.cursor).toBeUndefined()
    expect(result.serverId).toBeUndefined()
    expect(result.versionUnavailable).toBe(true)
    expect(result.changed).toEqual({})
  })

  it('diffs every resource whole and hands back a cursor for this instance', async () => {
    routeItems(mock, {
      top: versionMap([
        [ITEM_KEY, 44],
        [SECOND_ITEM_KEY, 47],
      ]),
      children: versionMap([['CHLD1234', 46]]),
      trash: versionMap([['TRSH1234', 45]]),
      version: '50',
    })
    routeVersions(mock, `${apiPath()}/collections`, versionMap([[COLLECTION_KEY, 45]]), {
      'Last-Modified-Version': '50',
    })
    routeVersions(mock, `${apiPath()}/searches`, versionMap([]), {
      'Last-Modified-Version': '50',
    })
    // The real fulltext endpoint sends neither version nor total headers.
    routeVersions(mock, `${apiPath()}/fulltext`, versionMap([[ATTACHMENT_KEY, 46]]))
    routeTombstones(mock, { items: ['EEEE0001'], tags: ['obsolete'] })

    const result = await diff(
      at(42, SERVER_ID, ['items', 'collections', 'savedSearches', 'fulltext', 'deleted']),
    )
    expect(mock.requests[0]?.search.get('limit')).toBe('1')
    // The claim travels on every request, so the server can refuse a foreign
    // database itself rather than trusting the client to notice.
    expectHeaderOnEveryRequest(mock, 'zotero-server-id', SERVER_ID)
    expect(result.fromVersion).toBe(42)
    expect(result.cursor).toBeUndefined()
    expect(result.libraryChanged).toBeUndefined()
    expect(result.changed.items?.map((entry) => entry.key)).toEqual([SECOND_ITEM_KEY, ITEM_KEY])
    expect(result.changed.items?.[0]).toEqual({ key: SECOND_ITEM_KEY, version: 47 })
    // The child object and the trashed item are items too, and neither would
    // appear in a diff over the top-level listing alone.
    expect(result.changed.childItems?.map((entry) => entry.key)).toEqual(['CHLD1234'])
    expect(result.changed.trashedItems?.map((entry) => entry.key)).toEqual(['TRSH1234'])
    expect(result.changed.collections?.map((entry) => entry.key)).toEqual([COLLECTION_KEY])
    expect(result.changed.savedSearches).toEqual([])
    expect(result.changed.fulltextAttachments?.map((entry) => entry.key)).toEqual([ATTACHMENT_KEY])
    expect(result.deleted).toEqual({
      items: ['EEEE0001'],
      collections: [],
      savedSearches: [],
      tags: ['obsolete'],
    })
    expect(result.totals).toEqual({
      items: 2,
      childItems: 1,
      trashedItems: 1,
      collections: 1,
      savedSearches: 0,
      fulltextAttachments: 1,
      deletedItems: 1,
      deletedCollections: 0,
      deletedSavedSearches: 0,
      deletedTags: 1,
    })
    expect(result.unobservable).toBeUndefined()
    expect(result.truncated).toBeUndefined()
  })

  it('does not compare fulltext’s independent counter with the library cursor', async () => {
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    routeVersions(mock, `${apiPath()}/fulltext`, versionMap([[ATTACHMENT_KEY, 46]]), {
      'Last-Modified-Version': '999',
    })
    const result = await diff(at(42, SERVER_ID, ['fulltext']))
    expect(result.cursor).toBeUndefined()
    expect(result.libraryChanged).toBeUndefined()
  })

  it('reads the item space as three endpoints, the partition the API describes', async () => {
    routeItems(mock, {
      top: versionMap([['TOPX1234', 44]]),
      children: versionMap([['NOTE1234', 45]]),
      trash: versionMap([['TRSH1234', 46]]),
    })
    await diff(at(42, SERVER_ID, ['items']))
    expect(
      diffRequests(mock)
        .map((request) => request.pathname)
        .sort(),
    ).toEqual([`${apiPath()}/items`, `${apiPath()}/items/top`, `${apiPath()}/items/trash`].sort())
  })

  it('reports a child object as a child even when its parent also changed', async () => {
    // Zotero keeps notes, attachments and annotations as items with their own
    // versions: the parent's edit says nothing about the annotation's, so both
    // belong in the diff and only one of them is a top-level item.
    routeItems(mock, {
      top: versionMap([['PARN1234', 50]]),
      children: versionMap([['ANNO1234', 49]]),
    })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toEqual([{ key: 'PARN1234', version: 50 }])
    expect(result.changed.childItems).toEqual([{ key: 'ANNO1234', version: 49 }])
    expect(result.totals).toEqual({ items: 1, childItems: 1, trashedItems: 0 })
  })

  it('leaves the full-text listing out unless it is named', async () => {
    // `/fulltext?since=` filters on the index's own version counter, so its
    // rows belong to no library version and cannot be part of a default diff.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    routeVersions(mock, `${apiPath()}/collections`, versionMap([]), {
      'Last-Modified-Version': '50',
    })
    routeVersions(mock, `${apiPath()}/searches`, versionMap([]), {
      'Last-Modified-Version': '50',
    })
    routeTombstones(mock)
    const result = await provider.changes({ since: at(42) })
    expect(diffRequests(mock).map((request) => request.pathname)).not.toContain(
      `${apiPath()}/fulltext`,
    )
    expect(result.changed.fulltextAttachments).toBeUndefined()
    expect(result.totals?.fulltextAttachments).toBeUndefined()
    expect(result.cursor?.version).toBe(50)
  })

  it('caps each listing but keeps the cursor and the true totals', async () => {
    routeItems(mock, { top: versionMap(changedKeys(9)), total: { top: '9' } })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toHaveLength(3)
    expect(result.totals?.items).toBe(9)
    expect(result.truncated).toBe(true)
    // The cap is a display concern only: the read was whole, so the cursor stands.
    expect(result.cursor?.version).toBe(50)
  })

  it('withholds the cursor when the build capped the read', async () => {
    // The response carries fewer rows than the total it reports — a build that
    // imposed its own page cap. The rows it hid sit below the version it
    // reports, so that version must not be resumable. `truncated` stays absent:
    // it speaks about the listing, and this listing is exactly the rows read.
    routeItems(mock, { top: versionMap(changedKeys(3)), total: { top: '9' } })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toHaveLength(3)
    expect(result.totals?.items).toBe(9)
    expect(result.truncated).toBeUndefined()
    expect(result.cursor).toBeUndefined()
    expect(result.libraryChanged).toBeUndefined()
  })

  it('withholds the cursor when the library moved while the diff was read', async () => {
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), version: '42', diffVersion: '50' })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items?.map((entry) => entry.key)).toEqual([ITEM_KEY])
    expect(result.cursor).toBeUndefined()
    expect(result.libraryChanged).toBe(true)
  })

  it('withholds the cursor when a versioned item partition omits its version', async () => {
    routeItems(mock, {
      top: versionMap([[ITEM_KEY, 44]]),
      unversionedDiff: 'trash',
    })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.cursor).toBeUndefined()
  })

  it('withholds the cursor when a versioned partition has a malformed total', async () => {
    routeItems(mock, {
      top: versionMap([[ITEM_KEY, 44]]),
      total: { top: 'not-a-number' },
    })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.cursor).toBeUndefined()
  })

  it('treats a total smaller than the returned map as unreadable', async () => {
    routeItems(mock, {
      top: versionMap([
        [ITEM_KEY, 44],
        [SECOND_ITEM_KEY, 45],
      ]),
      total: { top: '1' },
    })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.cursor).toBeUndefined()
  })

  it('treats a malformed version header on a standalone resource as unreadable', async () => {
    routeVersions(mock, `${apiPath()}/collections`, versionMap([[COLLECTION_KEY, 44]]), {
      'Last-Modified-Version': 'not-a-number',
    })
    const result = await diff(at(42, SERVER_ID, ['collections']))
    expect(result.unobservable).toEqual([{ kind: 'collections', reason: 'unreadable' }])
    expect(result.cursor).toBeUndefined()
  })

  it('waits for the item fan-out to settle after one partition fails fatally', async () => {
    routeItems(mock, { diff: { live: 'error' } })
    await expect(diff(at(42, SERVER_ID, ['items']))).rejects.toBeDefined()
  })

  it('preserves the partition failure that aborts its siblings', async () => {
    const liveStarted = deferred<void>()
    const liveClosed = deferred<void>()
    const failTop = deferred<void>()
    mock.route('GET', `${apiPath()}/items`, async (_req, res) => {
      liveStarted.resolve()
      res.once('close', () => liveClosed.resolve())
      await liveClosed.promise
    })
    mock.route('GET', `${apiPath()}/items/top`, async (_req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json({}, versionHeaders(SERVER_ID, 50))
        return
      }
      await failTop.promise
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'partition failed')
    })
    routeItems(mock, { trash: versionMap([]) })

    const pending = provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    await liveStarted.promise
    failTop.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
    await liveClosed.promise
  })

  it('forwards caller cancellation into the item fan-out', async () => {
    const controller = new AbortController()
    mock.route('GET', `${apiPath()}/items/top`, (_req, res, helpers, search) => {
      if (search.get('limit') === '1') controller.abort()
      helpers.json({}, versionHeaders(SERVER_ID, 50))
    })
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    await expect(
      provider.changes(
        { since: at(42, SERVER_ID, ['items']), include: new Set(['items']) },
        controller.signal,
      ),
    ).rejects.toBeDefined()
  })

  it('reads the diff but withholds the cursor when the probe reports no version', async () => {
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), probe: 'unversioned' })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    expect(result.changed.items).toHaveLength(1)
    expect(result.cursor).toBeUndefined()
    expect(result.versionUnavailable).toBe(true)
    expect(result.libraryChanged).toBeUndefined()
  })

  it('trusts an unbounded read when the build sends no Total-Results', async () => {
    // Local-API builds may omit the header on the versions format. Without it,
    // a whole read cannot be distinguished from a capped one, so the unbounded
    // request is trusted rather than reported as incomplete.
    const body = versionMap(changedKeys(3))
    mock.route('GET', `${apiPath()}/items/top`, (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json([], { 'Last-Modified-Version': '50' })
        return
      }
      expect(search.get('limit')).toBeNull()
      helpers.json(body, { 'Last-Modified-Version': '50' })
    })
    serveJson(mock, `${apiPath()}/items`, {}, { 'Last-Modified-Version': '50' })
    serveJson(mock, `${apiPath()}/items/trash`, {}, { 'Last-Modified-Version': '50' })
    routeTombstones(mock)
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.cursor?.version).toBe(50)
    expect(result.totals?.items).toBe(3)
    expect(result.truncated).toBeUndefined()
    // Served but empty tombstones are a finding, not a gap: the lists are
    // present and empty, and the counts say the read happened.
    expect(result.deleted).toEqual({ items: [], collections: [], savedSearches: [], tags: [] })
    expect(result.totals?.deletedItems).toBe(0)
  })

  it('keeps the claimed instance when the reads name none', async () => {
    // Not every build stamps its responses; a claim does not need them to
    // stand, it only needs them not to contradict it.
    for (const path of [
      `${apiPath()}/items`,
      `${apiPath()}/items/top`,
      `${apiPath()}/items/trash`,
    ]) {
      mock.route('GET', path, (req, res, helpers, search) => {
        helpers.json(search.get('limit') === '1' ? [] : { [ITEM_KEY]: 44 }, {
          'Last-Modified-Version': '50',
          'Total-Results': '1',
        })
      })
    }
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.cursor).toEqual({
      serverId: SERVER_ID,
      library: PERSONAL_LIBRARY,
      version: 50,
      include: ['items'],
    })
    expect(result.changed.items).toEqual([{ key: ITEM_KEY, version: 44 }])
  })

  it('reports a body that is not a version map as unreadable, never as no changes', async () => {
    // An array body, a string body, a key→string map: none of them can be read
    // as a changelist, and "0 changed" is the one thing they must not become.
    routeItems(mock, { body: { top: [{ key: ITEM_KEY, version: 44 }] } })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toBeUndefined()
    expect(result.changed.childItems).toBeUndefined()
    expect(result.totals).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.cursor).toBeUndefined()
  })

  it('reports a map whose values are not version numbers as unreadable', async () => {
    routeItems(mock, { body: { top: { [ITEM_KEY]: '44' } }, total: { top: '1' } })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.changed.items).toBeUndefined()
    expect(result.cursor).toBeUndefined()
  })

  it('treats malformed keys as unreadable rather than dropping the row', async () => {
    routeItems(mock, { body: { top: { 'bad-key!': 44 } }, total: { top: '1' } })
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'unreadable' }])
    expect(result.totals).toBeUndefined()
  })

  it('caps the tombstone listing and reports its true count', async () => {
    routeItems(mock, {})
    routeTombstones(mock, { items: ['DELE0001', 'DELE0002', 'DELE0003', 'DELE0004'] })
    const result = await diff(at(42, SERVER_ID, ['items', 'deleted']))
    expect(result.deleted?.items).toEqual(['DELE0001', 'DELE0002', 'DELE0003'])
    expect(result.totals?.deletedItems).toBe(4)
    expect(result.truncated).toBe(true)
    expect(result.cursor?.version).toBe(50)
  })

  it('counts tombstone kinds it does not model instead of dropping them', async () => {
    routeItems(mock, {})
    // A documented kind with a non-array value would be unreadable, but these
    // are kinds this domain does not interpret: arrays are counted, anything
    // else carries no countable entries.
    routeTombstones(mock, { settings: ['alpha', 'beta'], other: 'not-a-list' })
    const result = await diff(at(42, SERVER_ID, ['items', 'deleted']))
    expect(result.deleted).toEqual({ items: [], collections: [], savedSearches: [], tags: [] })
    expect(result.totals?.deletedOther).toBe(2)
    expect(result.cursor?.version).toBe(50)
  })

  it('honors include subsets and skips their endpoints', async () => {
    routeItems(mock, {})
    routeVersions(mock, `${apiPath()}/collections`, versionMap([[COLLECTION_KEY, 44]]), {
      'Last-Modified-Version': '50',
    })
    const result = await diff(at(10, SERVER_ID, ['collections']))
    expect(result.changed.collections?.map((entry) => entry.key)).toEqual([COLLECTION_KEY])
    expect(result.changed.items).toBeUndefined()
    const paths = diffRequests(mock).map((request) => request.pathname)
    expect(paths).toEqual([`${apiPath()}/collections`])
  })

  it('diffs a group library under its own prefix and pins the cursor to it', async () => {
    routeItems(mock, {
      top: versionMap([[ITEM_KEY, 7]]),
      prefix: apiPath(GROUP_LIBRARY),
      version: '9',
      serverId: 'S2',
    })
    const result = await provider.changes({
      library: GROUP_LIBRARY,
      since: {
        serverId: 'S2',
        library: GROUP_LIBRARY,
        version: 3,
        include: ['items'],
      },
      include: new Set(['items']),
    })
    expect(result.library).toEqual(GROUP_LIBRARY)
    expect(result.cursor).toEqual({
      serverId: 'S2',
      library: GROUP_LIBRARY,
      version: 9,
      include: ['items'],
    })
    expect(result.changed.items?.[0]?.key).toBe(ITEM_KEY)
  })

  it('names an endpoint this build does not serve, with that reason, and keeps the cursor', async () => {
    // /deleted 404s on some local-API versions (Zotero 10.0.2-beta.9 has no
    // such route). The rest of the diff answers and says what it could not
    // cover; the cursor stands, because removals were never observable here.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual([ITEM_KEY])
    expect(result.deleted).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'not-served' }])
    expect(result.cursor?.version).toBe(50)
    expect(result.truncated).toBeUndefined()
  })

  it('names a range older than the build keeps, with that reason, and keeps the cursor', async () => {
    // A 409 on a versioned read is "the delete log does not go back that far"
    // (Zotero's own sync client reads it that way). Removals in that range are
    // gone; re-baselining covers them from here, so the cursor still stands.
    routeItems(mock, {})
    serveStatus(mock, `${apiPath()}/deleted`, 409, 'Conflict')
    const result = await provider.changes({
      since: at(1, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'range-not-covered' }])
    expect(result.deleted).toBeUndefined()
    expect(result.cursor?.version).toBe(50)
  })

  it('reports an unreadable tombstone payload as unobservable and withholds the cursor', async () => {
    routeItems(mock, {})
    serveJson(mock, `${apiPath()}/deleted`, {
      items: 'not-a-list',
      collections: [],
      searches: [],
      tags: [],
    })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'unreadable' }])
    expect(result.deleted).toBeUndefined()
    expect(result.totals?.deletedItems).toBeUndefined()
    // The rows exist and this call failed to read them: advancing would step
    // over them, so no cursor.
    expect(result.cursor).toBeUndefined()
  })

  it('reports a tombstone body that is not an object as unreadable', async () => {
    routeItems(mock, {})
    serveJson(mock, `${apiPath()}/deleted`, ['DELE0001'])
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'unreadable' }])
    expect(result.deleted).toBeUndefined()
    expect(result.cursor).toBeUndefined()
  })

  it('reports a missing tombstone list as an empty one, the way Zotero reads its own payload', async () => {
    routeItems(mock, {})
    serveJson(mock, `${apiPath()}/deleted`, { items: ['DELE0001'] })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.deleted).toEqual({
      items: ['DELE0001'],
      collections: [],
      savedSearches: [],
      tags: [],
    })
    expect(result.totals?.deletedCollections).toBe(0)
    expect(result.totals?.deletedTags).toBe(0)
  })

  it('leaves the whole item kind unobservable when one of its reads is missing', async () => {
    // The partition needs all three: without the trash read a trashing would be
    // invisible, so a slice of the item space is never reported as the space.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), diff: { trash: 'not-found' } })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    expect(result.changed.items).toBeUndefined()
    expect(result.changed.childItems).toBeUndefined()
    expect(result.changed.trashedItems).toBeUndefined()
    expect(result.totals).toBeUndefined()
    expect(result.cursor).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'not-served' }])
  })

  it('reports a versionless library as an empty, cursor-less diff', async () => {
    routeItems(mock, {
      probe: 'not-found',
      diff: { live: 'not-found', top: 'not-found', trash: 'not-found' },
    })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    expect(result.cursor).toBeUndefined()
    expect(result.changed.items).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'items', reason: 'not-served' }])
    expect(result.totals).toBeUndefined()
    expect(result.versionUnavailable).toBe(true)
  })

  it('names every resource a build serves none of, each once', async () => {
    for (const path of [
      `${apiPath()}/items`,
      `${apiPath()}/items/top`,
      `${apiPath()}/items/trash`,
      `${apiPath()}/collections`,
      `${apiPath()}/searches`,
      `${apiPath()}/fulltext`,
      `${apiPath()}/deleted`,
    ]) {
      serveStatus(mock, path, 404, 'Not found')
    }
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'collections', 'savedSearches', 'fulltext', 'deleted']),
      include: new Set(['items', 'collections', 'savedSearches', 'fulltext', 'deleted']),
    })
    expect(result.changed).toEqual({})
    expect(result.unobservable).toEqual([
      { kind: 'items', reason: 'not-served' },
      { kind: 'collections', reason: 'not-served' },
      { kind: 'savedSearches', reason: 'not-served' },
      { kind: 'fulltext', reason: 'not-served' },
      { kind: 'deleted', reason: 'not-served' },
    ])
    expect(result.totals).toBeUndefined()
    expect(result.cursor).toBeUndefined()
    expect(result.versionUnavailable).toBe(true)
  })

  it('fails loud when a resource faults for a reason other than absence', async () => {
    // Only a 404 (and a 409 range refusal) degrades to `unobservable`; a server
    // fault must never be reported as "this resource did not change".
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), diff: { top: 'error' } })
    await zoteroError(
      provider.changes({ since: at(42, SERVER_ID, ['items']), include: new Set(['items']) }),
      'ZOTERO_UNEXPECTED',
      'HTTP 500',
    )
  })

  it('breaks version ties by key so a listing has one order', async () => {
    routeItems(mock, {
      top: versionMap([
        [SECOND_ITEM_KEY, 44],
        ['AAAA1234', 44],
      ]),
    })
    const result = await provider.changes({
      since: at(10, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual(['AAAA1234', SECOND_ITEM_KEY])
  })

  it('refuses a cursor that belongs to another library before any request', async () => {
    // Version counters are per library, so a cursor from user/0 says nothing
    // about group/42 — and no response would reveal the mix-up.
    await zoteroError(
      provider.changes({ library: GROUP_LIBRARY, since: at(42) }),
      'ZOTERO_INVALID_ARGUMENT',
      cursorLibraryMismatchMessage('user/0', 'group/42'),
    )
    expectRequestCount(mock, 0)
  })

  it('fails loud when a response names an instance other than the claim', async () => {
    // The request carries the claim, so a real build rejects a foreign
    // database with 412. If one answers anyway, the result would mix two
    // databases — that is a fault, not a diff.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), serverId: 'S2' })
    await zoteroError(
      provider.changes({ since: at(42, SERVER_ID, ['items']), include: new Set(['items']) }),
      'ZOTERO_SERVER_MISMATCH',
    )
  })
})
