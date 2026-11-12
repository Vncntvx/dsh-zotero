/**
 * ScopeDirectory cache-bound, selective-invalidation, and breadcrumb
 * behaviours: the single-object resolution cache is capped, an invalidation
 * drops only the named endpoint's state (cached, in-flight, and breadcrumb),
 * and the breadcrumb walk caches misses without hiding real failures.
 * @module tests/local/scope-directory-invalidation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import {
  readCollectionNode,
  resolveScope,
  ScopeDirectory,
} from '../../src/local/scope-directory.js'
import { PERSONAL_LIBRARY, parseRef } from '../../src/refs.js'
import { testHttpClient } from '../helpers/test-clients.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { zoteroError } from '../helpers/server/assert.js'
import {
  COLLECTION_KEY,
  GROUP_LIBRARY,
  SAVED_SEARCH_KEY,
  apiPath,
  collectionRef,
  savedSearchRef,
} from '../helpers/server/keys.js'
import { collectionRow, listingVersionHeaders, savedSearchRow } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'
import { deferred } from '../helpers/sync.js'

let mock: MockZotero
let directory: ScopeDirectory

beforeEach(async () => {
  mock = await MockZotero.start()
  directory = new ScopeDirectory(
    testHttpClient(mock.baseUrl),
    () => PROVIDER_LIMITS.scopeListingTtlMs,
    () => PROVIDER_LIMITS.graphConcurrency,
  )
})

afterEach(async () => {
  await mock.close()
})

/** Serve both scope listings and both single-object resolutions with one instance. */
function serveScopeSurfaces(): void {
  serveJson(mock, `${apiPath()}/collections`, [collectionRow()], listingVersionHeaders())
  serveJson(mock, `${apiPath()}/searches`, [savedSearchRow()], listingVersionHeaders())
  serveJson(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, collectionRow())
  serveJson(mock, `${apiPath()}/searches/${SAVED_SEARCH_KEY}`, savedSearchRow())
}

function requestsTo(pathname: string): number {
  return mock.requests.filter((entry) => entry.pathname === pathname).length
}

describe('ScopeDirectory selective invalidation', () => {
  it('drops both scope endpoints when invalidation names no endpoint', async () => {
    serveScopeSurfaces()
    await directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await directory.scopeListingOf('searches', { library: PERSONAL_LIBRARY }, undefined)

    directory.invalidate(PERSONAL_LIBRARY)

    await directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await directory.scopeListingOf('searches', { library: PERSONAL_LIBRARY }, undefined)
    expect(requestsTo(`${apiPath()}/collections`)).toBe(2)
    expect(requestsTo(`${apiPath()}/searches`)).toBe(2)
  })

  it('drops only the invalidated endpoint cached listings and resolutions', async () => {
    serveScopeSurfaces()
    await directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await directory.scopeListingOf('searches', { library: PERSONAL_LIBRARY }, undefined)
    await directory.resolveNamed('collection', collectionRef(), PERSONAL_LIBRARY)
    await directory.resolveNamed('search', savedSearchRef(), PERSONAL_LIBRARY)

    directory.invalidate(PERSONAL_LIBRARY, 'collections')

    await directory.scopeListingOf('searches', { library: PERSONAL_LIBRARY }, undefined)
    await directory.resolveNamed('search', savedSearchRef(), PERSONAL_LIBRARY)
    await directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await directory.resolveNamed('collection', collectionRef(), PERSONAL_LIBRARY)
    expect(requestsTo(`${apiPath()}/collections`)).toBe(2)
    expect(requestsTo(`${apiPath()}/searches`)).toBe(1)
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(2)
    expect(requestsTo(`${apiPath()}/searches/${SAVED_SEARCH_KEY}`)).toBe(1)
  })

  it('leaves another endpoint in-flight resolution running when one endpoint is invalidated', async () => {
    const release = deferred<void>()
    const started = deferred<void>()
    mock.route('GET', `${apiPath()}/collections`, (_request, _response, helpers) =>
      helpers.json([collectionRow()], listingVersionHeaders()),
    )
    mock.route('GET', `${apiPath()}/searches/SRCH5678`, async (_request, _response, helpers) => {
      started.resolve()
      await release.promise
      helpers.json(savedSearchRow({ key: 'SRCH5678', data: { name: 'Pending Search' } }))
    })

    const pending = directory.resolveNamed('search', savedSearchRef('SRCH5678'), PERSONAL_LIBRARY)
    await started.promise
    directory.invalidate(PERSONAL_LIBRARY, 'collections')
    release.resolve()
    await expect(pending).resolves.toMatchObject({ name: 'Pending Search' })
    expect(requestsTo(`${apiPath()}/searches/SRCH5678`)).toBe(1)
  })
})

describe('ScopeDirectory resolution cache bound', () => {
  it('evicts the oldest resolution once the cache reaches its limit', async () => {
    const reads: string[] = []
    const client = {
      getJson: async (path: string) => {
        const key = path.split('/').pop()!
        reads.push(key)
        return { json: { key, data: { name: `name-${key}` } }, headers: new Headers() }
      },
    } as unknown as ZoteroHttpClient
    const bounded = new ScopeDirectory(
      client,
      () => 60_000,
      () => 2,
    )
    const keyOf = (index: number): string => `KEY${String(index).padStart(5, '0')}`

    for (let index = 0; index < 513; index += 1) {
      await bounded.resolveNamed('collection', collectionRef(keyOf(index)), PERSONAL_LIBRARY)
    }
    expect(reads).toHaveLength(513)

    // The first resolution was evicted by the cap, so it is read again; the
    // newest one is still cached.
    await expect(
      bounded.resolveNamed('collection', collectionRef(keyOf(0)), PERSONAL_LIBRARY),
    ).resolves.toMatchObject({ name: `name-${keyOf(0)}` })
    expect(reads).toHaveLength(514)
    await expect(
      bounded.resolveNamed('collection', collectionRef(keyOf(512)), PERSONAL_LIBRARY),
    ).resolves.toMatchObject({ name: `name-${keyOf(512)}` })
    expect(reads).toHaveLength(514)
  })
})

describe('ScopeDirectory collection ref reads', () => {
  it('refuses a live collection read that answers a different key', async () => {
    serveJson(mock, `${apiPath()}/collections`, [], listingVersionHeaders())
    serveJson(
      mock,
      `${apiPath()}/collections/${COLLECTION_KEY}`,
      collectionRow({ key: 'DIFF1234', data: { name: 'wrong object' } }),
    )
    await zoteroError(
      directory.resolveCollectionRefs(
        [parseRef(collectionRef())],
        PERSONAL_LIBRARY,
        undefined,
        undefined,
      ),
      ZOTERO_UNEXPECTED,
      `different object than ${COLLECTION_KEY}`,
    )
  })

  it('refuses a direct collection node read that answers a different key', async () => {
    const client = {
      getJson: async () => ({
        json: { key: 'DIFF1234', data: { name: 'wrong object' } },
        headers: new Headers(),
      }),
    } as unknown as ZoteroHttpClient
    await zoteroError(
      readCollectionNode(client, PERSONAL_LIBRARY, COLLECTION_KEY, undefined, undefined),
      ZOTERO_UNEXPECTED,
      `different object than ${COLLECTION_KEY}`,
    )
  })
})

describe('ScopeDirectory breadcrumb node cache', () => {
  it('re-fetches a cached breadcrumb node after its entry expires', async () => {
    serveJson(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, collectionRow())
    let ttl = 60_000
    const expiring = new ScopeDirectory(
      testHttpClient(mock.baseUrl),
      () => ttl,
      () => 2,
    )

    await expect(
      expiring.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        undefined,
      ),
    ).resolves.toEqual(['LLM Papers'])
    ttl = 0
    await expect(
      expiring.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        undefined,
      ),
    ).resolves.toEqual(['LLM Papers'])
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(2)
  })

  it('drops a library breadcrumb node when that library is invalidated', async () => {
    serveJson(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, collectionRow())
    await directory.collectionAncestorNames(
      PERSONAL_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )
    await directory.collectionAncestorNames(
      PERSONAL_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(1)

    directory.invalidate(PERSONAL_LIBRARY, 'collections')
    await directory.collectionAncestorNames(
      PERSONAL_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(2)
  })

  it('keeps another library breadcrumb node when a different library is invalidated', async () => {
    serveJson(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, collectionRow())
    await directory.collectionAncestorNames(
      PERSONAL_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )

    directory.invalidate(GROUP_LIBRARY, 'collections')

    await expect(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        undefined,
      ),
    ).resolves.toEqual(['LLM Papers'])
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(1)
  })

  it('leaves another library in-flight breadcrumb read running when one library is invalidated', async () => {
    const release = deferred<void>()
    const started = deferred<void>()
    mock.route(
      'GET',
      `${apiPath(GROUP_LIBRARY)}/collections/${COLLECTION_KEY}`,
      async (_request, _response, helpers) => {
        started.resolve()
        await release.promise
        helpers.json(collectionRow({ data: { name: 'Group Papers' } }))
      },
    )
    const pending = directory.collectionAncestorNames(
      GROUP_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )
    await started.promise
    directory.invalidate(PERSONAL_LIBRARY, 'collections')
    release.resolve()
    await expect(pending).resolves.toEqual(['Group Papers'])
  })

  it('throws cancellation before reading a breadcrumb node for an aborted caller', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(mock.requests).toHaveLength(0)
  })

  it('caches a missing parent collection for the claimed instance', async () => {
    serveStatus(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, 404, 'Not found')
    await expect(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        'S1',
        undefined,
      ),
    ).resolves.toEqual([])
    await expect(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        'S1',
        undefined,
      ),
    ).resolves.toEqual([])
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(1)
    expect(mock.requests[0]?.headers['zotero-server-id']).toBe('S1')
  })

  it('does not cache a missing parent when the library is invalidated mid-read', async () => {
    const release = deferred<void>()
    const started = deferred<void>()
    mock.route(
      'GET',
      `${apiPath()}/collections/${COLLECTION_KEY}`,
      async (_request, _response, helpers) => {
        started.resolve()
        await release.promise
        helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
      },
    )
    const pending = directory.collectionAncestorNames(
      PERSONAL_LIBRARY,
      'CHLD1234',
      COLLECTION_KEY,
      undefined,
      undefined,
    )
    await started.promise
    directory.invalidate(PERSONAL_LIBRARY, 'collections')
    release.resolve()
    await expect(pending).resolves.toEqual([])
    // The invalidated epoch rejected the miss, so the next walk reads again
    // instead of serving an empty breadcrumb from a stale cached 404.
    await expect(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        undefined,
      ),
    ).resolves.toEqual([])
    expect(requestsTo(`${apiPath()}/collections/${COLLECTION_KEY}`)).toBe(2)
  })

  it('propagates a breadcrumb node failure that is not a missing collection', async () => {
    serveStatus(mock, `${apiPath()}/collections/${COLLECTION_KEY}`, 500, 'Boom')
    await zoteroError(
      directory.collectionAncestorNames(
        PERSONAL_LIBRARY,
        'CHLD1234',
        COLLECTION_KEY,
        undefined,
        undefined,
      ),
      ZOTERO_UNEXPECTED,
    )
  })
})

describe('resolveScope library identity', () => {
  it('keeps a group library scope in its group arm', async () => {
    await expect(resolveScope(directory, { kind: 'library' }, GROUP_LIBRARY)).resolves.toEqual({
      path: 'groups/42/items/top',
      resolved: { kind: 'library', library: { type: 'group', id: GROUP_LIBRARY.id } },
    })
    expect(mock.requests).toHaveLength(0)
  })
})
