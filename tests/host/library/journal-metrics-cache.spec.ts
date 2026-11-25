import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { JournalMetrics } from '../../../src/library/journal-metrics.js'
import {
  JOURNAL_METRICS_CACHE_LIMIT,
  JournalMetricsCache,
} from '../../../src/library/journal-metrics-cache.js'
import { withTempDir } from '../../helpers/temp-dir.js'
import { deferred } from '../../helpers/sync.js'

const secret = 'test-easyscholar-secret'
const ready = (value = 'Q1') =>
  Response.json({ code: 200, data: { officialRank: { all: { sci: value } } } })

async function withCache(
  run: (start: (key?: string) => ReturnType<typeof createService>, dir: string) => Promise<void>,
) {
  await withTempDir(async (dir) => {
    const root = join(dir, 'snapshots')
    const services: JournalMetrics[] = []
    try {
      await run((key) => {
        const fixture = createService(root, key)
        services.push(fixture.service)
        return fixture
      }, root)
    } finally {
      await Promise.all(services.map((service) => service.dispose()))
    }
  })
}

function createService(cacheDirectory: string, key = secret) {
  const fetch = vi.fn(async (_url: URL, _signal: AbortSignal) => ready())
  const service = new JournalMetrics({
    reference: () => 'EASYSCHOLAR_SECRET_KEY',
    credential: async () => key,
    cacheDirectory,
    fetch,
  })
  return {
    service,
    fetch,
    lookup: (publicationName: string) => service.lookup({ publicationName, priority: 'list' }),
    refresh: (signal = new AbortController().signal) => service.refresh(signal),
  }
}

it('reuses normalized snapshots on restart and isolates custom rankings by key', async () => {
  await withCache(async (start, dir) => {
    const initial = start()
    initial.fetch.mockResolvedValueOnce(
      Response.json({
        code: 200,
        data: {
          customRank: {
            rankInfo: [{ uuid: '1', abbName: 'DUFE', oneRankText: 'A' }],
            rank: ['1&&&1'],
          },
        },
      }),
    )
    const result = await initial.lookup('Café & Science')
    await initial.service.dispose()

    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    const path = join(dir, files[0]!)
    expect(await readFile(path, 'utf8')).not.toContain(secret)
    // Older snapshots are upgraded using the normalized name on their next read.
    await writeFile(path, JSON.stringify(result))
    const restarted = start()
    await expect(restarted.lookup('Cafe\u0301 & Science')).resolves.toEqual(result)
    expect(result).toMatchObject({ custom: [{ id: '1', label: 'DUFE', value: 'A' }] })
    expect(restarted.fetch).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty(
      'publicationName',
      'Café & Science',
    )

    const other = start('different-key')
    await expect(other.lookup('Café & Science')).resolves.toMatchObject({ custom: [] })
    expect(other.fetch).toHaveBeenCalledOnce()
  })
})

it('refreshes all saved journals for the key and retains failed snapshots', async () => {
  await withCache(async (start) => {
    const initial = start()
    const first = await initial.lookup('First Journal')
    await initial.lookup('Second Journal')
    await initial.service.dispose()
    const other = start('different-key')
    await other.lookup('Unrelated Journal')
    await other.service.dispose()

    const refreshed = start()
    refreshed.fetch.mockImplementation(async (url) =>
      url.searchParams.get('publicationName') === 'First Journal'
        ? new Response(null, { status: 503 })
        : ready('Q2'),
    )
    await expect(refreshed.refresh()).resolves.toEqual({
      status: 'finished',
      total: 2,
      refreshed: 1,
      failure: 'serviceUnavailable',
    })
    expect(
      refreshed.fetch.mock.calls.map(([url]) => url.searchParams.get('publicationName')).sort(),
    ).toEqual(['First Journal', 'Second Journal'])
    await refreshed.service.dispose()

    const restarted = start()
    await expect(restarted.lookup('First Journal')).resolves.toEqual(first)
    await expect(restarted.lookup('Second Journal')).resolves.toMatchObject({
      status: 'ready',
      official: [{ field: 'sci', value: 'Q2' }],
    })
    expect(restarted.fetch).not.toHaveBeenCalled()
  })
})

it('starts with an empty refresh before the first journal has been saved', async () => {
  await withCache(async (start, dir) => {
    const service = start()
    await expect(service.refresh()).resolves.toEqual({ status: 'finished', total: 0, refreshed: 0 })
    expect(service.fetch).not.toHaveBeenCalled()
    await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

it('treats a cache path occupied by a file as a storage error', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'cache')
    await writeFile(path, '{}')
    const fixture = createService(path)
    try {
      await expect(fixture.refresh()).rejects.toMatchObject({ code: 'ENOTDIR' })
      await expect(fixture.lookup('Journal')).resolves.toMatchObject({ status: 'ready' })
    } finally {
      await fixture.service.dispose()
    }
    expect(await readFile(path, 'utf8')).toBe('{}')
  })
})

it('keeps the newest snapshot when two writers save the same journal', async () => {
  await withTempDir(async (dir) => {
    const cache = new JournalMetricsCache(dir)
    const result = { status: 'ready', official: [], custom: [], fetchedAt: Date.now() } as const
    await cache.write('digest', 'Journal', result)
    await cache.write('digest', 'Journal', { ...result, fetchedAt: result.fetchedAt - 1000 })
    await expect(cache.read('digest', 'Journal')).resolves.toEqual({
      result,
      publicationName: 'Journal',
    })
  })
})

it('keeps the previous snapshot if a new cache record exceeds the size limit', async () => {
  await withTempDir(async (dir) => {
    const cache = new JournalMetricsCache(dir)
    const result = { status: 'ready', official: [], custom: [], fetchedAt: Date.now() } as const
    await cache.write('digest', 'Journal', result)
    await cache.write('digest', 'Journal', {
      ...result,
      official: [{ field: 'sci', value: 'x'.repeat(256 * 1024) }],
    })
    await expect(cache.read('digest', 'Journal')).resolves.toMatchObject({ result })
  })
})

it('ignores a saved record whose journal name disagrees with its cache key', async () => {
  await withCache(async (start, dir) => {
    const initial = start()
    const result = await initial.lookup('Journal')
    await initial.service.dispose()
    const [file] = await readdir(dir)
    await writeFile(join(dir, file!), JSON.stringify({ publicationName: 'Other journal', result }))
    const restarted = start()
    restarted.fetch.mockResolvedValueOnce(ready('Q2'))
    await expect(restarted.lookup('Journal')).resolves.toMatchObject({
      status: 'ready',
      official: [{ field: 'sci', value: 'Q2' }],
    })
    expect(restarted.fetch).toHaveBeenCalledOnce()
  })
})

it('evicts the oldest snapshot when the journal cache reaches its limit', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'cache')
    await mkdir(path)
    const cache = new JournalMetricsCache(path)
    const result = { status: 'ready', official: [], custom: [], fetchedAt: Date.now() } as const
    await cache.write('digest', 'Oldest journal', result)
    const [oldest] = await readdir(path)
    await utimes(join(path, oldest!), new Date(0), new Date(0))
    await Promise.all(
      Array.from({ length: JOURNAL_METRICS_CACHE_LIMIT - 1 }, async (_, index) => {
        const publicationName = `Journal ${index}`
        const name = createHash('sha256').update('digest').update(publicationName).digest('hex')
        await writeFile(join(path, `${name}.json`), JSON.stringify({ publicationName, result }))
      }),
    )
    await cache.write('digest', 'New journal', result)
    expect(await readdir(path)).toHaveLength(JOURNAL_METRICS_CACHE_LIMIT)
    await expect(cache.read('digest', 'Oldest journal')).resolves.toBeUndefined()
    await expect(cache.read('digest', 'New journal')).resolves.toMatchObject({ result })
  })
})

it.each([
  ['quotaExceeded', () => Response.json({ code: 40006 })],
  ['rateLimited', () => new Response(null, { status: 429, headers: { 'retry-after': '60' } })],
] as const)('stops a full refresh after %s', async (failure, response) => {
  await withCache(async (start) => {
    const initial = start()
    await initial.lookup('First Journal')
    await initial.lookup('Second Journal')
    await initial.service.dispose()
    const refreshed = start()
    refreshed.fetch.mockImplementation(async () => response())
    await expect(refreshed.refresh()).resolves.toEqual({
      status: 'finished',
      total: 2,
      refreshed: 0,
      failure,
    })
    expect(refreshed.fetch).toHaveBeenCalledOnce()
    if (failure === 'rateLimited') {
      await expect(refreshed.refresh()).resolves.toMatchObject({ failure, refreshed: 0 })
      expect(refreshed.fetch).toHaveBeenCalledOnce()
    }
  })
})

it.each(['cancelled', 'credential changed'])('ends a full refresh when %s', async (event) => {
  await withCache(async (start) => {
    const initial = start()
    await initial.lookup('Journal')
    await initial.service.dispose()
    const refreshed = start()
    const running = deferred<AbortSignal>()
    refreshed.fetch.mockImplementation(async (_url, signal) => {
      running.resolve(signal)
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const cancel = new AbortController()
    const pending = refreshed.refresh(cancel.signal)
    const result =
      event === 'cancelled'
        ? expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        : expect(pending).resolves.toEqual({ status: 'disabled' })
    const signal = await running.promise
    await expect(refreshed.refresh()).resolves.toEqual({ status: 'running' })
    if (event === 'cancelled') cancel.abort()
    else refreshed.service.credentialChanged('EASYSCHOLAR_SECRET_KEY')
    await result
    expect(signal.aborted).toBe(true)
  })
})

it('starts a new generation while an invalidated refresh is still draining', async () => {
  await withCache(async (start) => {
    const { service, refresh } = start()
    const oldStarted = deferred<AbortSignal>()
    const newStarted = deferred<AbortSignal>()
    const oldScan = deferred<string[]>()
    const newScan = deferred<string[]>()
    const journals = vi
      .spyOn(JournalMetricsCache.prototype, 'journals')
      .mockImplementationOnce((_digest, signal) => {
        oldStarted.resolve(signal)
        return oldScan.promise
      })
      .mockImplementationOnce((_digest, signal) => {
        newStarted.resolve(signal)
        return newScan.promise
      })
    try {
      const old = refresh()
      const oldSignal = await oldStarted.promise
      service.credentialChanged('EASYSCHOLAR_SECRET_KEY')
      expect(oldSignal.aborted).toBe(true)

      const successor = refresh()
      const started = await Promise.race([newStarted.promise, successor])
      expect(started).toBeInstanceOf(AbortSignal)
      oldScan.resolve([])
      await expect(old).resolves.toEqual({ status: 'disabled' })
      await expect(refresh()).resolves.toEqual({ status: 'running' })

      const disposed = vi.fn()
      const disposal = service.dispose().then(disposed)
      expect((await newStarted.promise).aborted).toBe(true)
      await Promise.resolve()
      expect(disposed).not.toHaveBeenCalled()
      newScan.resolve([])
      await expect(successor).resolves.toEqual({ status: 'disabled' })
      await disposal
    } finally {
      oldScan.resolve([])
      newScan.resolve([])
      journals.mockRestore()
    }
  })
})
