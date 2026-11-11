/** Source publication determines the active parse outcome under cancellation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { ZOTERO_ENRICHMENT_TASK_FAILED } from '../../src/errors.ts'
import { deferred } from '../helpers/sync.ts'
import { LOCAL, MARKDOWN, NEXT_GENERATION, parseDomain } from './support/enrichment-parse-domain.ts'

const owned: ReturnType<typeof parseDomain>[] = []
function domain() {
  const world = parseDomain()
  owned.push(world)
  return world
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (world) => await world.dispose()))
})

describe('parseDocument source publication', () => {
  it('preserves the previous pointer when cancellation arrives before publication starts', async () => {
    const world = domain()
    const previous = await parseDocument(LOCAL, world.deps)
    const controller = new AbortController()
    const reason = new Error('cancel before source publication')
    const sourcePath = '/parsed/sources/index.json'
    const rename = vi.spyOn(world.fs.deps, 'rename')
    rename.mockClear()
    let writes = 0
    try {
      await expect(
        parseDocument(
          LOCAL,
          {
            ...world.deps,
            generation: NEXT_GENERATION,
            onProgress: (phase) => {
              if (phase === 'writing' && ++writes === 2) controller.abort(reason)
            },
          },
          controller.signal,
        ),
      ).rejects.toBe(reason)
      expect(rename.mock.calls.some(([, to]) => to === sourcePath)).toBe(false)
      expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toMatchObject({
        cacheKey: previous.cacheKey,
      })
    } finally {
      rename.mockRestore()
    }
  })

  it('returns the committed result when cancellation arrives after the atomic source rename', async () => {
    const world = domain()
    const published = deferred()
    const release = deferred()
    const controller = new AbortController()
    const sourcePath = '/parsed/sources/index.json'
    const rename = vi.mocked(world.fs.deps.rename).getMockImplementation()!
    const observer = vi.spyOn(world.fs.deps, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (to === sourcePath) {
        published.resolve()
        await release.promise
      }
    })
    let settled = false
    const pending = parseDocument(LOCAL, world.deps, controller.signal)
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    try {
      await published.promise
      const pointer = await world.store.sourceRecord(sourceKeyOf(LOCAL.key))
      controller.abort(new Error('cancel after atomic publication'))
      expect(settled).toBe(false)
      release.resolve()
      const result = await pending
      expect(result).toMatchObject({
        cached: false,
        cacheKey: pointer!.cacheKey,
        artifact: { markdown: MARKDOWN },
      })
      expect(await world.store.get(result.cacheKey)).toMatchObject({ markdown: MARKDOWN })
    } finally {
      release.resolve()
      await pending.catch(() => {})
      observer.mockRestore()
    }
  })

  it('reports a rejected source commit as failure even when the caller cancels during publication', async () => {
    const world = domain()
    const previous = await parseDocument(LOCAL, world.deps)
    const entered = deferred()
    const release = deferred()
    const controller = new AbortController()
    const cause = new Error('EIO: source publication')
    const sourcePath = '/parsed/sources/index.json'
    const rename = vi.mocked(world.fs.deps.rename).getMockImplementation()!
    const observer = vi.spyOn(world.fs.deps, 'rename').mockImplementation(async (from, to) => {
      if (to === sourcePath) {
        entered.resolve()
        await release.promise
        throw cause
      }
      await rename(from, to)
    })
    const outcome = parseDocument(
      LOCAL,
      { ...world.deps, generation: NEXT_GENERATION },
      controller.signal,
    ).catch((error: unknown) => error)
    try {
      await entered.promise
      controller.abort(new Error('cancel while publication fails'))
      release.resolve()
      expect(await outcome).toMatchObject({ code: ZOTERO_ENRICHMENT_TASK_FAILED, cause })
      expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toMatchObject({
        cacheKey: previous.cacheKey,
      })
    } finally {
      release.resolve()
      await outcome
      observer.mockRestore()
    }
  })
})
