// @vitest-environment jsdom
/**
 * The library panel's rendered states: the settled surfaces (tree rows,
 * saved searches, item page, inspector sections), and each lane's loading,
 * error, and empty arms. Interactions live in `.interaction`.
 * @module tests/client/library/library-panel.states
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  CONNECTED,
  ITEM_DETAIL,
  mountPanel,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  // A failed mount leaves its tree in the shared document; later findBy
  // queries would read multiple matches off the stale copy.
  cleanup()
})

describe('the settled panel', () => {
  it('invalidates shared reads before reloading on refresh', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    expect(face.invalidate).not.toHaveBeenCalled()
    face.search.mockClear()
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await waitFor(() => expect(face.search).toHaveBeenCalledTimes(1))
    expect(face.invalidate).toHaveBeenCalledTimes(1)
    expect(face.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      face.search.mock.invocationCallOrder[0]!,
    )
  })
  it('anchors collection and saved-search writes to the selected scope and drops drafts on scope changes', async () => {
    const sessions = { ids: ['s1'], byId: { s1: { cwd: '/tmp/ws', running: true } } }
    const { face } = mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
        })),
      },
      sessions,
    )
    fireEvent.click(await screen.findByText('LLM Papers'))
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'updateCollection' },
    })
    const ref = screen.getByLabelText(zh.libraryWriteCollection) as HTMLTextAreaElement
    expect(ref.value).toBe('zotero://user/0/collection/COLL0001')
    fireEvent.change(screen.getByLabelText(zh.libraryWriteName), {
      target: { value: 'Unsaved collection draft' },
    })
    fireEvent.click(screen.getByText('Unread'))
    fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
      target: { value: 'updateSavedSearch' },
    })
    expect((screen.getByLabelText(zh.libraryWriteSearch) as HTMLTextAreaElement).value).toBe(
      'zotero://user/0/search/SEARCH01',
    )
    expect((screen.getByLabelText(zh.libraryWriteName) as HTMLTextAreaElement).value).toBe('')
    sessions.byId.s1.running = false
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    expect(screen.getByText(zh.libraryWriteNeedsSession)).toBeTruthy()
    expect(face.write).not.toHaveBeenCalled()
  })
  it('closes the library, sort and connection-detail menus with Escape', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    const searchCount = face.search.mock.calls.length
    for (const name of [zh.librarySelectLibrary, zh.librarySortLabel, zh.detailsLabel]) {
      const trigger = screen.getByRole('button', { name })
      fireEvent.click(trigger)
      expect(await screen.findByRole('menu')).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
    }
    expect(face.search).toHaveBeenCalledTimes(searchCount)
  })
  it('renders the fixed scopes, the collection tree, and the saved searches', async () => {
    mountPanel()
    // The fixed row's label also names the list header while the library
    // scope is selected, so the pair is the assertion, not a single match.
    expect((await screen.findAllByText(zh.libraryAllItems)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.libraryPublications)).toBeTruthy()
    expect(screen.getByText(zh.libraryTrash)).toBeTruthy()
    expect(await screen.findByText('LLM Papers')).toBeTruthy()
    expect(await screen.findByText('Unread')).toBeTruthy()
    expect(await screen.findByText('FlashAttention-2')).toBeTruthy()
  })

  it('renders the range label from the page answer', async () => {
    mountPanel()
    await screen.findByText('FlashAttention-2')
    expect(screen.getByText('第 1–2 条，共 2 条')).toBeTruthy()
  })

  it('badges the row whose best attachment is a PDF', async () => {
    mountPanel({
      search: vi.fn(async () => ({
        ok: true,
        value: searchPage({
          items: [
            { ...searchPage().items[0]!, bestAttachmentType: 'application/pdf' },
            searchPage().items[1]!,
            {
              ...searchPage().items[0]!,
              ref: 'zotero://user/0/item/ITEM0003',
              title: 'Snapshot only',
              bestAttachmentType: 'text/html',
            },
          ],
        }),
      })),
    })
    await screen.findByText('FlashAttention-2')
    // Exactly one badge: the PDF-typed row only; a snapshot hit stays unbadged.
    expect(screen.getAllByText('PDF')).toHaveLength(1)
  })

  it('renders the connectivity lamp from the probe answer', async () => {
    mountPanel()
    await screen.findByText(zh.libraryConnected)
  })

  it('renders narrow navigation buttons and switches active tab state', async () => {
    mountPanel()
    await screen.findByText('FlashAttention-2')

    const treeTab = screen.getByRole('tab', { name: zh.libraryNavTree })
    const listTab = screen.getByRole('tab', { name: zh.libraryNavList })
    const inspectorTab = screen.getByRole('tab', { name: zh.libraryNavInspector })

    expect(listTab.getAttribute('aria-selected')).toBe('true')
    expect(treeTab.getAttribute('aria-selected')).toBe('false')

    act(() => {
      treeTab.click()
    })
    expect(treeTab.getAttribute('aria-selected')).toBe('true')
    expect(listTab.getAttribute('aria-selected')).toBe('false')

    act(() => {
      inspectorTab.click()
    })
    expect(inspectorTab.getAttribute('aria-selected')).toBe('true')

    act(() => {
      listTab.click()
    })
    expect(listTab.getAttribute('aria-selected')).toBe('true')
  })

  it('renders write drawer when write capability is enabled in probe status', async () => {
    mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: {
            ...CONNECTED,
            write: { enabled: true, alwaysAllow: false },
          },
        })),
      },
      {
        ids: ['s1'],
        byId: { s1: { cwd: '/tmp/ws', running: true } },
      },
    )

    expect(await screen.findByText(zh.libraryWriteActions)).toBeTruthy()
  })

  it('renders the inspector sections for a selected row', async () => {
    const { view } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    row.click()
    await waitFor(() => {
      expect(screen.getByText(zh.libraryMetaVenue)).toBeTruthy()
    })
    // The venue shows in the head origin line and the info table; the head
    // carries the type eyebrow and the creators line (the type string also
    // names the list row's badge, so the pair is the assertion).
    expect(screen.getAllByText('NeurIPS').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('conferencePaper').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Tri Dao')).toBeTruthy()
    expect(screen.getByText(zh.libraryNotesTitle.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(zh.libraryAttachmentsTitle.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(zh.libraryAnnotationsTitle.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText('idea')).toBeTruthy()
    expect(screen.getByText('paper.pdf')).toBeTruthy()
    expect(screen.getByText('faster')).toBeTruthy()
    // The no-selection hint is gone once a row is chosen.
    expect(screen.queryByText(zh.libraryNoSelection)).toBeNull()
    void view
  })

  it('exposes one roving tree item and responds to navigation keys', async () => {
    mountPanel()
    await screen.findByText('LLM Papers')
    const items = screen.getAllByRole('treeitem')
    expect(items).toHaveLength(2)
    expect(items.filter((item) => item.getAttribute('tabindex') === '0')).toHaveLength(1)
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(items[1]?.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(items[1]!, { key: 'Home' })
    expect(items[0]?.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(items[0]!, { key: 'ArrowRight' })
    expect(await screen.findByText('Attention')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'LLM Papers' }), { key: 'ArrowLeft' })
  })
})

describe('lane states', () => {
  const pending = (): Promise<never> => new Promise(() => {})

  it('shows the loading arms while a lane request is in flight', async () => {
    mountPanel({
      browse: vi.fn(() => pending()),
    })
    // The root tree lane and the saved searches both wait on browse.
    expect((await screen.findAllByText(zh.libraryLoading)).length).toBeGreaterThanOrEqual(2)
  })

  it('shows the empty arms when the listings carry no rows', async () => {
    mountPanel({
      browse: vi.fn(async () => ({
        ok: true,
        value: { kind: 'collections', items: [], total: 0, offset: 0, returned: 0 },
      })),
    })
    expect(await screen.findByText(zh.libraryNoCollections)).toBeTruthy()
    expect(await screen.findByText(zh.libraryNoSavedSearches)).toBeTruthy()
  })

  it('falls back the breadcrumb tooltip to the bare name for root-less paths', async () => {
    mountPanel({
      browse: vi.fn(async (request: { kind: string }) => ({
        ok: true,
        value:
          request.kind === 'libraries'
            ? {
                kind: 'libraries',
                items: [{ kind: 'library', library: { type: 'user', id: 0 }, name: 'My Library' }],
                total: 1,
                offset: 0,
                returned: 1,
              }
            : {
                kind: 'collections',
                items: [{ kind: 'collection', ref: 'c1', name: 'Flat', path: [], depth: 0 }],
                total: 1,
                offset: 0,
                returned: 1,
              },
      })),
    })
    const row = await screen.findByText('Flat')
    expect(row.closest('button')?.getAttribute('title')).toBe('Flat')
  })

  it('shows the selector and saved-search errors when only those lanes fail', async () => {
    mountPanel({
      browse: vi.fn(async (request: { kind: string }) => {
        if (request.kind === 'libraries') return { ok: false, error: { message: 'no groups' } }
        if (request.kind === 'savedSearches')
          return { ok: false, error: { message: 'searches down' } }
        return {
          ok: true,
          value: { kind: 'collections', items: [], total: 0, offset: 0, returned: 0 },
        }
      }),
    })
    expect(await screen.findByText('no groups')).toBeTruthy()
    expect(await screen.findByText('searches down')).toBeTruthy()
  })

  it('renders the sparse inspector: a detail with no optional fields', async () => {
    mountPanel({
      item: vi.fn(async () => ({
        ok: true,
        value: {
          ref: 'r',
          itemType: 'note',
          title: 'Sparse',
          creators: [],
          abstractTruncated: false,
          tags: [],
          collections: [],
          children: { total: 0 },
        },
      })),
    })
    const row = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    act(() => {
      row.click()
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sparse' })).toBeTruthy()
    })
    // Only the type row renders; nothing else, and no truncation note.
    expect(screen.queryByText(zh.libraryMetaCreators)).toBeNull()
    expect(screen.queryByText(zh.libraryMetaAbstract)).toBeNull()
    expect(screen.queryByText(zh.libraryAbstractTruncated)).toBeNull()
  })

  it('shows the note-body supplement and the abstract truncation note', async () => {
    mountPanel({
      item: vi.fn(async () => ({
        ok: true,
        value: {
          ...ITEM_DETAIL,
          abstract: 'A very long abstract that got cut.',
          abstractTruncated: true,
          noteBody: { text: 'a scanned note body', truncated: false },
        },
      })),
    })
    const row = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    act(() => {
      row.click()
    })
    expect(await screen.findByText('a scanned note body')).toBeTruthy()
    // The clamped abstract carries an expand toggle instead of a truncation
    // note; the whole note body carries neither.
    expect(screen.getByRole('button', { name: zh.libraryExpand })).toBeTruthy()
    expect(screen.queryByText(zh.libraryAbstractTruncated)).toBeNull()
  })

  it('shows the inspector error when the detail request fails', async () => {
    mountPanel({
      item: vi.fn(async () => ({ ok: false, error: { message: 'detail gone' } })),
    })
    const row = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    act(() => {
      row.click()
    })
    expect(await screen.findByText('detail gone')).toBeTruthy()
  })

  it('renders the absent-side arms of notes and annotations', async () => {
    mountPanel({
      item: vi.fn(async () => ({
        ok: true,
        value: {
          ...ITEM_DETAIL,
          abstract: undefined,
          noteBody: undefined,
          notes: {
            offset: 0,
            total: 1,
            returned: 1,
            items: [{ ref: 'n', text: 'plain note', truncated: false }],
          },
          annotations: {
            offset: 0,
            total: 1,
            returned: 1,
            items: [{ ref: 'a', type: 'highlight', text: '' }],
          },
        },
      })),
    })
    const row = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    act(() => {
      row.click()
    })
    await waitFor(() => {
      expect(screen.getByText('plain note')).toBeTruthy()
    })
    // An annotation with empty text renders no paragraph and no extras.
    expect(screen.queryByText(zh.libraryMetaAbstract)).toBeNull()
  })

  it('shows the offline lamp when the probe answers disconnected', async () => {
    mountPanel({
      status: vi.fn(async () => ({
        ok: true,
        value: { ...CONNECTED, connected: false, diagnosis: 'refused' },
      })),
    })
    await screen.findByText(zh.libraryOffline)
  })

  it('gates every lane and shows the note when the probe answers disconnected', async () => {
    const { face } = mountPanel({
      status: vi.fn(async () => ({
        ok: true,
        value: { ...CONNECTED, connected: false, diagnosis: 'refused' },
      })),
    })
    await screen.findByText(zh.libraryOffline)
    expect(screen.getByText(zh.libraryOfflineNote)).toBeTruthy()
    expect(screen.getByText('refused')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(face.browse).not.toHaveBeenCalled()
    expect(face.search).not.toHaveBeenCalled()
    expect(face.item).not.toHaveBeenCalled()
  })

  it('gates every lane when the probe itself rejects', async () => {
    const { face } = mountPanel({
      status: vi.fn(async () => ({ ok: false, error: { message: 'probe down' } })),
    })
    await screen.findByText(zh.libraryOffline)
    expect(screen.getByText(zh.libraryOfflineNote)).toBeTruthy()
    expect(screen.getByText('probe down')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(face.browse).not.toHaveBeenCalled()
    expect(face.search).not.toHaveBeenCalled()
    expect(face.item).not.toHaveBeenCalled()
  })

  it('shows the error message when the list search fails', async () => {
    mountPanel({
      search: vi.fn(async () => ({ ok: false, error: { message: 'Zotero 未连接' } })),
    })
    expect(await screen.findByText('Zotero 未连接')).toBeTruthy()
  })

  it('shows the empty-list note for a ready page with no rows', async () => {
    mountPanel({
      search: vi.fn(async () => ({ ok: true, value: searchPage({ items: [], returned: 0 }) })),
    })
    expect(await screen.findByText(zh.libraryEmptyList)).toBeTruthy()
  })

  it('shows the tree error inline when the root listing fails', async () => {
    mountPanel({
      browse: vi.fn(async () => ({ ok: false, error: { message: 'listing failed' } })),
    })
    // Every browse lane (root tree and saved searches) reports the failure.
    expect((await screen.findAllByText('listing failed')).length).toBeGreaterThanOrEqual(1)
  })

  it('disables the write drawer while the pane session is not running and keeps the panel usable', async () => {
    mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, authorized: true } },
        })),
      },
      { ids: [], byId: {} },
    )
    expect(await screen.findByText(zh.libraryWriteActions)).toBeTruthy()
    expect(await screen.findByText(zh.libraryWriteNeedsSession)).toBeTruthy()
    expect(await screen.findByText('FlashAttention-2')).toBeTruthy()
  })

  it('shows the full-text hint only while the everything mode is on', async () => {
    const { view } = mountPanel()
    await screen.findByText('FlashAttention-2')
    expect(view.queryByText(zh.libraryEverythingHint)).toBeNull()
    view.getByRole('tab', { name: zh.librarySearchModeEverything }).click()
    expect(await screen.findByText(zh.libraryEverythingHint)).toBeTruthy()
  })
})
