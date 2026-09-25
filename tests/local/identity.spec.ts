/**
 * Instance-identity specs: a read pinned to one Zotero instance (a ref
 * carrying `?server=`) must never consume a scope listing cached under a
 * different `Zotero-Server-ID`, even inside the TTL window. After a profile
 * or database switch, same-key objects are different objects, so serving the
 * old instance's cached graph would be a provenance error.
 * @module tests/provider/identity
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ZoteroHttpClient } from '../../src/http-client.js'
import { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import {
  LocalApiProvider,
  type LocalApiProvider as LocalApiProviderType,
} from '../../src/local/provider.js'
import { parseRef, PERSONAL_LIBRARY } from '../../src/refs.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  COLLECTION_KEY,
  GROUP_LIBRARY,
  ITEM_KEY,
  apiPath,
  itemRef,
  refOf,
} from '../helpers/server/keys.js'
import { collectionRow, item, versionHeaders } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'
import { deferred } from '../helpers/sync.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProviderType
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
const PARENT = item({ meta: { numChildren: 0 }, data: { collections: [COLLECTION_KEY] } })

/** The canonical collection row, renamed to say which instance served it. */
function collectionListing(instance: 'A' | 'B'): unknown[] {
  return [collectionRow({ data: { name: `${instance} Papers` } })]
}

describe('Server-ID cache identity', () => {
  it('re-fetches a claimed listing served by another instance inside the TTL', async () => {
    let instance: 'A' | 'B' = 'A'
    // Both routes answer as the current instance, which flips before the
    // second read; a serve* helper would freeze the first response.
    mock.route('GET', `${apiPath()}/items/${ITEM_KEY}`, (req, res, helpers) =>
      helpers.json(PARENT, versionHeaders(instance)),
    )
    mock.route('GET', `${apiPath()}/collections`, (req, res, helpers) =>
      helpers.json(collectionListing(instance), versionHeaders(instance)),
    )

    // First read pins instance A's listing in the TTL cache.
    const first = await provider.getItem({
      ref: parseRef(itemRef()),
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
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT, versionHeaders(instance))
    serveJson(
      mock,
      `${apiPath()}/collections`,
      collectionListing(instance),
      versionHeaders(instance),
    )

    await provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(),
    })
    // A second unclaimed read rides the cached listing — no identity claim,
    // so the entry's own TTL governs staleness as before.
    await provider.getItem({
      ref: parseRef(itemRef()),
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
    // Both values change before the claiming read; a serve* helper would
    // freeze the anonymous first answer.
    mock.route('GET', `${apiPath()}/items/${ITEM_KEY}`, (req, res, helpers) =>
      helpers.json(PARENT, sendId ? versionHeaders('B') : {}),
    )
    mock.route('GET', `${apiPath()}/collections`, (req, res, helpers) =>
      helpers.json(
        [collectionRow({ data: { name: servedName } })],
        sendId ? versionHeaders('B') : {},
      ),
    )

    await provider.getItem({
      ref: parseRef(itemRef()),
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
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT, versionHeaders(instance))
    serveJson(
      mock,
      `${apiPath()}/collections`,
      collectionListing(instance),
      versionHeaders(instance),
    )
    serveJson(mock, `${apiPath(GROUP_LIBRARY)}/items/${ITEM_KEY}`, PARENT, versionHeaders(instance))
    serveJson(
      mock,
      `${apiPath(GROUP_LIBRARY)}/collections`,
      collectionListing(instance),
      versionHeaders(instance),
    )

    const personal = await provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(),
    })
    const group = await provider.getItem({
      ref: parseRef(refOf('item', ITEM_KEY, GROUP_LIBRARY)),
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

  it('reports no write state from a provider that wires no write capability', async () => {
    mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': 'srv-identity-1' }, JSON.stringify({})),
    )
    const status = await provider.status()
    expect(status.connected).toBe(true)
    expect(status.write).toBeUndefined()
  })

  it('reports the write state with the stored-grant fact when the capability is wired', async () => {
    const client = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 1_000_000,
    })
    const writer = new ZoteroWriteHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 1_000_000,
    })
    const writable = new LocalApiProvider(
      client,
      {
        maxNoteScanRecords: 200,
        maxDetailChars: 500,
        maxNoteBodyChars: 30_000,
        maxNoteChars: 2000,
        maxNoteRecords: 50,
        maxAnnotationRecords: 100,
        fulltextChunkWords: 200,
        maxEvidenceChars: 6000,
        maxEvidencePassages: 4,
        maxFulltextChars: 100_000,
        maxExportChars: 1_000_000,
        defaultStyle: 'apa',
        defaultLocale: 'en-US',
        maxBrowseResults: 50,
        maxChangesResults: 50,
      },
      {},
      writer,
      new WriteAuthorizer({ client: writer, persistKey: () => true }),
    )
    mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': 'srv-identity-1' }, JSON.stringify({})),
    )
    const status = await writable.status()
    expect(status.write).toEqual({ enabled: true, authorized: false })
  })

  it('lets one cancelled waiter leave a shared scope read running for another', async () => {
    const response = deferred<{ json: unknown; headers: Headers }>()
    let reads = 0
    const client = {
      getJson: async () => {
        reads += 1
        return await response.promise
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(client)
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(
      directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, alreadyAborted.signal),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(reads).toBe(0)
    const controller = new AbortController()
    const cancelled = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      controller.signal,
    )
    const live = directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: TOOL_ABORTED })
    response.resolve({ json: [], headers: new Headers() })
    await expect(live).resolves.toMatchObject({ entries: [] })
    expect(reads).toBe(1)
  })

  it('aborts a scope read when its sole waiter cancels', async () => {
    let requestSignal: AbortSignal | undefined
    const started = deferred<void>()
    const client = {
      getJson: async (
        _path: string,
        _query: URLSearchParams | undefined,
        options: { signal?: AbortSignal } | undefined,
      ) => {
        requestSignal = options?.signal
        started.resolve()
        return await new Promise<{ json: unknown; headers: Headers }>((_, reject) => {
          requestSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(client)
    const controller = new AbortController()
    const pending = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      controller.signal,
    )
    await started.promise
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('does not serve a warm listing to an already-cancelled caller', async () => {
    let reads = 0
    const client = {
      getJson: async () => {
        reads += 1
        return { json: [], headers: new Headers() }
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(client)
    await directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    const controller = new AbortController()
    controller.abort()
    await expect(
      directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, controller.signal),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(reads).toBe(1)
  })

  it('does not join a normal in-flight listing to a forced refresh', async () => {
    const first = deferred<{ json: unknown; headers: Headers }>()
    const second = deferred<{ json: unknown; headers: Headers }>()
    const started = [deferred<void>(), deferred<void>()]
    let reads = 0
    const client = {
      getJson: async () => {
        const index = reads++
        started[index]?.resolve()
        return await (index === 0 ? first.promise : second.promise)
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(client)
    const normal = directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await started[0]?.promise
    const forced = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    await started[1]?.promise
    expect(reads).toBe(2)
    first.resolve({ json: [], headers: new Headers() })
    second.resolve({ json: [], headers: new Headers() })
    await expect(Promise.all([normal, forced])).resolves.toHaveLength(2)
  })

  it('keeps the newest forced listing when responses settle out of order', async () => {
    const first = deferred<{ json: unknown; headers: Headers }>()
    const second = deferred<{ json: unknown; headers: Headers }>()
    const started = [deferred<void>(), deferred<void>()]
    let reads = 0
    const client = {
      getJson: async () => {
        const index = reads++
        started[index]?.resolve()
        return await (index === 0 ? first.promise : second.promise)
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(client)
    const firstForce = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    await started[0]?.promise
    const secondForce = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    await started[1]?.promise
    second.resolve({
      json: [{ key: 'NEW12345', data: { name: 'new' } }],
      headers: new Headers(),
    })
    first.resolve({
      json: [{ key: 'OLD12345', data: { name: 'old' } }],
      headers: new Headers(),
    })
    await expect(Promise.all([firstForce, secondForce])).resolves.toHaveLength(2)
    const cached = await directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
    )
    expect(cached.entries.map((entry) => entry.key)).toEqual(['NEW12345'])
    expect(reads).toBe(2)
  })

  it('carries the error code in the status diagnosis so callers can route on it', async () => {
    serveStatus(mock, '/api/', 403, 'forbidden')
    const status = await provider.status()
    expect(status.connected).toBe(false)
    expect(status.diagnosis).toContain('ZOTERO_API_DISABLED')
  })
})
