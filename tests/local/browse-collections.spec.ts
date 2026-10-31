/**
 * Collections browsing: top-level paging and order, child navigation with
 * breadcrumbs, the instance fences, and the counts Zotero publishes per row.
 * @module tests/local/browse-collections
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PARENT_REF_SCOPE_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  parentLibraryMismatchMessage,
} from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { zoteroError } from '../helpers/server/assert.js'
import { GROUP_LIBRARY, apiPath } from '../helpers/server/keys.js'
import { collectionRow, versionHeaders } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
})
afterEach(async () => {
  await teardownProvider(harness)
})

describe('browse: collections', () => {
  it('carries the counts Zotero publishes and omits an unreported one', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/top`,
      [
        collectionRow({ key: 'COLL0001', meta: { numCollections: 0, numItems: 4 } }),
        collectionRow({ key: 'COLL0002' }),
      ],
      { 'Last-Modified-Version': '1', 'Total-Results': '2' },
    )
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    const rows = result.items as unknown as Array<{ childCount?: number; itemCount?: number }>
    expect(rows.map((row) => row.childCount)).toEqual([0, undefined])
    expect(rows.map((row) => row.itemCount)).toEqual([4, undefined])
  })

  it('lists top-level collections server-side paged, in server order', async () => {
    // Preserve server ordering across pages, even for this unsorted fixture.
    const tops = [
      collectionRow({ key: 'COLL0001', data: { name: 'Root B' } }),
      collectionRow({ key: 'COLL0002', data: { name: 'Root A' } }),
    ]
    mock.route('GET', `${apiPath()}/collections/top`, (req, res, helpers, search) => {
      expect(search.get('start')).toBe('0')
      expect(search.get('limit')).toBe('10')
      helpers.json(tops, {
        ...versionHeaders('S1', 1),
        'Total-Results': '2',
      })
    })
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
    expect(result.serverId).toBe('S1')
    expect(result.items.map((item) => (item as { name: string }).name)).toEqual([
      'Root B',
      'Root A',
    ])
    // Top-level rows keep single-segment paths.
    expect((result.items[0] as unknown as { path: string[] }).path).toEqual(['Root B'])
  })

  it('keeps server order stable across pages', async () => {
    // The bug this pins: a page-local sort orders each window internally
    // while the concatenated pages are neither Zotero order nor name order.
    const tops = ['Delta', 'Charlie', 'Bravo', 'Alpha'].map((name, i) =>
      collectionRow({ key: `COLL000${i + 1}`, data: { name } }),
    )
    mock.route('GET', `${apiPath()}/collections/top`, (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(tops.slice(start, start + limit), {
        'Last-Modified-Version': '1',
        'Total-Results': String(tops.length),
      })
    })
    const page1 = await provider.browse({ kind: 'collections', offset: 0, limit: 2 })
    const page2 = await provider.browse({ kind: 'collections', offset: 2, limit: 2 })
    const names = [
      ...page1.items.map((item) => (item as { name: string }).name),
      ...page2.items.map((item) => (item as { name: string }).name),
    ]
    expect(names).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha'])
  })

  it('paginates against the header total with nextOffset', async () => {
    const tops = Array.from({ length: 5 }, (_, i) =>
      collectionRow({ key: `COLL${String(i).padStart(4, '0')}`, data: { name: `C${i}` } }),
    )
    mock.route('GET', `${apiPath()}/collections/top`, (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(tops.slice(start, start + limit), {
        'Last-Modified-Version': '1',
        'Total-Results': String(tops.length),
      })
    })
    const r = await provider.browse({ kind: 'collections', offset: 1, limit: 2 })
    expect(r.returned).toBe(2)
    expect(r.nextOffset).toBe(3)
  })

  it('navigates children via parentRef and builds breadcrumbs through ancestor GETs', async () => {
    mock.route(
      'GET',
      `${apiPath()}/collections/COLL0001/collections`,
      (req, res, helpers, search) => {
        expect(search.get('start')).toBe('0')
        helpers.json(
          [
            collectionRow({
              key: 'COLL0002',
              data: { name: 'Child A', parentCollection: 'COLL0001' },
            }),
            collectionRow({
              key: 'COLL0003',
              data: { name: 'Child B', parentCollection: 'COLL0001' },
            }),
          ],
          { 'Last-Modified-Version': '1', 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
        )
      },
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001`,
      collectionRow({ key: 'COLL0001', data: { name: 'Root' } }),
      versionHeaders('S1'),
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0001',
      offset: 0,
      limit: 10,
    })
    const rows = result.items as unknown as Array<{
      name: string
      path: string[]
      depth: number
      parentRef?: string
    }>
    expect(rows.map((row) => row.path)).toEqual([
      ['Root', 'Child A'],
      ['Root', 'Child B'],
    ])
    expect(rows.every((row) => row.depth === 1)).toBe(true)
    expect(
      rows.every((row) => row.parentRef === 'zotero://user/0/collection/COLL0001?server=S1'),
    ).toBe(true)
    // Both siblings share the parent: one cached ancestor GET serves both.
    expect(
      mock.requests.filter((r) => r.pathname === `${apiPath()}/collections/COLL0001`),
    ).toHaveLength(1)
  })

  it('keeps a qualified parent identity on the child request and rejects a foreign response', async () => {
    let foreign = false
    mock.route('GET', `${apiPath()}/collections/COLL0001/collections`, (req, _res, helpers) => {
      expect(req.headers['zotero-server-id']).toBe('S1')
      helpers.json([], {
        'Last-Modified-Version': '1',
        'Total-Results': '0',
        ...(foreign ? { 'Zotero-Server-ID': 'S2' } : {}),
      })
    })
    const empty = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0001?server=S1',
      offset: 0,
      limit: 10,
    })
    expect(empty.serverId).toBe('S1')
    foreign = true
    await zoteroError(
      provider.browse({
        kind: 'collections',
        parentRef: 'zotero://user/0/collection/COLL0001?server=S1',
        offset: 0,
        limit: 10,
      }),
      'ZOTERO_SERVER_MISMATCH',
    )
  })

  it('walks multi-level ancestors for deep breadcrumbs', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0003/collections`,
      [
        collectionRow({
          key: 'COLL0004',
          data: { name: 'Leaf', parentCollection: 'COLL0002' },
        }),
      ],
      { 'Last-Modified-Version': '1', 'Total-Results': '1' },
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0002`,
      collectionRow({ key: 'COLL0002', data: { name: 'Mid', parentCollection: 'COLL0001' } }),
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001`,
      collectionRow({ key: 'COLL0001', data: { name: 'Root' } }),
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0003',
      offset: 0,
      limit: 10,
    })
    expect((result.items[0] as unknown as { path: string[] }).path).toEqual(['Root', 'Mid', 'Leaf'])
  })

  it('truncates breadcrumbs at a missing ancestor and guards self cycles', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0009/collections`,
      [
        collectionRow({
          key: 'COLL0010',
          data: { name: 'Orphan', parentCollection: 'MISSING1' },
        }),
        collectionRow({
          key: 'COLL0011',
          data: { name: 'Selfy', parentCollection: 'COLL0011' },
        }),
      ],
      { 'Last-Modified-Version': '1', 'Total-Results': '2' },
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    const rows = result.items as unknown as Array<{ name: string; path: string[]; depth: number }>
    // MISSING1 404s: the phantom parent never enters the path (fail-closed).
    expect(rows.find((row) => row.name === 'Orphan')!.path).toEqual(['Orphan'])
    expect(rows.find((row) => row.name === 'Selfy')!.depth).toBe(0)
  })

  it('caches a phantom parent 404 so a later page does not re-fetch it', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0009/collections`,
      [
        collectionRow({
          key: 'COLL0010',
          data: { name: 'Orphan', parentCollection: 'MISSING1' },
        }),
      ],
      { 'Last-Modified-Version': '1', 'Total-Results': '1' },
    )
    await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    expect(
      mock.requests.filter((request) => request.pathname === `${apiPath()}/collections/MISSING1`),
    ).toHaveLength(1)
  })

  it('fails closed when parentRef library diverges from the request library', async () => {
    await zoteroError(
      provider.browse({
        kind: 'collections',
        library: { type: 'group', id: 42 },
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      ZOTERO_INVALID_ARGUMENT,
      parentLibraryMismatchMessage({ type: 'user', id: 0 }, { type: 'group', id: 42 }),
    )
  })

  it('rejects parentRef for non-collections kinds', async () => {
    await zoteroError(
      provider.browse({
        kind: 'tags',
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      ZOTERO_INVALID_ARGUMENT,
      PARENT_REF_SCOPE_MESSAGE,
    )
  })

  it('propagates non-404 ancestor failures instead of truncating silently', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001/collections`,
      [collectionRow({ key: 'COLL0002', data: { name: 'Child', parentCollection: 'COLL0001' } })],
      { 'Last-Modified-Version': '1', 'Total-Results': '1' },
    )
    serveStatus(mock, `${apiPath()}/collections/COLL0001`, 500, 'boom')
    await zoteroError(
      provider.browse({
        kind: 'collections',
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      'ZOTERO_UNEXPECTED',
      'HTTP 500',
    )
  })

  it('supports group library', async () => {
    const cols = [collectionRow({ key: 'COLL0001', data: { name: 'G Root' } })]
    serveJson(mock, `${apiPath(GROUP_LIBRARY)}/collections/top`, cols, {
      ...versionHeaders('S2', 1),
      'Total-Results': '1',
    })
    const result = await provider.browse({
      kind: 'collections',
      library: { type: 'group', id: 42 },
      offset: 0,
      limit: 10,
    })
    expect(result.library).toEqual(GROUP_LIBRARY)
  })
})
