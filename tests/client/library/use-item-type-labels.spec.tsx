// @vitest-environment jsdom
/** The panel-level item-type vocabulary: one bounded walk, shared by every surface. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroLibraryBrowseResultView } from '../../../src/contract.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { useItemTypeVocabulary } from '../../../src/client/components/library/use-item-type-labels.ts'
import { itemTypeLabelOf } from '../../../src/client/components/library/item-type-labels.ts'
import { zh } from '../../../src/client/locales.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

const page = (
  overrides: Partial<ZoteroLibraryBrowseResultView> = {},
): ZoteroLibraryBrowseResultView => ({
  kind: 'itemTypes',
  items: [
    { kind: 'itemType', itemType: 'book', localized: 'Books' },
    { kind: 'itemType', itemType: 'journalArticle' },
    { kind: 'itemType', itemType: 'customThing', localized: 'Custom Thing' },
  ],
  total: 3,
  offset: 0,
  returned: 3,
  limit: 50,
  ...overrides,
})

function faceOf(browse: LibraryFeedFace['browse']): LibraryFeedFace {
  return {
    collectionPath: vi.fn(),
    browse,
    search: vi.fn(),
    item: vi.fn(),
    childPage: vi.fn(),
  }
}

describe('useItemTypeVocabulary', () => {
  it('walks every page and publishes both the rows and Zotero’s localized names', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({
        ok: true,
        value: page({ items: [page().items[0]!, page().items[1]!], returned: 2, nextOffset: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: page({ items: [page().items[2]!], offset: 2, returned: 1 }),
      })
    const face = faceOf(browse)
    const { result } = renderHook(() => useItemTypeVocabulary(face, mockT, true))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(browse).toHaveBeenNthCalledWith(
      1,
      { kind: 'itemTypes', offset: 0, limit: 50 },
      expect.anything(),
    )
    expect(browse).toHaveBeenNthCalledWith(
      2,
      { kind: 'itemTypes', offset: 2, limit: 50 },
      expect.anything(),
    )
    expect(result.current.localized).toEqual({ book: 'Books', customThing: 'Custom Thing' })
    expect(result.current.error).toBeUndefined()
  })

  it('publishes the failure and re-walks when retry is called', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('zotero/unexpected', 'listing failed', {
          code: 'ZOTERO_UNEXPECTED',
        }),
      })
      .mockResolvedValueOnce({ ok: true, value: page() })
    const face = faceOf(browse)
    const { result } = renderHook(() => useItemTypeVocabulary(face, mockT, true))
    await waitFor(() => expect(result.current.error).toBe('listing failed'))
    expect(result.current.rows).toEqual([])
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(result.current.error).toBeUndefined()
  })

  it('refuses a cursor that does not advance', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValue({ ok: true, value: page({ nextOffset: 0 }) })
    const face = faceOf(browse)
    const { result } = renderHook(() => useItemTypeVocabulary(face, mockT, true))
    await waitFor(() => expect(result.current.error).toBe(zh.libraryInvalidPage))
    expect(result.current.rows).toEqual([])
  })

  it('drops an answer that arrives after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const browse = vi.fn(() => pending.promise)
    const face = faceOf(browse)
    const { result, unmount } = renderHook(() => useItemTypeVocabulary(face, mockT, true))
    unmount()
    await act(async () => pending.resolve({ ok: true, value: page() }))
    expect(result.current.rows).toEqual([])
  })

  it('drops a rejection that arrives after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const browse = vi.fn(() => pending.promise)
    const face = faceOf(browse)
    const { result, unmount } = renderHook(() => useItemTypeVocabulary(face, mockT, true))
    unmount()
    await act(async () => pending.reject(new Error('wire closed')))
    expect(result.current.rows).toEqual([])
    expect(result.current.error).toBeUndefined()
  })

  it('makes no request while disabled', () => {
    const browse = vi.fn<LibraryFeedFace['browse']>()
    const face = faceOf(browse)
    const { result } = renderHook(() => useItemTypeVocabulary(face, mockT, false))
    expect(browse).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
    expect(result.current.localized).toEqual({})
  })
})

describe('itemTypeLabelOf', () => {
  it('prefers the plugin dictionary, then Zotero’s localized name, then the raw value', () => {
    expect(itemTypeLabelOf('journalArticle', {}, mockT)).toBe(zh.libraryItemTypeJournalArticle)
    expect(itemTypeLabelOf('customThing', { customThing: 'Custom Thing' }, mockT)).toBe(
      'Custom Thing',
    )
    expect(itemTypeLabelOf('customThing', {}, mockT)).toBe('customThing')
    expect(itemTypeLabelOf('customThing', { customThing: '' }, mockT)).toBe('customThing')
  })

  it('names every standard Zotero item type in the panel language', () => {
    for (const itemType of [
      'journalArticle',
      'conferencePaper',
      'book',
      'bookSection',
      'report',
      'document',
      'thesis',
      'webpage',
      'dataset',
      'preprint',
      'note',
      'attachment',
    ]) {
      expect(itemTypeLabelOf(itemType, {}, mockT)).not.toBe(itemType)
    }
  })
})
