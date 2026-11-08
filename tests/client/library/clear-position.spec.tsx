// @vitest-environment jsdom
/** Clearing a conversation position is explicit and reports failed browser storage. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ZoteroLibraryMenu } from '../../../src/client/components/library/ZoteroLibraryMenu.tsx'
import { mountPanel } from '../helpers/library-panel-harness.tsx'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})
it('clears only the chosen session and dismisses after successful completion', async () => {
  const onClear = vi.fn(async () => {})
  const dismiss = vi.fn()
  render(
    <ZoteroLibraryMenu
      tab={{ id: 'library', kind: 'zotero-library' }}
      sessionId="s1"
      t={mockT}
      useZoteroClient={zoteroClientStub}
      onClear={onClear}
      dismiss={dismiss}
    />,
  )
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryClearPosition })),
  )
  expect(onClear).toHaveBeenCalledExactlyOnceWith('s1', 'library')
  expect(dismiss).toHaveBeenCalledOnce()
})
it('leaves a failed clear visible in the menu and keeps the position recoverable', async () => {
  const dismiss = vi.fn()
  render(
    <ZoteroLibraryMenu
      tab={{ id: 'library', kind: 'zotero-library' }}
      sessionId="s1"
      t={mockT}
      useZoteroClient={zoteroClientStub}
      onClear={async () => {
        throw new Error('storage refused')
      }}
      dismiss={dismiss}
    />,
  )
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryClearPosition })),
  )
  expect(screen.getByRole('alert').textContent).toContain('storage refused')
  expect(dismiss).not.toHaveBeenCalled()
})
it('clears the mounted panel through its own tab binding', async () => {
  let clear: (() => void) | undefined
  mountPanel({}, undefined, {
    bindRefresh: (_s, _t, _r, next) => {
      clear = next
      return () => {}
    },
  })
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  await screen.findByRole('button', { name: zh.readPdf })
  expect(clear).toBeTypeOf('function')
  act(() => clear?.())
  await waitFor(() => expect(screen.queryByRole('button', { name: zh.readPdf })).toBeNull())
})
it('propagates a mounted storage-clear failure to its menu caller', async () => {
  let clear: (() => void) | undefined
  mountPanel({}, undefined, {
    bindRefresh: (_s, _t, _r, next) => {
      clear = next
      return () => {}
    },
  })
  await screen.findByText('FlashAttention-2')
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('storage refused')
  })
  act(() => expect(() => clear?.()).toThrow(zh.libraryPositionResetFailed))
  expect(await screen.findByText(/storage refused/)).toBeTruthy()
})
it('refreshes the mounted feed through the native tab command binding', async () => {
  let refresh: (() => void) | undefined
  const signal = new AbortController()
  const useTabInfo = (() => ({
    tab: {
      id: 'library',
      signal: signal.signal,
      visible: true,
      actions: {
        openResource: vi.fn(),
        bindCommands: (commands: { refresh?: () => void }) => {
          refresh = commands.refresh
          return () => {}
        },
      },
    },
  })) as import('../../../src/client/components/library/ZoteroLibraryPanel.tsx').ZoteroLibraryPanelProps['useTabInfo']
  const { face } = mountPanel({}, undefined, { useTabInfo })
  await screen.findByText('FlashAttention-2')
  const reads = face.search.mock.calls.length
  act(() => refresh?.())
  await waitFor(() => expect(face.search.mock.calls.length).toBeGreaterThan(reads))
  signal.abort()
})
