/**
 * The `/deleted` tombstone domain of `changes()`: the tombstone listing's cap
 * and count rules, the kinds this domain does not model, and the three ways a
 * build can fail to serve the endpoint — a 404 that moves the kind into the
 * cursor's `unserved` list, a 409 whose range withholds the cursor, and a
 * payload this domain cannot read. The version-map domains live in
 * `changes.spec.ts`.
 * @module tests/local/changes-deleted
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { zoteroError } from '../helpers/server/assert.js'
import { ITEM_KEY, PERSONAL_LIBRARY, SERVER_ID, apiPath } from '../helpers/server/keys.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'
import { at, routeItems, routeTombstones, versionMap } from './changes-server.js'

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

describe('changes: deleted tombstones', () => {
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

  it('names an endpoint this build does not serve, and moves it out of the cursor coverage', async () => {
    // /deleted 404s on some local-API versions (Zotero 10.0.2-beta.9 has no
    // such route). The rest of the diff answers, and the cursor must not claim
    // coverage it cannot deliver: `deleted` rides `unserved`, so the coverage
    // claim stays true while a later call can still resume the kind.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual([ITEM_KEY])
    expect(result.deleted).toBeUndefined()
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'not-served' }])
    expect(result.cursor).toEqual({
      serverId: SERVER_ID,
      library: PERSONAL_LIBRARY,
      version: 50,
      include: ['items'],
      unserved: ['deleted'],
    })
    expect(result.truncated).toBeUndefined()
  })

  it('resumes a diff through a cursor that carries an unserved kind', async () => {
    // The unserved ride-along is what keeps the chain alive: requesting the
    // unserved kind again is allowed and meets the same absence.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 46]]) })
    const result = await provider.changes({
      since: at(50, SERVER_ID, ['items'], ['deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual([ITEM_KEY])
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'not-served' }])
    expect(result.cursor?.include).toEqual(['items'])
    expect(result.cursor?.unserved).toEqual(['deleted'])
  })

  it('mints no cursor when every requested kind is unserved', async () => {
    // A cursor that tracks nothing can resume nothing: the honest answer is
    // no cursor, so the next call takes a fresh baseline.
    serveStatus(mock, `${apiPath()}/deleted`, 404, 'Not found')
    const result = await provider.changes({
      since: at(42, SERVER_ID, ['deleted']),
      include: new Set(['deleted']),
    })
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'not-served' }])
    expect(result.cursor).toBeUndefined()
  })

  it('refuses a since whose coverage names a kind in neither list', async () => {
    routeItems(mock, {})
    await zoteroError(
      provider.changes({
        since: at(42, SERVER_ID, ['items'], []),
        include: new Set(['items', 'collections']),
      }),
      ZOTERO_INVALID_ARGUMENT,
      "since.include does not cover requested resource kind 'collections'",
    )
  })

  it('names a range older than the build keeps, with that reason, and withholds the cursor', async () => {
    // A 409 on a versioned read is "the delete log does not go back that far"
    // (Zotero's own sync client reads it that way). Removals in that range
    // exist but this call did not read them, so advancing would step over
    // them: no cursor, and the remedy is the fresh baseline the reason names.
    routeItems(mock, {})
    serveStatus(mock, `${apiPath()}/deleted`, 409, 'Conflict')
    const result = await provider.changes({
      since: at(1, SERVER_ID, ['items', 'deleted']),
      include: new Set(['items', 'deleted']),
    })
    expect(result.unobservable).toEqual([{ kind: 'deleted', reason: 'range-not-covered' }])
    expect(result.deleted).toBeUndefined()
    expect(result.cursor).toBeUndefined()
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
})
