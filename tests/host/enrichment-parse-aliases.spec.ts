/** Active parsing publishes canonical source aliases and retains committed artifacts across modes. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { EnrichmentService } from '../../src/enrichment/service.ts'
import { ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_INVALID_ARGUMENT } from '../../src/errors.ts'
import { deferred } from '../helpers/sync.ts'
import {
  LOCAL,
  MARKDOWN,
  NEXT_GENERATION,
  PDF,
  URL,
  URL_INPUT,
  parseDomain,
} from './support/enrichment-parse-domain.ts'

const owned: ReturnType<typeof parseDomain>[] = []
function domain() {
  const world = parseDomain()
  owned.push(world)
  return world
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (world) => await world.dispose()))
})
const FINAL = 'https://cdn.example/paper.pdf?signature=private'
function linked(world: ReturnType<typeof parseDomain>) {
  world.resolveAttachment.mockResolvedValue({ kind: 'url', url: URL })
  const normal = world.fetch.getMockImplementation()!
  world.fetch.mockImplementation(async (url, init) =>
    url === URL
      ? new Response(null, { status: 302, headers: { location: FINAL } })
      : await normal(url, init),
  )
}

function reader(world: ReturnType<typeof parseDomain>) {
  world.ctx.provide('zotero', {
    resolveAttachment: world.resolveAttachment,
  } as unknown as Context['zotero'])
  return new EnrichmentService(
    world.ctx,
    { ...world.deps.config },
    {
      client: world.deps.client,
      store: async () => world.store,
    },
  )
}

describe('canonical source publication', () => {
  it('publishes linked-attachment, requested URL and verified final URL to the same committed record', async () => {
    const world = domain()
    linked(world)
    const result = await parseDocument(LOCAL, world.deps)
    const records = await Promise.all(
      [LOCAL.key, URL, FINAL].map(
        async (identity) => await world.store.sourceRecord(sourceKeyOf(identity)),
      ),
    )
    expect(records[0]).toEqual(records[1])
    expect(records[1]).toEqual(records[2])
    expect(result.artifact.meta.sourceId).toBe(sourceKeyOf(LOCAL.key))
    const service = reader(world)
    world.fetch.mockClear()
    for (const url of [URL, FINAL]) {
      const hit = await service.enhancer.lookup({ key: url, source: { kind: 'url', url } })
      expect(hit).toMatchObject({
        kind: 'hit',
        text: MARKDOWN,
        provenance: { sourceId: sourceKeyOf(LOCAL.key), generation: world.deps.generation },
      })
    }
    expect(world.fetch.mock.calls.every(([, init]) => init?.method === 'HEAD')).toBe(true)
    expect(world.fetch.mock.calls).toHaveLength(3)
  })

  it('does not infer URL aliases from caller stamps or bytes without a verified acquisition', async () => {
    const world = domain()
    await parseDocument(
      { ...LOCAL, bytes: PDF, sourceStamp: { kind: 'url', url: URL, etag: '"v1"' } },
      world.deps,
    )
    expect(await world.store.sourceRecord(sourceKeyOf(URL))).toBeUndefined()
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeDefined()
    expect(world.fetch.mock.calls.some(([url]) => url === URL)).toBe(false)
  })

  it('uses the same generation cache for canonical URL fragments but keeps query-selected sources distinct', async () => {
    const world = domain()
    const firstUrl = 'https://EXAMPLE.org:443/a/../paper.pdf?copy=one#first'
    const first = await parseDocument(
      { key: firstUrl, source: { kind: 'url', url: firstUrl } },
      world.deps,
    )
    const canonical = 'https://example.org/paper.pdf?copy=one#second'
    expect(
      (await parseDocument({ key: canonical, source: { kind: 'url', url: canonical } }, world.deps))
        .cacheKey,
    ).toBe(first.cacheKey)
    const other = 'https://example.org/paper.pdf?copy=two'
    const second = await parseDocument(
      { key: other, source: { kind: 'url', url: other } },
      world.deps,
    )
    expect(second.cacheKey).not.toBe(first.cacheKey)
    expect(first.artifact.meta.identity).toBe('https://example.org/…')
    expect(first.artifact.meta.sourceId).not.toBe(second.artifact.meta.sourceId)
    expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(2)
  })

  it('rejects a key/source identity mismatch before store or source I/O', async () => {
    const world = domain()
    await expect(parseDocument({ ...URL_INPUT, key: FINAL }, world.deps)).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
    })
    expect(world.storeFactory).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })
})

describe('source transaction across aliases and modes', () => {
  it('retains every previous pointer when the common source snapshot fails to publish', async () => {
    const world = domain()
    linked(world)
    const previous = await parseDocument(LOCAL, world.deps)
    const cause = new Error('EIO: common source snapshot')
    const rename = vi.mocked(world.fs.deps.rename).getMockImplementation()!
    vi.mocked(world.fs.deps.rename).mockImplementation(async (from, to) => {
      if (to === '/parsed/sources/index.json') throw cause
      await rename(from, to)
    })
    await expect(
      parseDocument(LOCAL, { ...world.deps, generation: NEXT_GENERATION }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_TASK_FAILED, cause })
    for (const identity of [LOCAL.key, URL, FINAL]) {
      expect(await world.store.sourceRecord(sourceKeyOf(identity))).toMatchObject({
        cacheKey: previous.cacheKey,
      })
    }
    const submits = world.calls.filter((call) => call.init.method === 'POST').length
    vi.mocked(world.fs.deps.rename).mockImplementation(rename)
    const retried = await parseDocument(LOCAL, { ...world.deps, generation: NEXT_GENERATION })
    expect(retried.cached).toBe(true)
    expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(submits)
    for (const identity of [LOCAL.key, URL, FINAL]) {
      expect(await world.store.sourceRecord(sourceKeyOf(identity))).toMatchObject({
        cacheKey: retried.cacheKey,
      })
    }
  })

  it('commits all aliases before cancellation can observe a successful publication', async () => {
    const world = domain()
    linked(world)
    const published = deferred()
    const release = deferred()
    const controller = new AbortController()
    const rename = vi.mocked(world.fs.deps.rename).getMockImplementation()!
    vi.mocked(world.fs.deps.rename).mockImplementation(async (from, to) => {
      await rename(from, to)
      if (to === '/parsed/sources/index.json') {
        published.resolve()
        await release.promise
      }
    })
    const pending = parseDocument(LOCAL, world.deps, controller.signal)
    try {
      await published.promise
      const records = await Promise.all(
        [LOCAL.key, URL, FINAL].map(
          async (identity) => await world.store.sourceRecord(sourceKeyOf(identity)),
        ),
      )
      expect(records.every((record) => record?.generation === world.deps.generation)).toBe(true)
      controller.abort(new Error('cancel after common atomic rename'))
      release.resolve()
      expect(await pending).toMatchObject({ cached: false })
    } finally {
      release.resolve()
      await pending.catch(() => {})
    }
  })

  it('advances the one latest-success pointer across modes while preserving actual mode provenance', async () => {
    const world = domain()
    linked(world)
    const free = await parseDocument(LOCAL, world.deps)
    const pro = await parseDocument(LOCAL, {
      ...world.deps,
      config: { ...world.deps.config, mode: 'pro' },
      generation: NEXT_GENERATION,
    })
    const service = reader(world)
    expect(await service.enhancer.lookup({ ...LOCAL })).toMatchObject({
      kind: 'hit',
      source: 'MinerU (pro)',
      provenance: { mode: 'pro', generation: NEXT_GENERATION },
    })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toMatchObject({
      cacheKey: pro.cacheKey,
    })
    expect(await world.store.get(free.cacheKey)).toMatchObject({ meta: { mode: 'free' } })
    expect(await world.store.get(pro.cacheKey)).toMatchObject({ meta: { mode: 'pro' } })
  })
})
