/** Parse generations carry actual cache facts and durable receipts through the real pipeline. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheKeyOf, ParseFlight, parseOnce } from '../../src/enrichment/parse-once.ts'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_INVALID_ARGUMENT } from '../../src/errors.ts'
import { deferred } from '../helpers/sync.ts'
import {
  GENERATION,
  LOCAL,
  MARKDOWN,
  NEXT_GENERATION,
  PDF,
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
const input = { identity: LOCAL.key, generation: GENERATION, bytes: PDF, mode: 'free' as const }

describe('generation cache facts', () => {
  it('requires a generation before reading the store or creating any MinerU request', async () => {
    const world = domain()
    await expect(parseDocument(LOCAL, { ...world.deps, generation: '' })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
    })
    expect(world.storeFactory).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('reports a committed content-cache hit when its source index was lost', async () => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    await world.fs.deps.rm('/parsed/sources/index.json', {
      recursive: false,
      force: true,
    })
    world.fetch.mockClear()
    const second = await parseDocument(LOCAL, world.deps)
    expect(second).toMatchObject({
      cacheKey: first.cacheKey,
      cached: true,
      artifact: { markdown: MARKDOWN },
    })
    expect(world.fetch).not.toHaveBeenCalled()
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toMatchObject({
      cacheKey: first.cacheKey,
    })
  })

  it.each([
    { name: 'primary source', change: { sourceId: 'c'.repeat(64) } },
    { name: 'generation', change: { generation: NEXT_GENERATION } },
    { name: 'mode', change: { mode: 'pro' as const } },
    { name: 'fingerprint', change: { contentFingerprint: 'd'.repeat(64) } },
  ])('rejects a content-cache artifact bound to another $name', async ({ change }) => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    await world.fs.deps.rm('/parsed/sources/index.json', { recursive: false, force: true })
    await world.fs.deps.writeFile(
      `/parsed/${first.cacheKey}/meta.json`,
      JSON.stringify({ ...first.artifact.meta, ...change }),
    )
    world.fetch.mockClear()
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    expect(world.fetch).not.toHaveBeenCalled()
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeUndefined()
  })

  it('reports an artifact committed between the outer read and the shared-flight cache check as cached', async () => {
    const world = domain()
    const committed = await parseDocument(LOCAL, world.deps)
    const readFile = vi.mocked(world.fs.deps.readFile).getMockImplementation()!
    let firstRead = true
    const observer = vi.spyOn(world.fs.deps, 'readFile').mockImplementation(async (path) => {
      if (firstRead && path === `/parsed/${committed.cacheKey}/meta.json`) {
        firstRead = false
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return await readFile(path)
    })
    world.fetch.mockClear()
    try {
      const result = await parseOnce(input, {
        client: world.deps.client,
        store: world.store,
        flight: new ParseFlight(),
      })
      expect(result).toMatchObject({
        cacheKey: committed.cacheKey,
        cached: true,
        artifact: { markdown: MARKDOWN },
      })
      expect(world.fetch).not.toHaveBeenCalled()
    } finally {
      observer.mockRestore()
    }
  })

  it('gives both shared waiters the actual new-parse fact and submits only once', async () => {
    const world = domain()
    const upload = deferred()
    const release = deferred()
    const joined = deferred()
    const normal = world.fetch.getMockImplementation()!
    world.fetch.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        upload.resolve()
        await release.promise
      }
      return await normal(url, init)
    })
    const run = world.deps.flight.run.bind(world.deps.flight)
    const observer = vi.spyOn(world.deps.flight, 'run').mockImplementation((...args) => {
      const result = run(...args)
      if (observer.mock.calls.length === 2) joined.resolve()
      return result
    })
    try {
      const first = parseDocument(LOCAL, world.deps)
      await upload.promise
      const second = parseDocument(LOCAL, world.deps)
      await joined.promise
      release.resolve()
      const results = await Promise.all([first, second])
      expect(results.map((result) => result.cached)).toEqual([false, false])
      expect(results[0]!.cacheKey).toBe(results[1]!.cacheKey)
      expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(1)
    } finally {
      release.resolve()
      observer.mockRestore()
    }
  })

  it('lets one caller cancel while its shared generation continues for another waiter', async () => {
    const world = domain()
    const upload = deferred()
    const release = deferred()
    const joined = deferred()
    const controller = new AbortController()
    let uploadSignal: AbortSignal | undefined
    const normal = world.fetch.getMockImplementation()!
    world.fetch.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        uploadSignal = init.signal ?? undefined
        upload.resolve()
        await release.promise
      }
      return await normal(url, init)
    })
    const run = world.deps.flight.run.bind(world.deps.flight)
    const observer = vi.spyOn(world.deps.flight, 'run').mockImplementation((...args) => {
      const result = run(...args)
      if (observer.mock.calls.length === 2) joined.resolve()
      return result
    })
    try {
      const first = parseDocument(LOCAL, world.deps, controller.signal).catch(
        (error: unknown) => error,
      )
      await upload.promise
      const second = parseDocument(LOCAL, world.deps)
      await joined.promise
      const reason = new Error('only the first waiter leaves')
      controller.abort(reason)
      expect(await first).toBe(reason)
      expect(uploadSignal?.aborted).toBe(false)
      release.resolve()
      expect(await second).toMatchObject({ cached: false, artifact: { markdown: MARKDOWN } })
    } finally {
      release.resolve()
      observer.mockRestore()
    }
  })
})

describe('generation receipt recovery', () => {
  it('resumes the same generation after a result failure without another submit/upload', async () => {
    const world = domain()
    const normal = world.fetch.getMockImplementation()!
    let fail = true
    world.fetch.mockImplementation(async (url, init) => {
      if (fail && url === 'https://cdn.example/full.md') throw new Error('result offline')
      return await normal(url, init)
    })
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    const key = cacheKeyOf(input)
    expect(await world.store.getTask(key)).toMatchObject({ taskId: 'task-1', uploaded: true })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeUndefined()
    fail = false
    const result = await parseDocument(LOCAL, { ...world.deps, flight: new ParseFlight() })
    expect(result).toMatchObject({ cacheKey: key, cached: false, artifact: { markdown: MARKDOWN } })
    expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(1)
    expect(world.calls.filter((call) => call.init.method === 'PUT')).toHaveLength(1)
    expect(await world.store.getTask(key)).toBeUndefined()
  })

  it('uses a new receipt key for a new generation and leaves the interrupted generation resumable', async () => {
    const world = domain()
    const normal = world.fetch.getMockImplementation()!
    let fail = true
    world.fetch.mockImplementation(async (url, init) => {
      if (fail && url === 'https://cdn.example/full.md') throw new Error('result offline')
      return await normal(url, init)
    })
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    fail = false
    const result = await parseDocument(LOCAL, { ...world.deps, generation: NEXT_GENERATION })
    expect(result.cacheKey).not.toBe(cacheKeyOf(input))
    expect(await world.store.getTask(cacheKeyOf(input))).toMatchObject({ uploaded: true })
    expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(2)
    expect(world.calls.filter((call) => call.init.method === 'PUT')).toHaveLength(2)
  })
})
