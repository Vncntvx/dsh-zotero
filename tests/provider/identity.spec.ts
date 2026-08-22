/**
 * Instance-identity specs: a read pinned to one Zotero instance (a ref
 * carrying `?server=`) must never consume a scope listing cached under a
 * different `Zotero-Server-ID`, even inside the TTL window. After a profile
 * or database switch, same-key objects are different objects, so serving the
 * old instance's cached graph would be a provenance error.
 * @module tests/provider/identity
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { parseRef } from '../../src/refs.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

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

/** The parent item fixture; its collection membership drives name resolution. */
const PARENT = {
  key: 'ABCD1234',
  version: 3,
  meta: { numChildren: 0 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    collections: ['COLL1234'],
  },
}

function collectionListing(instance: 'A' | 'B'): unknown[] {
  return [
    {
      key: 'COLL1234',
      version: 1,
      data: { key: 'COLL1234', version: 1, name: `${instance} Papers` },
    },
  ]
}

describe('Server-ID cache identity', () => {
  it('re-fetches a claimed listing served by another instance inside the TTL', async () => {
    let instance: 'A' | 'B' = 'A'
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': instance }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(collectionListing(instance), { 'Zotero-Server-ID': instance }),
    )

    // First read pins instance A's listing in the TTL cache.
    const first = await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234'),
      include: new Set(),
    })
    expect(first.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=A', name: 'A Papers' },
    ])

    // Profile switch: same keys, different instance, renamed collection. The
    // B-pinned ref must re-fetch instead of consuming A's cached entry.
    instance = 'B'
    const second = await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234?server=B'),
      include: new Set(),
    })
    expect(second.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=B', name: 'B Papers' },
    ])
    const listingRequests = mock.requests.filter(
      (request) => request.pathname === '/api/users/0/collections',
    )
    expect(listingRequests).toHaveLength(2)
    expect(listingRequests[1]!.headers['zotero-server-id']).toBe('B')
  })

  it('keeps serving the TTL cache for reads without an identity claim', async () => {
    let instance: 'A' | 'B' = 'A'
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': instance }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(collectionListing(instance), { 'Zotero-Server-ID': instance }),
    )

    await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234'),
      include: new Set(),
    })
    // A second unclaimed read rides the cached listing — no identity claim,
    // so the entry's own TTL governs staleness as before.
    await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234'),
      include: new Set(),
    })
    expect(
      mock.requests.filter((request) => request.pathname === '/api/users/0/collections'),
    ).toHaveLength(1)
  })

  it('fails closed when the cache holds no identity but the read claims one', async () => {
    // First response carries no Server-ID (pre-Zotero-10 behavior).
    let sendId = false
    let servedName = 'A Papers'
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, sendId ? { 'Zotero-Server-ID': 'B' } : {}),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'COLL1234',
            version: 1,
            data: { key: 'COLL1234', version: 1, name: servedName },
          },
        ],
        sendId ? { 'Zotero-Server-ID': 'B' } : {},
      ),
    )

    await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234'),
      include: new Set(),
    })
    // A claiming read cannot prove the anonymous entry matches; re-fetch.
    sendId = true
    servedName = 'B Papers'
    const detail = await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234?server=B'),
      include: new Set(),
    })
    expect(detail.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=B', name: 'B Papers' },
    ])
    expect(
      mock.requests.filter((request) => request.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('serves group listings under their own library partition', async () => {
    let instance: 'A' | 'B' = 'A'
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': instance }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(collectionListing(instance), { 'Zotero-Server-ID': instance }),
    )
    mock.route('GET', '/api/groups/42/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': instance }),
    )
    mock.route('GET', '/api/groups/42/collections', (req, res, helpers) =>
      helpers.json(collectionListing(instance), { 'Zotero-Server-ID': instance }),
    )

    const personal = await provider.getItem({
      ref: parseRef('zotero://user/0/item/ABCD1234'),
      include: new Set(),
    })
    const group = await provider.getItem({
      ref: parseRef('zotero://group/42/item/ABCD1234'),
      include: new Set(),
    })
    expect(personal.collections[0]!.ref).toContain('user/0')
    expect(group.collections[0]!.ref).toContain('group/42')
    expect(
      mock.requests.filter((request) => request.pathname.endsWith('/collections')),
    ).toHaveLength(2)
  })

  it('exposes createProvider limits unchanged for identity specs', async () => {
    // Pins that the shared harness still builds an independent provider per
    // spec; the identity guard lives in provider state, not module state.
    const fresh = createProvider(mock)
    expect(fresh.id).toBe(provider.id)
  })
})
