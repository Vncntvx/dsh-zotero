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
    storage: { getItem: () => null, setItem, removeItem: vi.fn() },
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
    storage: { getItem: () => null, setItem, removeItem: vi.fn() },
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
