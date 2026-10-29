// @vitest-environment jsdom
/**
 * Zotero library menu test suite.
 * @module tests/client/library/ZoteroLibraryMenu
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroLibraryMenu } from '../../../src/client/components/library/ZoteroLibraryMenu.tsx'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ZoteroLibraryMenu', () => {
  it('renders nothing when tab kind is not zotero-library', () => {
    const { container } = render(<ZoteroLibraryMenu tab={{ kind: 'other' }} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders refresh and open in zotero buttons when tab kind is zotero-library', () => {
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
      />,
    )
    expect(screen.getByRole('button', { name: mockT('libraryMenuRefresh') })).toBeDefined()
    expect(screen.getByRole('button', { name: mockT('openInZotero') })).toBeDefined()
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
      />,
    )
    const refreshBtn = screen.getByRole('button', { name: mockT('libraryMenuRefresh') })
    fireEvent.click(refreshBtn)
    expect(handleDismiss).toHaveBeenCalledTimes(1)
    expect(handleRefresh).toHaveBeenCalledTimes(1)
  })

  it('triggers protocol open and dismiss when clicking open in zotero button', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const handleDismiss = vi.fn()
    render(
      <ZoteroLibraryMenu
        tab={{ kind: 'zotero-library', id: 'tab-1' }}
        sessionId="session-1"
        t={t}
        dismiss={handleDismiss}
      />,
    )
    const openBtn = screen.getByRole('button', { name: mockT('openInZotero') })
    fireEvent.click(openBtn)
    expect(handleDismiss).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
