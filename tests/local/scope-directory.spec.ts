/**
 * ScopeDirectory sharing, cancellation, and caching specs. Each spec drives
 * the directory over a stub HTTP client: what is under test is the
 * directory's own bookkeeping — which concurrent reads share one request,
 * which cancellation aborts it, which refresh generation survives, and when a
 * scope read must refuse a response that names a different object.
 * @module tests/local/scope-directory
 */

import { describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ZOTERO_SERVER_ID_HEADER } from '../../src/constants.js'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { PERSONAL_LIBRARY } from '../../src/refs.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { COLLECTION_KEY } from '../helpers/server/keys.js'
import { deferred } from '../helpers/sync.js'

describe('ScopeDirectory scope-listing sharing and cancellation', () => {
  it('lets one cancelled waiter leave a shared scope read running for another', async () => {
    const response = deferred<{ json: unknown; headers: Headers }>()
    let reads = 0
    const client = {
      getJson: async () => {
        reads += 1
        return await response.promise
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
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
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
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
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
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
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
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

  it('shares one in-flight request across concurrent forced refreshes', async () => {
    const first = deferred<{ json: unknown; headers: Headers }>()
    const started = deferred<void>()
    let reads = 0
    const client = {
      getJson: async () => {
        reads += 1
        started.resolve()
        return await first.promise
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    const firstForce = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    await started.promise
    const secondForce = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    first.resolve({ json: [], headers: new Headers() })
    await expect(Promise.all([firstForce, secondForce])).resolves.toHaveLength(2)
    // Both callers forced for the same reason (the cache missed), so they want
    // the same fresh answer: one request serves both. A per-call key would
    // have sent two.
    expect(reads).toBe(1)
  })

  it('keeps the forced listing when a slower normal response settles after it', async () => {
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
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    const normal = directory.scopeListingOf('collections', { library: PERSONAL_LIBRARY }, undefined)
    await started[0]?.promise
    const forced = directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
      { force: true },
    )
    await started[1]?.promise
    // The forced read answers first and is the newer generation; the normal
    // read that started earlier settles late and must not overwrite it.
    second.resolve({
      json: [{ key: 'NEW12345', data: { name: 'new' } }],
      headers: new Headers(),
    })
    first.resolve({
      json: [{ key: 'OLD12345', data: { name: 'old' } }],
      headers: new Headers(),
    })
    await expect(Promise.all([normal, forced])).resolves.toHaveLength(2)
    const cached = await directory.scopeListingOf(
      'collections',
      { library: PERSONAL_LIBRARY },
      undefined,
    )
    expect(cached.entries.map((entry) => entry.key)).toEqual(['NEW12345'])
    expect(reads).toBe(2)
  })
})

describe('scope read key consistency', () => {
  it('refuses a scope read whose response names a different object than the request', async () => {
    // The ref names COLL1234, but the body answers with another valid key:
    // fail loud rather than silently re-pointing the scope (write-domain's
    // readItem enforces the same rule).
    const client = {
      getJson: async () => ({
        json: { key: 'DIFF1234', data: { name: 'renamed' } },
        headers: new Headers(),
      }),
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    await expect(
      directory.resolveNamed(
        'collection',
        `zotero://user/0/collection/${COLLECTION_KEY}`,
        PERSONAL_LIBRARY,
      ),
    ).rejects.toThrow(/different object than COLL1234/)
  })

  it('accepts a scope read whose response key matches the request', async () => {
    const client = {
      getJson: async () => ({
        json: { key: COLLECTION_KEY, data: { name: 'Papers' } },
        headers: new Headers(),
      }),
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => PROVIDER_LIMITS.scopeListingTtlMs,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    const resolved = await directory.resolveNamed(
      'collection',
      `zotero://user/0/collection/${COLLECTION_KEY}`,
      PERSONAL_LIBRARY,
    )
    expect(resolved.name).toBe('Papers')
    expect(resolved.ref.key).toBe(COLLECTION_KEY)
  })
})

describe('scope resolution ref caching', () => {
  const REF = `zotero://user/0/collection/${COLLECTION_KEY}`

  function resolvingClient(reads: { count: number }): ZoteroHttpClient {
    return {
      getJson: async () => {
        reads.count += 1
        return { json: { key: COLLECTION_KEY, data: { name: 'Papers' } }, headers: new Headers() }
      },
    } as unknown as ZoteroHttpClient
  }

  it('serves a second ref resolution from the cache within the TTL', async () => {
    const reads = { count: 0 }
    const directory = new ScopeDirectory(
      resolvingClient(reads),
      () => 60_000,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    const first = await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    const second = await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    expect(second.name).toBe(first.name)
    expect(reads.count).toBe(1)
  })

  it('re-fetches a ref resolution after the directory invalidates its endpoint', async () => {
    const reads = { count: 0 }
    const directory = new ScopeDirectory(
      resolvingClient(reads),
      () => 60_000,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    directory.invalidate(PERSONAL_LIBRARY, 'collections')
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    expect(reads.count).toBe(2)
  })

  it('re-fetches a cached resolution pinned to a different server instance', async () => {
    const reads = { count: 0 }
    const client = {
      getJson: async () => {
        reads.count += 1
        return {
          json: { key: COLLECTION_KEY, data: { name: 'Papers' } },
          headers: new Headers([[ZOTERO_SERVER_ID_HEADER, reads.count === 1 ? 'S1' : 'S2']]),
        }
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => 60_000,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    // Same TTL window, but this caller claims another instance: the cached
    // entry was served by S1 and cannot answer for S2.
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY, undefined, 'S2')
    expect(reads.count).toBe(2)
  })

  it('re-fetches a ref resolution past its TTL', async () => {
    const reads = { count: 0 }
    let ttl = 60_000
    const directory = new ScopeDirectory(
      resolvingClient(reads),
      () => ttl,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    ttl = 0
    await directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    expect(reads.count).toBe(2)
  })

  it('shares one in-flight ref resolution across concurrent callers', async () => {
    const response = deferred<{ json: unknown; headers: Headers }>()
    let reads = 0
    const client = {
      getJson: async () => {
        reads += 1
        return await response.promise
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => 60_000,
      () => PROVIDER_LIMITS.graphConcurrency,
    )
    const first = directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    const second = directory.resolveNamed('collection', REF, PERSONAL_LIBRARY)
    response.resolve({
      json: { key: COLLECTION_KEY, data: { name: 'Papers' } },
      headers: new Headers(),
    })
    const [a, b] = await Promise.all([first, second])
    expect(a.name).toBe('Papers')
    expect(b.name).toBe('Papers')
    expect(reads).toBe(1)
  })
})
