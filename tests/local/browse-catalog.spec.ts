/**
 * The static vocabulary catalogs `zotero_browse` serves from the plugin's own
 * tables: item types and item fields. These are client-sliced listings (the
 * whole catalog is in memory, so pagination is slicing, not server paging),
 * which is why their ordering and `nextOffset` rules differ from the
 * server-paged domains in `browse.spec.ts`.
 * @module tests/local/browse-catalog
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../helpers/server/assert.js'
import { serveJson } from '../helpers/server/serve.js'
import {
  ITEM_FIELDS_ITEM_TYPE_MESSAGE,
  ITEM_TYPE_SCOPE_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SERVER_MISMATCH,
  libraryNotAllowedMessage,
} from '../../src/errors.js'

let mock: MockZotero
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

describe('browse: itemFields', () => {
  it('lists the fields and creator types valid for one item type', async () => {
    const seen: string[] = []
    mock.route('GET', '/api/itemTypeFields', (req, res, helpers, search) => {
      expect(search.get('itemType')).toBe('dataset')
      seen.push('fields')
      helpers.json([
        { field: 'repository', localized: 'Repository' },
        { field: 'versionNumber', localized: 'Version' },
      ])
    })
    mock.route('GET', '/api/itemTypeCreatorTypes', (req, res, helpers) => {
      seen.push('creators')
      helpers.json([{ creatorType: 'author', localized: 'Author' }])
    })
    const result = await provider.browse({
      kind: 'itemFields',
      itemType: 'dataset',
      offset: 0,
      limit: 10,
    })
    expect(seen).toEqual(['fields', 'creators'])
    expect(result.total).toBe(3)
    expect(result.items).toEqual([
      { field: 'repository', localized: 'Repository' },
      { field: 'versionNumber', localized: 'Version' },
      { creatorType: 'author', localized: 'Author' },
    ])
  })

  it('paginates itemFields against the merged row list', async () => {
    serveJson(mock, '/api/itemTypeFields', [{ field: 'a' }, { field: 'b' }])
    serveJson(mock, '/api/itemTypeCreatorTypes', [{ creatorType: 'author' }])
    const page = await provider.browse({
      kind: 'itemFields',
      itemType: 'journalArticle',
      offset: 0,
      limit: 2,
    })
    expect(page.returned).toBe(2)
    expect(page.nextOffset).toBe(2)
  })

  it('refuses itemFields whose two reads report different instances', async () => {
    // The field list and the creator types compose one result. Across a
    // profile switch the two parallel reads can be served by different
    // instances, and attributing either body to the other's identity would
    // mix two libraries' schemas.
    serveJson(mock, '/api/itemTypeFields', [{ field: 'a' }], { 'Zotero-Server-ID': 'S1' })
    serveJson(mock, '/api/itemTypeCreatorTypes', [{ creatorType: 'author' }], {
      'Zotero-Server-ID': 'S2',
    })
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'journalArticle', offset: 0, limit: 5 }),
      ZOTERO_SERVER_MISMATCH,
    )
  })

  it('takes the instance id from whichever itemFields read reports one', async () => {
    serveJson(mock, '/api/itemTypeFields', [{ field: 'a' }], { 'Zotero-Server-ID': 'S1' })
    serveJson(mock, '/api/itemTypeCreatorTypes', [{ creatorType: 'author' }])
    const result = await provider.browse({
      kind: 'itemFields',
      itemType: 'journalArticle',
      offset: 0,
      limit: 5,
    })
    expect(result.serverId).toBe('S1')
    expect(result.total).toBe(2)
  })

  it('fails closed without a well-formed item type or with a library', async () => {
    await zoteroError(
      provider.browse({ kind: 'itemFields', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_FIELDS_ITEM_TYPE_MESSAGE,
    )
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'bad type!', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_FIELDS_ITEM_TYPE_MESSAGE,
    )
    await zoteroError(
      provider.browse({
        kind: 'itemFields',
        itemType: 'dataset',
        library: { type: 'user', id: 0 },
        offset: 0,
        limit: 5,
      }),
      ZOTERO_INVALID_ARGUMENT,
      libraryNotAllowedMessage('itemFields'),
    )
    await zoteroError(
      provider.browse({ kind: 'tags', itemType: 'dataset', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_TYPE_SCOPE_MESSAGE,
    )
    expectRequestCount(mock, 0)
  })
})

describe('browse: itemTypes', () => {
  it('lists item types', async () => {
    const types = [{ itemType: 'book', localized: 'Book' }, { itemType: 'journalArticle' }]
    serveJson(mock, '/api/itemTypes', types)
    const result = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
  })
  it('paginates itemTypes', async () => {
    const types = Array.from({ length: 5 }, (_, i) => ({ itemType: `type${i}` }))
    serveJson(mock, '/api/itemTypes', types)
    const r = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 2 })
    expect(r.returned).toBe(2)
  })
})
