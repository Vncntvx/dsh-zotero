/**
 * ItemSchemaDirectory specs: the identity-pinned schema snapshot shared by
 * browse and write. Each spec drives the directory over a stub HTTP client:
 * what is under test is the directory's own bookkeeping — which concurrent
 * schema reads share one request, which claims stay separate, and how the
 * cache keys follow the identity that served them.
 * @module tests/local/item-schema-directory
 */

import { describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ZOTERO_SERVER_ID_HEADER } from '../../src/constants.js'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ItemSchemaDirectory } from '../../src/local/item-schema-directory.js'
import { deferred } from '../helpers/sync.js'

/** One scripted HTTP response: the JSON body the directory parses plus its headers. */
type StubResponse = { json: unknown; headers: Headers }

/** The directory reads only `getJson`, under the caller's claimed instance id. */
type StubGetJson = (
  path: string,
  params: unknown,
  options?: { serverId?: string },
) => Promise<StubResponse>

/**
 * One stub HTTP client for these specs. The directory only reads `getJson`
 * plus (for the write path) the remembered `serverId` claim, so the one unsafe
 * cast stays at this external-stub boundary.
 * @param input - the scripted handler and an optional instance claim.
 * @returns the client the directory consumes.
 */
function stubClient(input: {
  readonly serverId?: string
  readonly getJson: StubGetJson
}): ZoteroHttpClient {
  return input as unknown as ZoteroHttpClient
}

describe('ItemSchemaDirectory', () => {
  it('shares a field read for one item type and separates serving instances', async () => {
    const first = deferred<StubResponse>()
    const second = deferred<StubResponse>()
    const calls: string[] = []
    let activeServerId = 'srv-1'
    const client = stubClient({
      get serverId() {
        return activeServerId
      },
      getJson: async (_path, _params, options) => {
        calls.push(options?.serverId ?? 'unclaimed')
        return options?.serverId === 'srv-1' ? await first.promise : await second.promise
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const a = directory.getWritableItemFields('book')
    const b = directory.getWritableItemFields('book')
    first.resolve({
      json: [{ field: 'title' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })
    const [fieldsA, fieldsB] = await Promise.all([a, b])
    expect(calls).toEqual(['srv-1'])
    expect(fieldsA).toEqual(new Set(['title']))
    expect(fieldsB).toEqual(fieldsA)

    activeServerId = 'srv-2'
    const next = directory.getWritableItemFields('book')
    second.resolve({
      json: [{ field: 'reportType' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-2' }),
    })
    expect(await next).toEqual(new Set(['reportType']))
    expect(calls).toEqual(['srv-1', 'srv-2'])
  })

  it('reuses the field endpoint when browse metadata adds creator types', async () => {
    const calls: string[] = []
    const client = stubClient({
      serverId: 'srv-1',
      getJson: async (path) => {
        calls.push(path)
        return {
          json:
            path === 'itemTypeFields'
              ? [{ field: 'title', localized: 'Title' }]
              : [{ creatorType: 'author', localized: 'Author' }],
          headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
        }
      },
    })
    const directory = new ItemSchemaDirectory(client)

    await directory.getWritableItemFields('book')
    const schema = await directory.getItemFields('book')

    expect(calls).toEqual(['itemTypeFields', 'itemTypeCreatorTypes'])
    expect(schema.items).toEqual([
      { field: 'title', localized: 'Title' },
      { creatorType: 'author', localized: 'Author' },
    ])
  })

  it('memoizes the writable field set under the client claim when the serving instance differs', async () => {
    let requests = 0
    const client = stubClient({
      serverId: 'claim-1',
      getJson: async () => {
        requests += 1
        return {
          json: [{ field: 'title' }],
          headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'served-2' }),
        }
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const first = await directory.getWritableItemFields('book')
    const second = await directory.getWritableItemFields('book')

    expect(requests).toBe(1)
    // One memoized snapshot per (instance, item type) pair: the second read
    // hands out the set the first one built, not a rebuilt copy.
    expect(second).toBe(first)
  })
})

describe('ItemSchemaDirectory schema caching and in-flight deduplication', () => {
  it('shares in-flight getItemTypes request when called concurrently with identical claim', async () => {
    const response = deferred<StubResponse>()
    let callCount = 0
    const client = stubClient({
      getJson: async () => {
        callCount++
        return await response.promise
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const first = directory.getItemTypes(undefined, 'srv-1')
    const second = directory.getItemTypes(undefined, 'srv-1')

    response.resolve({
      json: [{ itemType: 'book', localized: 'Book' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })

    const [res1, res2] = await Promise.all([first, second])
    expect(callCount).toBe(1)
    expect(res1.serverId).toBe('srv-1')
    expect(res1.items).toEqual([{ itemType: 'book', localized: 'Book' }])
    expect(res2).toEqual(res1)
  })

  it('tracks concurrent getItemTypes requests independently for different claims', async () => {
    const firstDef = deferred<StubResponse>()
    const secondDef = deferred<StubResponse>()
    const calls: { endpoint: string; serverId?: string }[] = []

    const client = stubClient({
      getJson: async (endpoint, _params, options) => {
        calls.push({ endpoint, serverId: options?.serverId })
        return options?.serverId === 'srv-1' ? await firstDef.promise : await secondDef.promise
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const first = directory.getItemTypes(undefined, 'srv-1')
    const second = directory.getItemTypes(undefined, 'srv-2')

    firstDef.resolve({
      json: [{ itemType: 'book', localized: 'Book' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })
    secondDef.resolve({
      json: [{ itemType: 'report', localized: 'Report' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-2' }),
    })

    const [res1, res2] = await Promise.all([first, second])
    expect(calls).toHaveLength(2)
    expect(res1.serverId).toBe('srv-1')
    expect(res1.items[0]?.itemType).toBe('book')
    expect(res2.serverId).toBe('srv-2')
    expect(res2.items[0]?.itemType).toBe('report')
  })

  it('caches getItemTypes and satisfies subsequent calls from cache', async () => {
    let callCount = 0
    const client = stubClient({
      getJson: async () => {
        callCount++
        return {
          json: [{ itemType: 'book', localized: 'Book' }],
          headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
        }
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const initial = await directory.getItemTypes(undefined, 'srv-1')
    expect(callCount).toBe(1)
    expect(initial.serverId).toBe('srv-1')

    const withClaim = await directory.getItemTypes(undefined, 'srv-1')
    expect(callCount).toBe(1)
    expect(withClaim).toBe(initial)

    const withoutClaim = await directory.getItemTypes()
    expect(callCount).toBe(1)
    expect(withoutClaim).toBe(initial)
  })

  it('shares in-flight getItemFields request when called concurrently with same itemType and claim', async () => {
    const fieldsDef = deferred<StubResponse>()
    const creatorDef = deferred<StubResponse>()
    let callCount = 0

    const client = stubClient({
      getJson: async (endpoint) => {
        callCount++
        if (endpoint === 'itemTypeFields') return await fieldsDef.promise
        return await creatorDef.promise
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const first = directory.getItemFields('book')
    const second = directory.getItemFields('book')

    fieldsDef.resolve({
      json: [{ field: 'title', localized: 'Title' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })
    creatorDef.resolve({
      json: [{ creatorType: 'author', localized: 'Author' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })

    const [res1, res2] = await Promise.all([first, second])
    expect(callCount).toBe(2)
    expect(res1.serverId).toBe('srv-1')
    expect(res2).toEqual(res1)
  })

  it('caches getItemFields in O(1) by serverId and default alias when claim is omitted', async () => {
    let callCount = 0
    const client = stubClient({
      getJson: async (endpoint) => {
        callCount++
        if (endpoint === 'itemTypeFields') {
          return {
            json: [{ field: 'title', localized: 'Title' }],
            headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
          }
        }
        return {
          json: [{ creatorType: 'author', localized: 'Author' }],
          headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
        }
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const res1 = await directory.getItemFields('book')
    expect(callCount).toBe(2)
    expect(res1.serverId).toBe('srv-1')

    const res2 = await directory.getItemFields('book')
    expect(callCount).toBe(2)
    expect(res2).toBe(res1)

    const res3 = await directory.getItemFields('book', undefined, 'srv-1')
    expect(callCount).toBe(2)
    expect(res3).toBe(res1)
  })

  it('populates default alias when fetched with a specific claim so unclaimed calls hit cache', async () => {
    let callCount = 0
    const client = stubClient({
      getJson: async (endpoint) => {
        callCount++
        if (endpoint === 'itemTypeFields') {
          return {
            json: [{ field: 'title', localized: 'Title' }],
            headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
          }
        }
        return {
          json: [{ creatorType: 'author', localized: 'Author' }],
          headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
        }
      },
    })
    const directory = new ItemSchemaDirectory(client)

    const res1 = await directory.getItemFields('book', undefined, 'srv-1')
    expect(callCount).toBe(2)

    const res2 = await directory.getItemFields('book')
    expect(callCount).toBe(2)
    expect(res2).toBe(res1)
  })

  it('starts a new read instead of joining an aborted but unsettled in-flight read', async () => {
    const firstResponse = deferred<StubResponse>()
    const secondResponse = deferred<StubResponse>()
    const firstRequestStarted = deferred<void>()
    let callCount = 0
    const client = stubClient({
      getJson: async () => {
        callCount++
        if (callCount === 1) {
          firstRequestStarted.resolve()
          return await firstResponse.promise
        }
        return await secondResponse.promise
      },
    })
    const directory = new ItemSchemaDirectory(client)

    // The sole waiter cancelling aborts the shared operation's controller while
    // its load is still pending: the operation is doomed but not yet settled.
    const cancelled = new AbortController()
    const abandoned = directory.getItemTypes(cancelled.signal, 'srv-1')
    await firstRequestStarted.promise
    cancelled.abort()
    await expect(abandoned).rejects.toMatchObject({ code: TOOL_ABORTED })

    // The aborted operation must not be joined: a fresh read issues its own
    // request instead of inheriting a cancellation it did not cause.
    const fresh = directory.getItemTypes(undefined, 'srv-1')
    expect(callCount).toBe(2)
    secondResponse.resolve({
      json: [{ itemType: 'book', localized: 'Book' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })
    const schema = await fresh
    expect(schema.items).toEqual([{ itemType: 'book', localized: 'Book' }])

    // Settle the abandoned load after its caller is gone; its own promise was
    // already abandoned, so this only exercises the cleanup path.
    firstResponse.resolve({
      json: [{ itemType: 'report', localized: 'Report' }],
      headers: new Headers({ [ZOTERO_SERVER_ID_HEADER]: 'srv-1' }),
    })
    await Promise.resolve()
    await Promise.resolve()
  })
})
