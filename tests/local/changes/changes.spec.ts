import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type LocalApiProvider } from '../../../src/local/provider.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../../helpers/provider-harness.js'
import { expectHeaderOnEveryRequest } from '../../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  COLLECTION_KEY,
  GROUP_LIBRARY,
  ITEM_KEY,
  SECOND_ITEM_KEY,
  SERVER_ID,
  apiPath,
} from '../../helpers/server/keys.js'
import { versionHeaders } from '../../helpers/server/objects.js'
import { serveJson, serveStatus } from '../../helpers/server/serve.js'

import {
  at,
  changedKeys,
  diffRequests,
  routeItems,
  routeTombstones,
  routeVersions,
  versionMap,
} from './support.js'

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

describe('changes resource diffs', () => {
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
    const fulltext = mock.requests.find((request) => request.pathname.endsWith('/fulltext'))
    expect(fulltext?.search.get('since')).toBe('0')
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
    // The upstream read was whole, so its cursor stands despite bounded model-visible lists.
    expect(result.cursor?.version).toBe(50)
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
        unserved: [],
      },
      include: new Set(['items']),
    })
    expect(result.library).toEqual(GROUP_LIBRARY)
    expect(result.cursor).toEqual({
      serverId: 'S2',
      library: GROUP_LIBRARY,
      version: 9,
      include: ['items'],
      unserved: [],
    })
    expect(result.changed.items?.[0]?.key).toBe(ITEM_KEY)
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

  it('recovers trashed items via includeTrashed=1 when /items/trash is not served', async () => {
    // A standard Zotero Web API v3 server that does not serve /items/trash with format=versions,
    // but serves includeTrashed=1 on /items according to the official Syncing specification.
    serveJson(mock, `${apiPath()}/items/top`, { TOP12345: 45 }, versionHeaders(SERVER_ID, 50))
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json([], versionHeaders(SERVER_ID, 50))
        return
      }
      if (search.get('includeTrashed') === '1') {
        helpers.json({ TOP12345: 45, TRSH1234: 48 }, versionHeaders(SERVER_ID, 50))
      } else {
        helpers.json({ TOP12345: 45 }, versionHeaders(SERVER_ID, 50))
      }
    })
    serveStatus(mock, `${apiPath()}/items/trash`, 404, 'Not found')

    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    expect(result.changed.items).toEqual([{ key: 'TOP12345', version: 45 }])
    expect(result.changed.trashedItems).toEqual([{ key: 'TRSH1234', version: 48 }])
    expect(result.unobservable).toBeUndefined()
  })

  it('withholds a derived trash split when a truncated live half would mislabel live items', async () => {
    serveJson(mock, `${apiPath()}/items/top`, { TOP12345: 45 }, versionHeaders(SERVER_ID, 50))
    mock.route('GET', `${apiPath()}/items`, (_req, _res, h, query) => {
      const all = query.get('includeTrashed') === '1'
      h.json(all ? { TOP12345: 45, LIVEMISS: 46, TRSH1234: 48 } : { TOP12345: 45 }, {
        ...versionHeaders(SERVER_ID, 50),
        'Total-Results': all ? '3' : '2',
      })
    })
    serveStatus(mock, `${apiPath()}/items/trash`, 404, 'Not found')
    const result = await diff(at(42, SERVER_ID, ['items']))
    expect(result.changed.items).toEqual([{ key: 'TOP12345', version: 45 }])
    expect(result.changed.trashedItems).toBeUndefined()
    expect(result.totals?.trashedItems).toBeUndefined()
    expect(result.cursor).toBeUndefined()
    expect(result.unobservable).toContainEqual({ kind: 'items', reason: 'unreadable' })
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
})
