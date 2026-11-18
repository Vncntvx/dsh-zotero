import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cursorLibraryMismatchMessage } from '../../../src/local/changes-cursor.js'
import { type LocalApiProvider } from '../../../src/local/provider.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../../helpers/server/assert.js'
import {
  COLLECTION_KEY,
  GROUP_LIBRARY,
  ITEM_KEY,
  PERSONAL_LIBRARY,
  SECOND_ITEM_KEY,
  SERVER_ID,
  apiPath,
} from '../../helpers/server/keys.js'
import { versionHeaders } from '../../helpers/server/objects.js'
import { serveJson, serveStatus } from '../../helpers/server/serve.js'

import { at, changedKeys, routeItems, routeVersions, versionMap } from './support.js'

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

describe('changes cursor and version integrity', () => {
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

  it('withholds the cursor when the build capped the read', async () => {
    // The response carries fewer rows than the total it reports: a build that
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
      unserved: [],
    })
    expect(result.changed.items).toEqual([{ key: ITEM_KEY, version: 44 }])
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid cursor version %s before making a request',
    async (version) => {
      await expect(diff({ ...at(42), version })).rejects.toMatchObject({
        code: 'ZOTERO_INVALID_ARGUMENT',
      })
      expect(mock.requests).toHaveLength(0)
    },
  )

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

  it('refuses a cursor that belongs to another library before any request', async () => {
    // Version counters are per library, so a cursor from user/0 says nothing
    // about group/42, and no response would reveal the mix-up.
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
    // databases, that is a fault, not a diff.
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), serverId: 'S2' })
    await zoteroError(
      provider.changes({ since: at(42, SERVER_ID, ['items']), include: new Set(['items']) }),
      'ZOTERO_SERVER_MISMATCH',
    )
  })
})
