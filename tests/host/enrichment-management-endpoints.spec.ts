/** The two management endpoints keep session authorization and full cleanup on the host. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/service.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { parseDomain } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'

const owned: ReturnType<typeof parseDomain>[] = []
function domain() {
  const value = parseDomain()
  owned.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (value) => await value.dispose()))
})

function service(world: ReturnType<typeof parseDomain>, allowed: boolean) {
  world.ctx.provide('remoteAccess', {
    allows: vi.fn(() => allowed),
  } as never)
  return new EnrichmentService(
    world.ctx,
    {},
    {
      client: world.deps.client,
      store: async () => world.store,
      parse: vi.fn(async () => {
        throw new Error('management must not parse')
      }),
    },
  )
}

describe('management endpoints', () => {
  it('lists and discards a committed artifact for an authorized session', async () => {
    const world = domain()
    await world.store.put(CACHE_KEY, ARTIFACT)
    await world.store.putSources(['c'.repeat(64)], SOURCE_RECORD)
    const endpoint = service(world, true)
    const list = await endpoint.listParsedDocuments(
      { sessionId: 's1', offset: 0, limit: 50 },
      new AbortController().signal,
    )
    expect(list.total).toBe(1)
    expect(list.rows[0]!.artifactId).toBe(CACHE_KEY)
    const discarded = await endpoint.discardParsedDocument(
      { sessionId: 's1', artifactId: CACHE_KEY },
      new AbortController().signal,
    )
    expect(discarded.kind).toBe('discarded')
    expect(await world.store.get(CACHE_KEY)).toBeUndefined()
  })

  it('refuses both endpoints when the session is not authorized', async () => {
    const world = domain()
    const endpoint = service(world, false)
    const signal = new AbortController().signal
    await expect(
      endpoint.listParsedDocuments({ sessionId: 's1', offset: 0, limit: 50 }, signal),
    ).rejects.toBeInstanceOf(RemoteError)
    await expect(
      endpoint.discardParsedDocument({ sessionId: 's1', artifactId: CACHE_KEY }, signal),
    ).rejects.toBeInstanceOf(RemoteError)
  })
})
