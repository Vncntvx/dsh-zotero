/**
 * The `changes()` provider contract: baseline readings (current version
 * only), `?since=` diffs over the versions-format endpoints, the fulltext
 * delta, tombstones from `/deleted`, per-resource caps with an honest
 * truncated flag, and identity pinning.
 * @module tests/provider/changes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

let mock: MockZotero
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider({ maxBrowseResults: 3 })
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

/** A key→version map shaped like `format=versions` responses. */
function versionMap(entries: [string, number][]): Record<string, number> {
  return Object.fromEntries(entries)
}

describe('changes', () => {
  it('takes a baseline reading of the current library version without diffs', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      expect(search.get('limit')).toBe('1')
      helpers.json([], {
        'Last-Modified-Version': '42',
        'Zotero-Server-ID': 'S1',
      })
    })
    const result = await provider.changes({})
    expect(result.toVersion).toBe(42)
    expect(result.serverId).toBe('S1')
    expect(result.fromVersion).toBeUndefined()
    expect(result.changed).toEqual({})
    // A baseline reads exactly one endpoint.
    expect(mock.requests).toHaveLength(1)
  })

  it('diffs items, collections, and searches through format=versions', async () => {
    const route = (matcher: string, body: Record<string, number>): void => {
      mock.route('GET', matcher, (req, res, helpers, search) => {
        expect(search.get('since')).toBe('42')
        expect(search.get('format')).toBe('versions')
        helpers.json(body, {
          'Last-Modified-Version': '50',
          'Total-Results': String(Object.keys(body).length),
        })
      })
    }
    route(
      '/api/users/0/items/top',
      versionMap([
        ['ABCD1234', 44],
        ['BBBB1234', 47],
      ]),
    )
    route('/api/users/0/collections', versionMap([['COLL1234', 45]]))
    route('/api/users/0/searches', {})
    route('/api/users/0/fulltext', versionMap([['WXYZ6789', 46]]))
    mock.route('GET', '/api/users/0/deleted', (req, res, helpers, search) => {
      expect(search.get('since')).toBe('42')
      // A non-array tombstone section is skipped by the key filter.
      helpers.json({ items: ['EEEE0001'], collections: [], searches: 'garbage' })
    })

    const result = await provider.changes({ since: 42 })
    expect(result.fromVersion).toBe(42)
    expect(result.toVersion).toBe(50)
    expect(result.changed.items?.map((entry) => entry.key)).toEqual(['BBBB1234', 'ABCD1234'])
    expect(result.changed.items?.[0]).toEqual({ key: 'BBBB1234', version: 47 })
    expect(result.changed.collections?.map((entry) => entry.key)).toEqual(['COLL1234'])
    expect(result.changed.savedSearches).toEqual([])
    expect(result.changed.fulltextAttachments?.map((entry) => entry.key)).toEqual(['WXYZ6789'])
    expect(result.deleted?.items).toEqual(['EEEE0001'])
    expect(result.truncated).toBeUndefined()
  })

  it('flags truncation when Total-Results exceeds the capped page', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json(
        versionMap([
          ['ABCD1234', 44],
          ['BBBB1234', 45],
          ['CCCC1234', 46],
        ]),
        { 'Last-Modified-Version': '50', 'Total-Results': '9' },
      ),
    )
    const result = await provider.changes({ since: 42, include: new Set(['items']) })
    expect(result.changed.items).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('degrades honestly when a versions listing omits Total-Results', async () => {
    // Local-API builds send no Total-Results on the versions format (the
    // array listings do — verified against live Zotero). A short page is
    // provably complete; a full page reports truncated instead of guessing.
    const pages = [
      versionMap([['ABCD1234', 44]]),
      versionMap([
        ['ABCD1234', 44],
        ['BBBB1234', 45],
        ['CCCC1234', 46],
      ]),
    ]
    let call = 0
    mock.route('GET', '/api/users/0/items/top', (_req, _res, helpers) => {
      helpers.json(pages[Math.min(call, pages.length - 1)], { 'Last-Modified-Version': '50' })
      call += 1
    })
    const partial = await provider.changes({ since: 42, include: new Set(['items']) })
    expect(partial.truncated).toBeUndefined()
    expect(partial.changed.items).toHaveLength(1)

    const capped = await provider.changes({ since: 42, include: new Set(['items']) })
    expect(capped.truncated).toBe(true)
    expect(capped.changed.items).toHaveLength(3)
  })

  it('honors include subsets and skips their endpoints', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json(versionMap([['ABCD1234', 44]]), { 'Total-Results': '1' }),
    )
    const result = await provider.changes({
      since: 10,
      include: new Set(['items']),
    })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual(['ABCD1234'])
    expect(result.changed.collections).toBeUndefined()
    expect(mock.requests.filter((request) => request.pathname.endsWith('/deleted'))).toHaveLength(0)
  })

  it('diffs a group library under its own prefix', async () => {
    mock.route('GET', '/api/groups/42/items/top', (req, res, helpers) =>
      helpers.json(versionMap([['ABCD1234', 7]]), {
        'Total-Results': '1',
        'Zotero-Server-ID': 'S2',
      }),
    )
    const result = await provider.changes({
      library: { type: 'group', id: 42 },
      since: 3,
      include: new Set(['items']),
    })
    expect(result.library).toEqual({ type: 'group', id: 42 })
    expect(result.serverId).toBe('S2')
    expect(result.changed.items?.[0]?.key).toBe('ABCD1234')
  })

  it('omits malformed keys and non-numeric versions from version maps', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json(
        { ABCD1234: 44, 'bad-key!': 5, SHORT: 'not-a-number' },
        { 'Total-Results': '1' },
      ),
    )
    const result = await provider.changes({ since: 10, include: new Set(['items']) })
    expect(result.changed.items).toEqual([{ key: 'ABCD1234', version: 44 }])
  })

  it('degrades a resource this build does not serve to an absent section', async () => {
    // /deleted 404s on some local-API versions; the rest of the diff answers.
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json(versionMap([['ABCD1234', 44]]), {
        'Total-Results': '1',
        'Last-Modified-Version': '50',
      }),
    )
    const result = await provider.changes({ since: 42, include: new Set(['items', 'deleted']) })
    expect(result.changed.items?.map((entry) => entry.key)).toEqual(['ABCD1234'])
    expect(result.deleted).toBeUndefined()
    expect(result.truncated).toBeUndefined()
  })

  it('reports a versionless library as an empty baseline reading', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    const result = await provider.changes({})
    expect(result.toVersion).toBeUndefined()
    expect(result.changed).toEqual({})
  })
})
