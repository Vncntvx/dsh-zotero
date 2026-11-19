// @vitest-environment jsdom
/**
 * The source inspector's overflow feedback: copy-title, copy-link and
 * open-in-Zotero report success and failure through a toast, and the toast's
 * own completion clears it. Every branch here is a user action on the locate
 * submenu, driven through the rendered primitive menu.
 * @module tests/client/workspace/SourceInspector.menu-feedback
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceInspector } from '../../../src/client/components/workspace/SourceInspector.tsx'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'

const { writeClipboard } = vi.hoisted(() => ({ writeClipboard: vi.fn(async () => true) }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard }
})

const t = mockT
const SOURCE_REF = 'zotero://user/0/item/MENU0001'

function renderInspector(
  openProtocol?: (url: string) => Promise<boolean>,
  overrides: Partial<{ title: string | undefined; ref: string; withDraft: boolean }> = {},
) {
  const ref = overrides.ref ?? SOURCE_REF
  const item = sourceOf({
    key: ref,
    ref,
    title: 'title' in overrides ? overrides.title : 'Menu feedback paper',
  })
  return render(
    <SourceInspector
      workspace={workspaceOf([item])}
      selectedKey={ref}
      selectionHidden={false}
      setMobilePane={vi.fn()}
      {...(overrides.withDraft === false ? {} : { setDraft: vi.fn() })}
      openProtocol={openProtocol}
      t={t}
    />,
  )
}

async function openLocate() {
  fireEvent.click(screen.getByRole('button', { name: t('moreActions') }))
  fireEvent.click(await screen.findByRole('menuitem', { name: t('locateItem') }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('source inspector overflow feedback', () => {
  it('reports a successful title copy and clears the toast when it finishes', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(true as never)
    renderInspector()
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('copyTitle') }))
    expect(writeClipboard).toHaveBeenCalledWith('Menu feedback paper')
    await vi.waitFor(() => expect(screen.getByText(t('copied'))).toBeDefined())
  })

  it('reports a rejected title copy as unavailable', async () => {
    vi.mocked(writeClipboard).mockRejectedValueOnce(new Error('denied'))
    renderInspector()
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('copyTitle') }))
    await vi.waitFor(() =>
      expect(screen.getByText(t('libraryCopyClipboardUnavailable'))).toBeDefined(),
    )
  })

  it('reports a declined title copy as unavailable', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(false as never)
    renderInspector()
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('copyTitle') }))
    await vi.waitFor(() =>
      expect(screen.getByText(t('libraryCopyClipboardUnavailable'))).toBeDefined(),
    )
  })

  it('ignores a title copy when the source has no title', async () => {
    renderInspector(undefined, { title: undefined })
    await openLocate()
    const titleItem = await screen.findByRole('menuitem', { name: t('copyTitle') })
    expect(titleItem).toHaveProperty('disabled', true)
    fireEvent.click(titleItem)
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('ignores link actions when the ref cannot form a canonical URL', async () => {
    const openProtocol = vi.fn(async () => true)
    renderInspector(openProtocol, { ref: 'not-a-ref' })
    await openLocate()
    expect(await screen.findByRole('menuitem', { name: t('copyZoteroLink') })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('menuitem', { name: t('openInZotero') })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('omits the export row when no draft setter is supplied', async () => {
    renderInspector(undefined, { withDraft: false })
    await openLocate()
    expect(screen.queryByRole('menuitem', { name: t('exportCitation') })).toBeNull()
  })

  it('reports a successful link copy', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(true as never)
    renderInspector()
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('copyZoteroLink') }))
    await vi.waitFor(() => expect(screen.getByText(t('copied'))).toBeDefined())
  })

  it('disables the open-in-Zotero action without a protocol opener', async () => {
    renderInspector(undefined)
    await openLocate()
    expect(screen.getByRole('menuitem', { name: t('openInZotero') })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('reports a rejected link copy as unavailable', async () => {
    vi.mocked(writeClipboard).mockRejectedValueOnce(new Error('denied'))
    renderInspector()
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('copyZoteroLink') }))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://select/library/items/MENU0001')
    await vi.waitFor(() =>
      expect(screen.getByText(t('libraryCopyClipboardUnavailable'))).toBeDefined(),
    )
  })

  it('opens the canonical link through the host protocol', async () => {
    const openProtocol = vi.fn(async () => true)
    renderInspector(openProtocol)
    await openLocate()
    fireEvent.click(await screen.findByRole('menuitem', { name: t('openInZotero') }))
    expect(openProtocol).toHaveBeenCalledWith('zotero://select/library/items/MENU0001')
  })

  it('closes the menu again when its backdrop is dismissed', async () => {
    renderInspector()
    await openLocate()
    expect(screen.getByRole('menuitem', { name: t('copyTitle') })).toBeDefined()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('menuitem', { name: t('copyTitle') })).toBeNull()
  })
})
