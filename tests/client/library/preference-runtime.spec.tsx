// @vitest-environment jsdom
/** Preferences preserve the owning tab and affect real panel actions. */
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createLibraryPreferenceSource,
  libraryViewMemory,
} from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { useLibraryFeed } from '../../../src/client/components/library/useLibraryFeed.ts'
import { writeLibraryState } from '../../../src/client/components/library/library-storage.ts'
import {
  mountPanel,
  ITEM_DETAIL,
  searchPage,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { zh } from '../../../src/client/locales.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
function accepted(overrides = {}) {
  const form = fakeScope({ value: { ...LIBRARY_DEFAULTS, ...overrides } })
  const source = createLibraryPreferenceSource(
    form,
    fakeScope({ value: { defaultStyle: 'apa', defaultLocale: 'en-US' } }),
  )
  return { form, source }
}
function feedFace(): LibraryFeedFace {
  return {
    collectionPath: vi.fn(async (request) => ({
      ok: true as const,
      value: { ...request, path: [] },
    })),
    browse: vi.fn(async (request) => ({
      ok: true as const,
      value:
        request.kind === 'libraries'
          ? LIBRARY_ROWS
          : request.kind === 'savedSearches'
            ? SAVED_SEARCHES
            : ROOT_COLLECTIONS,
    })),
    search: vi.fn(async () => ({ ok: true as const, value: searchPage() })),
    item: vi.fn(async () => ({ ok: true as const, value: ITEM_DETAIL })),
    childPage: vi.fn(),
  }
}
it('starts all-items only for a new tab and retains the same occurrence across body remounts', async () => {
  const face = feedFace()
  const signal = new AbortController()
  const preferences = { ...LIBRARY_DEFAULTS, reopenBehavior: 'allItems' as const }
  writeLibraryState('S1', 'session-1', {
    version: 3,
    prefixes: {},
    library: { type: 'group', id: 123 },
    selection: { kind: 'library' },
    q: 'old',
    mode: 'everything',
    sort: 'title',
    direction: 'asc',
    offset: 50,
    expanded: [],
    filters: { tags: ['old'] },
  })
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1')
  const mount = () =>
    renderHook(() => useLibraryFeed(face, 'S1', true, 'session-1', preferences, memory))
  const first = mount()
  await waitFor(() => expect(first.result.current.list.phase).toBe('ready'))
  expect(first.result.current.q).toBe('')
  expect(first.result.current.sort).toBe('dateModified')
  act(() => {
    first.result.current.setMode('everything')
    first.result.current.setFilters({ tags: ['kept'] })
  })
  first.unmount()
  const second = mount()
  await waitFor(() => expect(second.result.current.mode).toBe('everything'))
  expect(second.result.current.filters).toEqual({ tags: ['kept'] })
  second.unmount()
  signal.abort()
  const third = renderHook(() =>
    useLibraryFeed(
      face,
      'S1',
      true,
      'session-1',
      preferences,
      libraryViewMemory(new AbortController().signal, 'S1', 'session-1'),
    ),
  )
  await waitFor(() => expect(third.result.current.list.phase).toBe('ready'))
  expect(third.result.current.filters).toEqual({})
})
it.each(['preserve', 'clear'] as const)(
  'applies %s only across ordinary collection scopes',
  async (scopeChangeBehavior) => {
    const face = feedFace()
    const { result } = renderHook(() =>
      useLibraryFeed(face, 'S1', true, 'session-1', { ...LIBRARY_DEFAULTS, scopeChangeBehavior }),
    )
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.setFilters({ tags: ['read'] }))
    act(() =>
      result.current.selectScope({
        kind: 'collection',
        ref: 'zotero://user/0/collection/COLL0001?server=S1',
        name: 'LLM Papers',
      }),
    )
    expect(result.current.filters).toEqual(
      scopeChangeBehavior === 'preserve' ? { tags: ['read'] } : {},
    )
    act(() => result.current.setFilters({ tags: ['read'] }))
    act(() => result.current.selectScope({ kind: 'trash' }))
    expect(result.current.filters).toEqual({})
  },
)
it('updates untouched disclosures live and retains the current item manual override', async () => {
  const { form, source } = accepted()
  const { view } = mountPanel({}, undefined, { preferenceSource: source })
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    expect(await screen.findByRole('button', { name: '收起摘要' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起摘要' }))
    await act(async () => form.set('detailExpandedSections', ['abstract', 'notes']))
    expect(screen.getByRole('button', { name: '展开摘要' })).toBeTruthy()
    expect(screen.getByText('idea')).toBeTruthy()
    view.unmount()
  } finally {
    source.dispose()
  }
})
it('adds an abstract as a quote without replacing or submitting the draft', async () => {
  const { source } = accepted({ chatInsertContent: 'referenceAndAbstract' })
  const { inputActions } = mountPanel({}, undefined, { preferenceSource: source })
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    fireEvent.click(await screen.findByRole('button', { name: zh.libraryAskInChat }))
    expect(inputActions.insertQuote).toHaveBeenCalledWith(
      expect.stringContaining('Faster attention.'),
    )
    expect(inputActions.insertQuote).toHaveBeenCalledWith(expect.stringContaining(ITEM_DETAIL.ref))
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
  } finally {
    source.dispose()
  }
})
it.each(['sidebar', 'float'] as const)(
  'opens local PDFs in the configured %s destination',
  async (localPdfOpenTarget) => {
    const { source } = accepted({ localPdfOpenTarget })
    const { face } = mountPanel({}, undefined, { preferenceSource: source })
    try {
      fireEvent.click(await screen.findByText('FlashAttention-2'))
      fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
      await waitFor(() =>
        expect(face.openResource).toHaveBeenCalledWith(expect.stringContaining('/session/s1/'), {
          destination: localPdfOpenTarget,
        }),
      )
    } finally {
      source.dispose()
    }
  },
)
it('refuses URL reading while its independent permission is disabled', async () => {
  const { source } = accepted()
  const download = vi.fn()
  const { face } = mountPanel(
    {
      resolveAttachment: vi.fn(async () => ({
        ok: true as const,
        value: {
          ref: 'attachment',
          title: 'paper.pdf',
          kind: 'url',
          url: 'https://papers.example/paper.pdf',
        },
      })),
    },
    undefined,
    { preferenceSource: source, readUrlPdf: download },
  )
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
    expect(await screen.findByText(zh.libraryUrlPdfDisabled)).toBeTruthy()
    expect(download).not.toHaveBeenCalled()
    expect(face.openResource).not.toHaveBeenCalled()
  } finally {
    source.dispose()
  }
})

it.each(['sidebar', 'float'] as const)(
  'opens a complete URL PDF in %s and tracks its lease',
  async (urlPdfOpenTarget) => {
    const { source } = accepted({ allowUrlPdfRead: true, urlPdfOpenTarget })
    const trackPdf = vi.fn()
    const releaseUrlPdf = vi.fn(async () => {})
    const readUrlPdf = vi.fn(async () => ({
      ok: true as const,
      value: {
        ref: ITEM_DETAIL.ref,
        title: 'paper.pdf',
        contentType: 'application/pdf' as const,
        path: '/tmp/reading.pdf',
        lease: 'lease',
      },
    }))
    const { face } = mountPanel(
      {
        resolveAttachment: vi.fn(async () => ({
          ok: true as const,
          value: {
            ref: ITEM_DETAIL.ref,
            title: 'paper.pdf',
            kind: 'url',
            url: 'https://papers.example/paper.pdf',
          },
        })),
      },
      undefined,
      { preferenceSource: source, readUrlPdf, trackPdf, releaseUrlPdf },
    )
    try {
      fireEvent.click(await screen.findByText('FlashAttention-2'))
      fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
      await waitFor(() =>
        expect(trackPdf).toHaveBeenCalledWith(
          expect.stringContaining('/tmp/reading.pdf'),
          'lease',
          ITEM_DETAIL.ref,
        ),
      )
      expect(face.openResource).toHaveBeenCalledWith(expect.stringContaining('/tmp/reading.pdf'), {
        destination: urlPdfOpenTarget,
      })
      expect(releaseUrlPdf).not.toHaveBeenCalled()
    } finally {
      source.dispose()
    }
  },
)
it('releases a completed URL PDF if opening the host reader fails', async () => {
  const { source } = accepted({ allowUrlPdfRead: true })
  const releaseUrlPdf = vi.fn(async () => {})
  const readUrlPdf = vi.fn(async () => ({
    ok: true as const,
    value: {
      ref: ITEM_DETAIL.ref,
      title: 'paper.pdf',
      contentType: 'application/pdf' as const,
      path: '/tmp/reading.pdf',
      lease: 'lease',
    },
  }))
  const trackPdf = vi.fn()
  const forgetPdf = vi.fn()
  mountPanel(
    {
      openResource: vi.fn(() => {
        throw new Error('reader refused')
      }),
      resolveAttachment: vi.fn(async () => ({
        ok: true as const,
        value: {
          ref: ITEM_DETAIL.ref,
          title: 'paper.pdf',
          kind: 'url',
          url: 'https://papers.example/paper.pdf',
        },
      })),
    },
    undefined,
    { preferenceSource: source, readUrlPdf, trackPdf, forgetPdf, releaseUrlPdf },
  )
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
    expect(await screen.findByText('reader refused')).toBeTruthy()
    expect(releaseUrlPdf).toHaveBeenCalledExactlyOnceWith('lease')
    expect(forgetPdf).toHaveBeenCalledWith(expect.stringContaining('/tmp/reading.pdf'))
  } finally {
    source.dispose()
  }
})
it('hands a local PDF to Zotero when that accepted target is selected', async () => {
  const { source } = accepted({ localPdfOpenTarget: 'zotero' })
  const openProtocol = vi.fn(async () => true)
  const { face } = mountPanel({}, undefined, {
    preferenceSource: source,
    useZoteroClient: () => zoteroClientStub({ openProtocol }),
  })
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
    await waitFor(() =>
      expect(openProtocol).toHaveBeenCalledWith(expect.stringMatching(/^zotero:\/\/open-pdf\//)),
    )
    expect(face.openResource).not.toHaveBeenCalled()
  } finally {
    source.dispose()
  }
})

it.each([
  { abstract: undefined, abstractTruncated: undefined, expected: zh.libraryAbstractMissing },
  {
    abstract: 'Partial abstract',
    abstractTruncated: true,
    expected: zh.libraryInsertedAbstractTruncated,
  },
])(
  'marks unavailable or truncated abstracts in conversation inserts: $expected',
  async ({ abstract, abstractTruncated, expected }) => {
    const { source } = accepted({ chatInsertContent: 'referenceAndAbstract' })
    const { inputActions } = mountPanel(
      {
        item: vi.fn(async () => ({
          ok: true as const,
          value: { ...ITEM_DETAIL, abstract, abstractTruncated },
        })),
      },
      undefined,
      { preferenceSource: source },
    )
    try {
      fireEvent.click(await screen.findByText('FlashAttention-2'))
      fireEvent.click(await screen.findByRole('button', { name: zh.libraryAskInChat }))
      expect(inputActions.insertQuote).toHaveBeenCalledWith(expect.stringContaining(expected))
      expect(inputActions.setDraft).not.toHaveBeenCalled()
    } finally {
      source.dispose()
    }
  },
)
