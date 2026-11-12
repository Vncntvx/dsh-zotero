// @vitest-environment jsdom
/** Restored URL readers recover only through an explicit, source-preserving action. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createPdfReaderRegistry } from '../../../src/client/url-pdf-readers.ts'
import { ZoteroPdfRecoveryMenu } from '../../../src/client/components/library/ZoteroPdfRecoveryMenu.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'
import { deferred } from '../../helpers/sync.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
it('retains only the source ref across unload and never downloads on restoration', async () => {
  const address = 'dsh-resource://file/absolute/tmp/dsh-zotero-pdf-1-abcd/document.pdf'
  const ref = 'zotero://user/0/attachment/ATTAC001?server=S1'
  const inventory = createSnapshotStore([{ contentId: address }])
  const release = vi.fn(async () => {})
  const first = createPdfReaderRegistry({
    inventory,
    release,
    report: vi.fn(),
    storage: localStorage,
  })
  first.track(address, 'lease-1', ref)
  await first.dispose()
  expect(release).toHaveBeenCalledExactlyOnceWith('lease-1')
  const restored = createPdfReaderRegistry({
    inventory,
    release,
    report: vi.fn(),
    storage: localStorage,
  })
  expect(restored.source(address)).toBe(ref)
  const reload = vi.fn(async () => {})
  const dismiss = vi.fn()
  render(
    <ZoteroPdfRecoveryMenu
      tab={{ id: 'tab-1', contentId: address }}
      sessionId="s1"
      t={mockT}
      dismiss={dismiss}
      reload={reload}
      source={restored.source}
      recoveryError={restored.recoveryError}
    />,
  )
  expect(reload).not.toHaveBeenCalled()
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryPdfReload })),
  )
  expect(reload).toHaveBeenCalledExactlyOnceWith('s1', 'tab-1', address)
  expect(dismiss).toHaveBeenCalledOnce()
  inventory.set([])
  await restored.dispose()
  expect(localStorage.getItem('dsh-zotero:url-pdf-readers:1')).toBe('[]')
})
it('keeps a restored source while session metadata is still loading', async () => {
  const storage = new Map<string, string>()
  const port = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  }
  const original = createPdfReaderRegistry({
    inventory: createSnapshotStore([{ contentId: 'pdf' }]),
    release: vi.fn(async () => {}),
    report: vi.fn(),
    storage: port,
  })
  original.track('pdf', 'lease', 'ref')
  await original.dispose()
  const inventory = createSnapshotStore<{ contentId: string }[]>([])
  const registry = createPdfReaderRegistry({
    inventory,
    release: vi.fn(async () => {}),
    report: vi.fn(),
    storage: port,
  })
  inventory.set([{ contentId: 'other' }])
  expect(registry.source('pdf')).toBe('ref')
  inventory.set([{ contentId: 'pdf' }])
  expect(registry.source('pdf')).toBe('ref')
  await registry.dispose()
})
it('shows reload failure without dismissing or allowing duplicate downloads', async () => {
  const pending = deferred<void>()
  const reload = vi.fn(() => pending.promise)
  const dismiss = vi.fn()
  render(
    <ZoteroPdfRecoveryMenu
      tab={{ id: 't', contentId: 'pdf' }}
      sessionId="s"
      dismiss={dismiss}
      t={mockT}
      source={() => 'ref'}
      recoveryError={() => undefined}
      reload={reload}
    />,
  )
  fireEvent.click(screen.getByRole('menuitem'))
  await act(async () => {})
  expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(true)
  await act(async () => pending.reject(new Error('permission revoked')))
  expect(screen.getByRole('alert').textContent).toContain('permission revoked')
  expect(dismiss).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledTimes(1)
})
it('reports corrupt recovery storage instead of silently losing source identities', async () => {
  localStorage.setItem('dsh-zotero:url-pdf-readers:1', '{corrupt')
  const report = vi.fn()
  const registry = createPdfReaderRegistry({
    inventory: createSnapshotStore([]),
    release: vi.fn(async () => {}),
    report,
    storage: localStorage,
  })
  expect(report).toHaveBeenCalledOnce()
  expect(registry.recoveryError()).toBeInstanceOf(Error)
  registry.track('pdf', 'lease', 'ref')
  expect(registry.recoveryError()).toBeUndefined()
  expect(registry.source('pdf')).toBe('ref')
  await registry.dispose()
})
it.each([{ id: 'unrelated', contentId: 'ordinary.pdf' }, { id: 'without-content' }])(
  'adds no recovery command to an unrelated tab %j',
  (tab) => {
    render(
      <ZoteroPdfRecoveryMenu
        tab={tab}
        sessionId="s"
        dismiss={vi.fn()}
        t={mockT}
        source={() => undefined}
        recoveryError={() => undefined}
        reload={vi.fn()}
      />,
    )
    expect(screen.queryByRole('menuitem')).toBeNull()
  },
)
it('explains unreadable recovery data for a restored PDF without issuing another request', async () => {
  const reload = vi.fn()
  const dismiss = vi.fn()
  render(
    <ZoteroPdfRecoveryMenu
      tab={{ id: 't', contentId: '/tmp/dsh-zotero-pdf-expired/document.pdf' }}
      sessionId="s"
      dismiss={dismiss}
      t={mockT}
      source={() => undefined}
      recoveryError={() => 'Browser storage denied'}
      reload={reload}
    />,
  )
  await act(async () => fireEvent.click(screen.getByRole('menuitem')))
  expect(screen.getByRole('alert').textContent).toContain('Browser storage denied')
  expect(reload).not.toHaveBeenCalled()
  expect(dismiss).not.toHaveBeenCalled()
})
