// @vitest-environment jsdom
/**
 * The inspector's citation-copy controls: the request each format sends, the
 * text that reaches the clipboard, the per-format done labels, the localized
 * failure keys, the client-only item-info block, and the stale-selection
 * guard.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LibraryCitationActions,
  itemInfoTextOf,
} from '../../../src/client/components/library/LibraryCitationActions.tsx'
import { COPY_FEEDBACK_MS } from '../../../src/client/components/useCopyFeedback.ts'
import type { LibraryExportItem } from '../../../src/client/components/library/library-feed-types.ts'
import type {
  ZoteroItemDetailView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
} from '../../../src/contract.ts'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

/** A translator result: the rendered body only (the panel wire carries no itemization). */
function translatorResult(
  format: 'bibtex' | 'biblatex' | 'ris' | 'csljson',
  text: string,
): ZoteroLibraryExportResultView {
  return { format, text }
}

/** Render the controls with one scripted export face. */
function mount(
  exportItem: LibraryExportItem | undefined,
  detail: ZoteroItemDetailView = ITEM_DETAIL,
): ReturnType<typeof render> {
  return render(<LibraryCitationActions detail={detail} exportItem={exportItem} t={mockT} />)
}

/** The request every single-item copy sends: one ref, host-default rendering. */
function expectedRequest(format: ZoteroLibraryExportRequestView['format']): unknown {
  return { refs: [ITEM_DETAIL.ref], format }
}

describe('export citation menu', () => {
  it('sends the BibTeX request and copies the translator body', async () => {
    const exportItem = vi.fn<LibraryExportItem>(async () => ({
      ok: true,
      value: translatorResult('bibtex', '@article{dao2023flashattention,}'),
    }))
    mount(exportItem)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('@article{dao2023flashattention,}'),
    )
    expect(exportItem).toHaveBeenCalledWith(expectedRequest('bibtex'))
    expect(screen.getByRole('button', { name: zh.libraryCopyBibtexDone })).toBeTruthy()
  })

  it('renders the controls wire-disabled and still copies item info without an export face', async () => {
    mount(undefined)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    const bibtex = screen.getByRole('menuitem', {
      name: zh.libraryCopyBibtex,
    }) as HTMLButtonElement
    expect(bibtex.disabled).toBe(true)
    expect(
      (screen.getByRole('menuitem', { name: zh.libraryCopyRis }) as HTMLButtonElement).disabled,
    ).toBe(true)
    if (!screen.queryByRole('menu'))
      fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(await screen.findByText(zh.libraryCopyItemInfo))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  })
})

describe('the more-formats menu', () => {
  const MENU_CASES = [
    {
      format: 'biblatex' as const,
      label: zh.libraryCopyBiblatex,
      done: zh.libraryCopyBiblatexDone,
      text: '@online{dao2023flashattention,}',
      result: translatorResult('biblatex', '@online{dao2023flashattention,}'),
    },
    {
      format: 'ris' as const,
      label: zh.libraryCopyRis,
      done: zh.libraryCopyRisDone,
      text: 'TY  - CONF',
      result: translatorResult('ris', 'TY  - CONF'),
    },
    {
      format: 'csljson' as const,
      label: zh.libraryCopyCsljson,
      done: zh.libraryCopyCsljsonDone,
      text: '[{"id":"dao2023flashattention"}]',
      result: translatorResult('csljson', '[{"id":"dao2023flashattention"}]'),
    },
  ]

  it.each(MENU_CASES)('copies the $format result through its menu row', async (entry) => {
    const exportItem = vi.fn<LibraryExportItem>(async () => ({ ok: true, value: entry.result }))
    mount(exportItem)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(await screen.findByText(entry.label))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(entry.text)
      // Each menu format reports the format it copied, not the citation's label.
      expect(screen.getByRole('button').textContent).toBe(entry.done)
    })
    expect(exportItem).toHaveBeenCalledWith(expectedRequest(entry.format))
  })

  it('closes the menu on Escape without copying', async () => {
    mount(vi.fn<LibraryExportItem>())
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    expect(await screen.findByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('shows the pending label while a menu-format request is in flight', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryExportResultView>>()
    mount(() => pending.promise)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(await screen.findByText(zh.libraryCopyRis))
    expect(screen.getByRole('button').textContent).toBe(zh.libraryExportPending)
    await act(async () => {
      pending.resolve({ ok: true, value: translatorResult('ris', 'TY  - CONF') })
      await pending.promise
    })
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('TY  - CONF'))
    expect(screen.getByRole('button').textContent).toBe(zh.libraryCopyRisDone)
  })
})

describe('the client-only item info block', () => {
  const withUrl: ZoteroItemDetailView = { ...ITEM_DETAIL, url: 'https://example.com/paper' }

  it('copies title, creators, year and venue, DOI, and URL as five lines', async () => {
    mount(undefined, withUrl)
    if (!screen.queryByRole('menu'))
      fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(await screen.findByText(zh.libraryCopyItemInfo))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button').textContent).toBe(zh.libraryCopyItemInfoDone)
    })
    const [text] = writeText.mock.calls[0] as [string]
    expect(text.split('\n')).toEqual([
      'FlashAttention-2',
      'Tri Dao',
      '2023 · NeurIPS',
      'DOI: 10.0/example',
      'URL: https://example.com/paper',
    ])
  })

  it('drops the absent optional lines instead of leaving blanks', () => {
    expect(
      itemInfoTextOf({
        ...ITEM_DETAIL,
        creators: [{ creatorType: 'author', name: '' }],
        year: undefined,
        date: undefined,
        venue: undefined,
        doi: undefined,
        url: undefined,
      }),
    ).toBe('FlashAttention-2')
  })
})

describe('an export in flight disables the controls', () => {
  it('shows the pending label on the acting button and disables the row', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryExportResultView>>()
    mount(() => pending.promise)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    const pendingButton = screen.getByRole('button', {
      name: zh.libraryExportPending,
    }) as HTMLButtonElement
    expect(pendingButton.disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: zh.libraryExportPending }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await act(async () => {
      pending.resolve({
        ok: true,
        value: translatorResult('bibtex', '@article{dao2023flashattention,}'),
      })
      await pending.promise
    })
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('@article{dao2023flashattention,}'),
    )
    expect(screen.getByRole('button', { name: zh.libraryCopyBibtexDone })).toBeTruthy()
  })
})

describe('failures stay inline and copy nothing', () => {
  it('renders the host failure message', async () => {
    const error = new RemoteError('gateway/internal', 'export failed', {})
    mount(async () => ({ ok: false, error }))
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(mockT('libraryCopyFailed', { message: 'export failed' }))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renders a rejected export call error', async () => {
    mount(async () => {
      throw new Error('wire down')
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(mockT('libraryCopyFailed', { message: 'wire down' }))
  })

  it('renders a rethrown failure for a non-Error rejection', async () => {
    mount(async () => {
      throw 'wire down'
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(mockT('libraryCopyFailed', { message: 'wire down' }))
  })

  it('reports a refused clipboard write', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    mount(async () => ({
      ok: true,
      value: translatorResult('bibtex', '@article{dao2023flashattention,}'),
    }))
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(zh.libraryCopyClipboardUnavailable)
  })
})

describe('the feedback and stale-selection guards', () => {
  it('clears the copied label after the feedback window', async () => {
    vi.useFakeTimers()
    try {
      mount(async () => ({
        ok: true,
        value: translatorResult('bibtex', '@article{dao2023flashattention,}'),
      }))
      fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByRole('button', { name: zh.libraryCopyBibtexDone })).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS)
      })
      expect(screen.getByRole('button', { name: zh.libraryCitationMenu })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a copy answer that belongs to the previous selection', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryExportResultView>>()
    const exportItem = vi.fn(() => pending.promise)
    const { rerender } = mount(exportItem)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    rerender(
      <LibraryCitationActions
        detail={{ ...ITEM_DETAIL, ref: 'zotero://user/0/item/ITEM0002' }}
        exportItem={exportItem}
        t={mockT}
      />,
    )
    await act(async () => {
      pending.resolve({ ok: true, value: translatorResult('bibtex', 'Stale citation') })
      await pending.promise
    })
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.libraryCopyBibtexDone })).toBeNull()
  })

  it('drops a copy outcome that lands after the selection changed mid-clipboard', async () => {
    const clipboard = deferred<void>()
    writeText.mockReturnValueOnce(clipboard.promise)
    const exportItem = vi.fn<LibraryExportItem>(async () => ({
      ok: true,
      value: translatorResult('bibtex', 'Old citation'),
    }))
    const { rerender } = mount(exportItem)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('Old citation')
    rerender(
      <LibraryCitationActions
        detail={{ ...ITEM_DETAIL, ref: 'zotero://user/0/item/ITEM0002' }}
        exportItem={exportItem}
        t={mockT}
      />,
    )
    await act(async () => {
      clipboard.resolve()
      await clipboard.promise
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.libraryCopyBibtexDone })).toBeNull()
  })

  it('drops a rejection that belongs to the previous selection', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryExportResultView>>()
    const exportItem = vi.fn(() => pending.promise)
    const { rerender } = mount(exportItem)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibtex }))
    rerender(
      <LibraryCitationActions
        detail={{ ...ITEM_DETAIL, ref: 'zotero://user/0/item/ITEM0002' }}
        exportItem={exportItem}
        t={mockT}
      />,
    )
    await act(async () => {
      pending.reject(new Error('stale failure'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
