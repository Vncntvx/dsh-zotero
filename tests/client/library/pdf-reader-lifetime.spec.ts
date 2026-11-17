/** The metadata inventory, not the visible React body, owns reading-file cleanup. */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createPdfReaderRegistry } from '../../../src/client/url-pdf-readers.ts'
import { deferred } from '../../helpers/sync.ts'
it('retains a hidden or floating reader until its last resource occurrence closes', async () => {
  const inventory = createSnapshotStore([{ contentId: 'pdf' }, { contentId: 'pdf' }])
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({ inventory, release, report: vi.fn() })
  registry.track('pdf', 'lease')
  inventory.set([{ contentId: 'pdf' }])
  expect(release).not.toHaveBeenCalled()
  inventory.set([])
  await registry.dispose()
  expect(release).toHaveBeenCalledExactlyOnceWith('lease')
})
it('does not release a file while its tab is still being registered', async () => {
  const inventory = createSnapshotStore<{ contentId: string }[]>([])
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({ inventory, release, report: vi.fn() })
  registry.track('pdf', 'lease')
  expect(release).not.toHaveBeenCalled()
  inventory.set([{ contentId: 'pdf' }])
  inventory.set([])
  await registry.dispose()
  expect(release).toHaveBeenCalledExactlyOnceWith('lease')
})
it('joins a pending release during teardown without releasing twice', async () => {
  const inventory = createSnapshotStore([{ contentId: 'pdf' }])
  const pending = deferred<void>()
  const release = vi.fn(() => pending.promise)
  const registry = createPdfReaderRegistry({ inventory, release, report: vi.fn() })
  registry.track('pdf', 'lease')
  inventory.set([])
  const disposed = registry.dispose()
  pending.resolve()
  await disposed
  expect(release).toHaveBeenCalledTimes(1)
})
it('reports failed cleanup and retries ownership on a later inventory event', async () => {
  const inventory = createSnapshotStore([{ contentId: 'pdf' }])
  const failure = new Error('connection closed')
  const release = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
  const report = vi.fn()
  const registry = createPdfReaderRegistry({ inventory, release, report })
  registry.track('pdf', 'lease')
  inventory.set([])
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(failure))
  inventory.set([{ contentId: 'unrelated' }])
  await registry.dispose()
  expect(release).toHaveBeenCalledTimes(2)
})
it('refuses to track a source that cannot be persisted and leaves cleanup to the caller', async () => {
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release,
    report: vi.fn(),
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded')
      },
      removeItem: vi.fn(),
    },
  })
  expect(() => registry.track('pdf', 'lease', 'ref')).toThrow('Quota exceeded')
  expect(registry.source('pdf')).toBeUndefined()
  registry.forget('pdf')
  await registry.dispose()
  expect(release).not.toHaveBeenCalled()
})
it('reports a catalog write failure after release without retaining the expired source', async () => {
  const inventory = createSnapshotStore([{ contentId: 'pdf' }])
  const setItem = vi.fn()
  const failure = new Error('Storage disabled')
  const report = vi.fn()
  const registry = createPdfReaderRegistry({
    inventory,
    release: vi.fn(async () => {}),
    report,
    storage: { getItem: () => null, setItem, removeItem: () => setItem() },
  })
  registry.track('pdf', 'lease', 'ref')
  setItem.mockImplementation(() => {
    throw failure
  })
  inventory.set([])
  await registry.dispose()
  expect(report).toHaveBeenCalledWith(failure)
  expect(registry.source('pdf')).toBeUndefined()
})
it('forgets a failed reader even if the catalog cannot be updated', async () => {
  const setItem = vi.fn()
  const failure = new Error('Storage disabled')
  const report = vi.fn()
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release: vi.fn(async () => {}),
    report,
    storage: { getItem: () => null, setItem, removeItem: () => setItem() },
  })
  registry.track('pdf', 'lease', 'ref')
  setItem.mockImplementation(() => {
    throw failure
  })
  registry.forget('pdf')
  expect(registry.source('pdf')).toBeUndefined()
  expect(report).toHaveBeenCalledWith(failure)
  await registry.dispose()
})
it('reports teardown release failures while completing registry disposal', async () => {
  const failure = new Error('Host disconnected')
  const report = vi.fn()
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([{ contentId: 'pdf' }]),
    release: vi.fn(async () => {
      throw failure
    }),
    report,
  })
  registry.track('pdf', 'lease', 'ref')
  await registry.dispose()
  expect(report).toHaveBeenCalledWith(failure)
  expect(registry.source('pdf')).toBeUndefined()
})

it('removes an empty source catalog instead of persisting an unusable lease', async () => {
  const store: Record<string, string> = {}
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release: vi.fn(async () => {}),
    report: vi.fn(),
    storage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v
      },
      removeItem: (k) => {
        delete store[k]
      },
    },
  })
  registry.track('pdf-noref', 'lease-noref')
  expect(store['dsh-zotero:url-pdf-readers:2']).toBeUndefined()
  await registry.dispose()
})

it('returns existing in-flight release promise on concurrent release', async () => {
  const inventory = createSnapshotStore([{ contentId: 'pdf' }])
  const pending = deferred<void>()
  const release = vi.fn(() => pending.promise)
  const registry = createPdfReaderRegistry({
    inventory,
    release,
    report: vi.fn(),
  })
  registry.track('pdf', 'lease')
  inventory.set([])
  expect(release).toHaveBeenCalledTimes(1)
  inventory.set([{ contentId: 'other' }])
  inventory.set([])
  expect(release).toHaveBeenCalledTimes(1)
  pending.resolve()
  await registry.dispose()
})

it('releases an overwritten lease without letting its late settlement remove the new reader', async () => {
  const old = deferred<void>()
  const release = vi.fn(async (lease: string) => {
    if (lease === 'old') await old.promise
  })
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([{ contentId: 'pdf' }]),
    release,
    report: vi.fn(),
  })
  registry.track('pdf', 'old', 'old-ref')
  registry.track('pdf', 'new', 'new-ref')
  expect(release).toHaveBeenCalledExactlyOnceWith('old')
  old.resolve()
  await old.promise
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(registry.source('pdf')).toBe('new-ref')
  await registry.dispose()
  expect(release.mock.calls.map(([lease]) => lease)).toEqual(['old', 'new'])
})

it('retains cleanup ownership after metadata is forgotten', async () => {
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release,
    report: vi.fn(),
  })
  registry.track('pdf', 'owned')
  registry.forget('pdf')
  expect(release).not.toHaveBeenCalled()
  await registry.dispose()
  expect(release).toHaveBeenCalledExactlyOnceWith('owned')
})

it('never releases a previous browser session lease from persisted source metadata', async () => {
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([{ contentId: 'restored' }]),
    release,
    report: vi.fn(),
    storage: {
      getItem: () => JSON.stringify([['restored', { ref: 'restored-ref' }]]),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  })
  expect(registry.source('restored')).toBe('restored-ref')
  await registry.dispose()
  expect(release).not.toHaveBeenCalled()
})

it('bounds restored source metadata and persists no lease tokens', async () => {
  let stored = JSON.stringify(
    Array.from({ length: 256 }, (_, index) => [`old-${index}`, { ref: `ref-${index}` }]),
  )
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release: vi.fn(async () => {}),
    report: vi.fn(),
    storage: {
      getItem: () => stored,
      setItem: (_key, value) => {
        stored = value
      },
      removeItem: vi.fn(),
    },
  })
  registry.track('new', 'private-current-lease', 'new-ref')
  expect(JSON.parse(stored)).toHaveLength(256)
  expect(stored).not.toContain('private-current-lease')
  expect(registry.source('old-0')).toBeUndefined()
  expect(registry.source('new')).toBe('new-ref')
  await registry.dispose()
})

it('joins repeated disposal until all owned release work has settled', async () => {
  const pending = deferred<void>()
  const release = vi.fn(() => pending.promise)
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release,
    report: vi.fn(),
  })
  registry.track('pdf', 'lease')
  let closed = 0
  const first = registry.dispose().then(() => {
    closed++
  })
  const second = registry.dispose().then(() => {
    closed++
  })
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(closed).toBe(0)
  pending.resolve()
  await Promise.all([first, second])
  expect(closed).toBe(2)
  expect(release).toHaveBeenCalledOnce()
})

it('treats duplicate lease registration as idempotent and rejects registrations after disposal', async () => {
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release,
    report: vi.fn(),
  })
  registry.track('pdf', 'lease', 'ref')
  registry.track('pdf', 'lease', 'ref')
  await registry.dispose()
  expect(release).toHaveBeenCalledExactlyOnceWith('lease')
  expect(() => registry.track('late', 'new', 'ref')).toThrow('closed')
})

it('refuses a full active catalog transactionally and preserves every admitted owner', async () => {
  const release = vi.fn(async () => {})
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release,
    report: vi.fn(),
  })
  for (let index = 0; index < 256; index++)
    registry.track(`pdf-${index}`, `lease-${index}`, `ref-${index}`)
  expect(() => registry.track('overflow', 'not-admitted', 'unowned')).toThrow('full')
  expect(registry.source('pdf-0')).toBe('ref-0')
  expect(registry.source('overflow')).toBeUndefined()
  await registry.dispose()
  expect(release).toHaveBeenCalledTimes(256)
  expect(release).not.toHaveBeenCalledWith('not-admitted')
})
