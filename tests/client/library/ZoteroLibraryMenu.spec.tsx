// @vitest-environment jsdom
/**
 * Zotero library menu test suite.
 * @module tests/client/library/ZoteroLibraryMenu
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroLibraryMenu } from '../../../src/client/components/library/ZoteroLibraryMenu.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'

const t = mockT
const useZoteroClient = () => zoteroClientStub()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ZoteroLibraryMenu', () => {
  it('changes the slot tab kind without changing hook order', () => {
    const useClient = () => {
      useState(0)
      return zoteroClientStub()
    }
    const props = { t, useZoteroClient: useClient }
    const { rerender, container } = render(<ZoteroLibraryMenu {...props} tab={{ kind: 'other' }} />)
    rerender(<ZoteroLibraryMenu {...props} tab={{ kind: 'zotero-library', id: 'library' }} />)
    expect(screen.getByRole('menuitem', { name: mockT('libraryMenuRefresh') })).toBeTruthy()
    rerender(<ZoteroLibraryMenu {...props} tab={{ kind: 'other' }} />)
    expect(container.innerHTML).toBe('')
  })
  it('renders nothing when tab kind is not zotero-library', () => {
    const { container } = render(
      <ZoteroLibraryMenu tab={{ kind: 'other' }} t={t} useZoteroClient={useZoteroClient} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders refresh and open in zotero buttons when tab kind is zotero-library', () => {
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        useZoteroClient={useZoteroClient}
      />,
    )
    expect(screen.getByRole('menuitem', { name: mockT('libraryMenuRefresh') })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: mockT('openInZotero') })).toBeDefined()
  })

  it('invokes onRefresh and dismiss when clicking refresh button', () => {
    const handleRefresh = vi.fn()
    const handleDismiss = vi.fn()
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        onRefresh={handleRefresh}
        dismiss={handleDismiss}
        useZoteroClient={useZoteroClient}
      />,
    )
    const refreshBtn = screen.getByRole('menuitem', { name: mockT('libraryMenuRefresh') })
    fireEvent.click(refreshBtn)
    expect(handleDismiss).toHaveBeenCalledTimes(1)
    expect(handleRefresh).toHaveBeenCalledTimes(1)
  })

  it('triggers protocol open and dismiss when clicking open in zotero button', () => {
    const openProtocol = vi.fn(async () => true)
    const handleDismiss = vi.fn()
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        dismiss={handleDismiss}
        useZoteroClient={() => zoteroClientStub({ openProtocol })}
      />,
    )
    const openBtn = screen.getByRole('menuitem', { name: mockT('openInZotero') })
    fireEvent.click(openBtn)
    expect(handleDismiss).toHaveBeenCalledTimes(1)
    expect(openProtocol).toHaveBeenCalledWith('zotero://select/')
  })

  it('clears the stored position for this session and dismisses the menu', async () => {
    const handleClear = vi.fn(async () => {})
    const handleDismiss = vi.fn()
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        onClear={handleClear}
        dismiss={handleDismiss}
        useZoteroClient={useZoteroClient}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('libraryClearPosition') }))
    await waitFor(() => expect(handleDismiss).toHaveBeenCalledTimes(1))
    expect(handleClear).toHaveBeenCalledWith('session-1', 'tab-1')
  })

  it('leaves a tab without a session alone when clear is chosen', async () => {
    const handleClear = vi.fn(async () => {})
    const handleDismiss = vi.fn()
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        t={t}
        onClear={handleClear}
        dismiss={handleDismiss}
        useZoteroClient={useZoteroClient}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('libraryClearPosition') }))
    await Promise.resolve()
    expect(handleClear).not.toHaveBeenCalled()
    expect(handleDismiss).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a clear rejection that is not an Error by its string form', async () => {
    const handleClear = vi.fn(() => Promise.reject('storage unavailable'))
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        onClear={handleClear}
        dismiss={vi.fn()}
        useZoteroClient={useZoteroClient}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('libraryClearPosition') }))
    expect((await screen.findByRole('alert')).textContent).toContain('storage unavailable')
  })
})
