/**
 * `ScopeDirectory.resolveCollectionRefs` — the write path's batch ref
 * resolution. One cached listing proves every key it carries; only keys the
 * listing lacks fall back to single-object reads (typed 404 included), and a
 * ref claiming another serving instance is never silently re-pointed at this
 * instance's object. Input order is preserved.
 * @module tests/local/write-collection-refs
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND } from '../../src/errors.js'
import { parseRef } from '../../src/refs.js'
import type { ZoteroObjectRef } from '../../src/types.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { testHttpClient } from '../helpers/test-clients.js'

const SERVER_ID = 'srv-coll-refs-1'
const LIBRARY = { type: 'user', id: 0 } as const
const LISTING_PATH = '/api/users/0/collections'

let mock: MockZotero
let directory: ScopeDirectory

const ref = (key: string): ZoteroObjectRef => parseRef(`zotero://user/0/collection/${key}`)

beforeEach(async () => {
  mock = await MockZotero.start()
  const client = testHttpClient(mock.baseUrl, { maxResponseBytes: 1_000_000 })
  // TTL 0: every case decides freshness itself; the in-flight sharing and the
  // identity contract are what these specs observe.
  directory = new ScopeDirectory(client, () => 0)
})

afterEach(async () => {
  await mock.close()
})

function serveListing(rows: readonly unknown[], headers: Record<string, string> = {}): void {
  mock.route('GET', LISTING_PATH, (_req, res, helpers) => helpers.json(rows, headers))
}

describe('resolveCollectionRefs', () => {
  it('proves listed keys through one listing read and preserves input order', async () => {
    serveListing(
      [
        { key: 'COLL0002', version: 3, data: { key: 'COLL0002', name: 'Second' } },
        { key: 'COLL0001', version: 2, data: { key: 'COLL0001', name: 'First' } },
      ],
      { 'Zotero-Server-ID': SERVER_ID },
    )
    const resolved = await directory.resolveCollectionRefs(
      [ref('COLL0001'), ref('COLL0002')],
      LIBRARY,
      undefined,
      undefined,
    )
    expect(resolved.map((r) => r.key)).toEqual(['COLL0001', 'COLL0002'])
    expect(resolved.every((r) => r.serverId === SERVER_ID)).toBe(true)
    expect(mock.requests.filter((r) => r.pathname === LISTING_PATH)).toHaveLength(1)
    expect(
      mock.requests.filter((r) => r.pathname.startsWith('/api/users/0/collections/COLL')),
    ).toHaveLength(0)
  })

  it('falls back to a per-key read for a key the listing lacks', async () => {
    serveListing([{ key: 'COLL0001', version: 2, data: { key: 'COLL0001', name: 'First' } }], {
      'Zotero-Server-ID': SERVER_ID,
    })
    mock.route('GET', '/api/users/0/collections/COLL0009', (_req, res, helpers) =>
      helpers.json(
        { key: 'COLL0009', version: 9, data: { key: 'COLL0009', name: 'Late' } },
        { 'Zotero-Server-ID': SERVER_ID },
      ),
    )
    const resolved = await directory.resolveCollectionRefs(
      [ref('COLL0009'), ref('COLL0001')],
      LIBRARY,
      undefined,
      undefined,
    )
    expect(resolved.map((r) => r.key)).toEqual(['COLL0009', 'COLL0001'])
    expect(
      mock.requests.filter((r) => r.pathname === '/api/users/0/collections/COLL0009'),
    ).toHaveLength(1)
  })

  it('answers an unknown key with the typed not-found instead of inventing a ref', async () => {
    serveListing([], { 'Zotero-Server-ID': SERVER_ID })
    await expect(
      directory.resolveCollectionRefs([ref('COLL0040')], LIBRARY, undefined, undefined),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
  })

  it('never lets the listing answer a ref whose claim mismatches; a live read decides', async () => {
    serveListing([{ key: 'COLL0001', version: 2, data: { key: 'COLL0001', name: 'First' } }], {
      'Zotero-Server-ID': SERVER_ID,
    })
    mock.route('GET', '/api/users/0/collections/COLL0001', (_req, res, helpers) =>
      helpers.json(
        { key: 'COLL0001', version: 2, data: { key: 'COLL0001', name: 'First' } },
        { 'Zotero-Server-ID': SERVER_ID },
      ),
    )
    const stale = parseRef('zotero://user/0/collection/COLL0001?server=OTHER1234')
    const resolved = await directory.resolveCollectionRefs([stale], LIBRARY, undefined, undefined)
    // The resolved ref carries the live answer's identity, never the stale
    // claim — and the live read, not the listing, proved it.
    expect(resolved[0]?.serverId).toBe(SERVER_ID)
    expect(
      mock.requests.filter((r) => r.pathname === '/api/users/0/collections/COLL0001'),
    ).toHaveLength(1)
  })

  it('refuses a ref naming another library before any network happens', async () => {
    const group = parseRef('zotero://group/42/collection/GROUP001')
    await expect(
      directory.resolveCollectionRefs([group], LIBRARY, undefined, undefined),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    expect(mock.requests).toHaveLength(0)
  })

  it('resolves nothing without any request for an empty batch', async () => {
    const resolved = await directory.resolveCollectionRefs([], LIBRARY, undefined, undefined)
    expect(resolved).toEqual([])
    expect(mock.requests).toHaveLength(0)
  })
})
