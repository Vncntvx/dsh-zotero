/** Source publication is one shared snapshot commit, serialized across store instances. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { ParsedArtifactStore, type ArtifactStoreDeps } from '../../src/enrichment/artifact-store.ts'
import { SOURCE_INDEX_MAX_BYTES } from '../../src/enrichment/artifact-schema.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { deferred } from '../helpers/sync.ts'
import { memoryFiles, NEXT_GENERATION } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'

const ALIAS = sourceKeyOf('https://example.org/paper.pdf')
const OTHER = sourceKeyOf('https://example.net/other.pdf')
const changed = { ...SOURCE_RECORD, cacheKey: 'b'.repeat(64), generation: NEXT_GENERATION }
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })),
  )
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'zotero-source-index-'))
  dirs.push(path)
  return path
}

describe('atomic source snapshot publication', () => {
  it('keeps all old pointers visible until the single common rename commits', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.putSources([SOURCE_KEY, ALIAS], SOURCE_RECORD)
    await store.putSource(OTHER, SOURCE_RECORD)
    const staged = deferred()
    const release = deferred()
    const rename = vi.mocked(fs.deps.rename).getMockImplementation()!
    vi.mocked(fs.deps.rename).mockImplementation(async (from, to) => {
      if (to === '/root/sources/index.json') {
        staged.resolve()
        await release.promise
      }
      await rename(from, to)
    })
    const pending = store.putSources([SOURCE_KEY, ALIAS], changed)
    try {
      await staged.promise
      expect(await store.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
      expect(await store.sourceRecord(ALIAS)).toEqual(SOURCE_RECORD)
      release.resolve()
      await pending
      expect(await store.sourceRecord(SOURCE_KEY)).toEqual(changed)
      expect(await store.sourceRecord(ALIAS)).toEqual(changed)
      expect(await store.sourceRecord(OTHER)).toEqual(SOURCE_RECORD)
    } finally {
      release.resolve()
      await pending.catch(() => {})
    }
  })

  it('leaves every alias unchanged when the common rename rejects and a fresh reader restarts', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.putSources([SOURCE_KEY, ALIAS], SOURCE_RECORD)
    const previous = fs.files.get('/root/sources/index.json')
    vi.mocked(fs.deps.rename).mockRejectedValue(new Error('EIO'))
    await expect(store.putSources([SOURCE_KEY, ALIAS], changed)).rejects.toThrow('EIO')
    expect(fs.files.get('/root/sources/index.json')).toBe(previous)
    const restarted = new ParsedArtifactStore('/root', fs.deps)
    expect(await restarted.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
    expect(await restarted.sourceRecord(ALIAS)).toEqual(SOURCE_RECORD)
    expect([...fs.files.keys()].some((path) => path.includes('.tmp-'))).toBe(false)
  })

  it('rereads the snapshot after acquiring the shared lock so concurrent stores retain both writes', async () => {
    const fs = memoryFiles()
    const first = new ParsedArtifactStore('/root', fs.deps)
    const second = new ParsedArtifactStore('/root', fs.deps)
    const staged = deferred()
    const joined = deferred()
    const release = deferred()
    const rename = vi.mocked(fs.deps.rename).getMockImplementation()!
    let firstWrite = true
    vi.mocked(fs.deps.rename).mockImplementation(async (from, to) => {
      if (firstWrite) {
        firstWrite = false
        staged.resolve()
        await release.promise
      }
      await rename(from, to)
    })
    const lock = fs.deps.withSourceLock!
    const deps: ArtifactStoreDeps = {
      ...fs.deps,
      withSourceLock: async (path, operation, options) => {
        joined.resolve()
        return await lock(path, operation, options)
      },
    }
    const initial = first.putSource(SOURCE_KEY, SOURCE_RECORD)
    await staged.promise
    const pending = new ParsedArtifactStore('/root', deps).putSource(OTHER, changed)
    try {
      await joined.promise
      release.resolve()
      await Promise.all([initial, pending])
      expect(await second.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
      expect(await second.sourceRecord(OTHER)).toEqual(changed)
    } finally {
      release.resolve()
      await Promise.allSettled([initial, pending])
    }
  })

  it('uses a 60-second lock budget and preserves cancellation while waiting without entering publication', async () => {
    const fs = memoryFiles()
    const controller = new AbortController()
    const acquired = deferred()
    const release = deferred()
    const original = fs.deps.withSourceLock!
    const holder = original('/root/sources/index.json', async () => {
      acquired.resolve()
      await release.promise
    })
    await acquired.promise
    const optionsSeen = deferred<{ waitMs?: number; signal?: AbortSignal } | undefined>()
    const deps: ArtifactStoreDeps = {
      ...fs.deps,
      withSourceLock: async (path, operation, options) => {
        optionsSeen.resolve(options)
        return await original(path, operation, options)
      },
    }
    const reason = new Error('cancel source lock contention')
    const pending = new ParsedArtifactStore('/root', deps).putSource(
      SOURCE_KEY,
      SOURCE_RECORD,
      controller.signal,
    )
    const outcome = pending.catch((error: unknown) => error)
    try {
      expect(await optionsSeen.promise).toEqual({ waitMs: 60_000, signal: controller.signal })
      controller.abort(reason)
      expect(await outcome).toBe(reason)
      expect(fs.deps.writeFile).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await holder
      await outcome
    }
  })
})

describe('host source snapshot I/O', () => {
  it('coordinates separate store instances using the public host file lock', async () => {
    const path = await root()
    const stores = [new ParsedArtifactStore(path), new ParsedArtifactStore(path)]
    await Promise.all([
      stores[0]!.putSource(SOURCE_KEY, SOURCE_RECORD),
      stores[1]!.putSource(ALIAS, changed),
    ])
    expect(await new ParsedArtifactStore(path).sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
    expect(await new ParsedArtifactStore(path).sourceRecord(ALIAS)).toEqual(changed)
  })

  it('keeps the old snapshot readable while the host writer lock is held and cancels its waiter', async () => {
    const path = await root()
    const store = new ParsedArtifactStore(path)
    await store.putSource(SOURCE_KEY, SOURCE_RECORD)
    const held = deferred()
    const release = deferred()
    const holder = withFileLock(join(path, 'sources', 'index.json'), async () => {
      held.resolve()
      await release.promise
    })
    await held.promise
    const controller = new AbortController()
    const pending = store
      .putSources([SOURCE_KEY, ALIAS], changed, controller.signal)
      .catch((error: unknown) => error)
    try {
      expect(await store.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
      controller.abort(new Error('stop waiting on host lock'))
      expect(await pending).toBe(controller.signal.reason)
      expect(await store.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
      expect(await store.sourceRecord(ALIAS)).toBeUndefined()
    } finally {
      release.resolve()
      await holder
      await pending
    }
  })

  it('rejects a sparse oversized host snapshot through stat before reading its content', async () => {
    const path = await root()
    await mkdir(join(path, 'sources'))
    const file = join(path, 'sources', 'index.json')
    await writeFile(file, '')
    await truncate(file, SOURCE_INDEX_MAX_BYTES + 1)
    await expect(new ParsedArtifactStore(path).sourceRecord(SOURCE_KEY)).rejects.toThrow(
      /too large/,
    )
  })

  it('refuses a source directory symlink without modifying its target', async () => {
    const path = await root()
    const target = await root()
    await symlink(target, join(path, 'sources'), 'dir')
    const store = new ParsedArtifactStore(path)
    await expect(store.putSource(SOURCE_KEY, SOURCE_RECORD)).rejects.toThrow(/regular/)
    await expect(store.sourceRecord(SOURCE_KEY)).rejects.toThrow(/regular/)
    await expect(readFile(join(target, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a symlinked index without following or replacing its target', async () => {
    const path = await root()
    await mkdir(join(path, 'sources'))
    const target = join(path, 'untouched.json')
    await writeFile(target, '{}')
    await symlink(target, join(path, 'sources', 'index.json'))
    const store = new ParsedArtifactStore(path)
    await expect(store.sourceRecord(SOURCE_KEY)).rejects.toThrow()
    await expect(store.putSource(SOURCE_KEY, SOURCE_RECORD)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('{}')
  })

  it('refuses a symlinked lock without deleting arbitrary files', async () => {
    const path = await root()
    await mkdir(join(path, 'sources'))
    const target = join(path, 'untouched.lock')
    await writeFile(target, 'private')
    await symlink(target, join(path, 'sources', 'index.json.lock'))
    await expect(
      new ParsedArtifactStore(path).putSource(SOURCE_KEY, SOURCE_RECORD),
    ).rejects.toThrow(/regular/)
    expect(await readFile(target, 'utf8')).toBe('private')
  })

  it('allows an alias record to retain the original primary sourceId', async () => {
    const path = await root()
    const store = new ParsedArtifactStore(path)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSources([SOURCE_KEY, ALIAS], SOURCE_RECORD)
    expect((await store.lookupSource(ALIAS, SOURCE_RECORD.stamp))?.meta.sourceId).toBe(SOURCE_KEY)
  })
})
