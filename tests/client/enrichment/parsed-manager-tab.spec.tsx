// @vitest-environment jsdom
/** The manager tab names each row, states its facts, and owns open / reparse / discard. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsedManagerTitle } from '../../../src/client/enrichment/ParsedManagerTab.tsx'
import { parsedManagerTabAddress } from '../../../src/client/parsed-manager-tab.ts'
import { en } from '../../../src/client/locales.ts'
import {
  documentParseLabel,
  validDocumentParseTarget,
} from '../../../src/client/enrichment/parse-controller.ts'
import { formatDateTime } from '../../../src/sources/presenters.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import {
  ID,
  MISSING,
  SECOND_TITLE,
  SESSION,
  TITLE,
  listOf,
  listRegion,
  row,
  secondRow,
  world,
  type ListResult,
} from './support/parsed-manager-world.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('parsed document manager tab', () => {
  it('names the row by the captured title and opens it by artifact id', async () => {
    const w = world()
    expect(await screen.findByText(TITLE)).toBeDefined()
    // A healthy row states its source, not a status tag; only the pill row
    // carries the state words.
    expect(within(listRegion()).queryByText(en.parsedManagerStateIndexed)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerOpen }))
    expect(w.openParsed).toHaveBeenCalledWith(SESSION, ID, TITLE)
  })

  it('gives every row exactly the open, reparse, and delete actions', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    const items = within(listRegion()).getAllByRole('listitem')
    expect(items.length).toBe(2)
    for (const item of items) {
      const labels = within(item)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
      expect(labels).toEqual([
        en.parsedManagerOpen,
        en.libraryParsedReparse,
        en.parsedManagerDelete,
      ])
    }
  })

  it('falls back to a short artifact id when no title was captured', async () => {
    world({ list: listOf([{ ...row, title: undefined }]) })
    const name = await screen.findByText(ID.slice(0, 8))
    expect(name.getAttribute('title')).toBe(ID)
  })

  it('states the source, the age, the size and the counts', async () => {
    // A row parsed three days ago reads as an age; the absolute moment stays on
    // the line's tooltip.
    const committedAt = Date.now() - 3 * 24 * 60 * 60 * 1000
    world({ list: listOf([{ ...row, committedAt }]) })
    const meta = await screen.findByText(/Attachment DEF/)
    expect(meta.textContent).toBe(
      'Attachment DEF · 3d · 1.2KB · 1,200 characters · 7 pages · 1 figures',
    )
    expect(meta.closest('[title]')?.getAttribute('title')).toBe(formatDateTime(committedAt))
  })

  it('reads a row parsed moments ago as fresh', async () => {
    world({ list: listOf([{ ...row, committedAt: Date.now() }]) })
    expect(await screen.findByText(/just now/)).toBeDefined()
  })

  it('omits the counts a row does not carry', async () => {
    world({ list: listOf([{ ...row, pageCount: undefined, images: [] }]) })
    const meta = await screen.findByText(/Attachment DEF/)
    expect(meta.textContent).not.toContain('pages')
    expect(meta.textContent).not.toContain('figures')
  })

  it('marks pro artifacts and tags only the rows that need a warning', async () => {
    world({
      list: listOf([
        { ...row, mode: 'pro' },
        { ...row, artifactId: secondRow.artifactId, state: 'orphan', title: 'Odd one' },
      ]),
    })
    expect(await screen.findByText(/MinerU Pro/)).toBeDefined()
    expect(
      within(listRegion()).getByText(en.parsedManagerStateOrphan).getAttribute('data-tone'),
    ).toBe('warning')
    expect(within(listRegion()).queryByText(en.parsedManagerStateIndexed)).toBeNull()
  })

  it('confirms a discard and refreshes the open parsed tabs', async () => {
    const w = world()
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() => expect(w.management.discardParsedDocument).toHaveBeenCalledTimes(1))
    expect(w.management.discardParsedDocument).toHaveBeenCalledWith(
      { sessionId: SESSION, artifactId: ID },
      expect.any(AbortSignal),
    )
    expect(w.discarded).toHaveBeenCalledWith(SESSION, ID)
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(en.parsedManagerDeleted),
    )
  })

  it('keeps the list after a missing discard result', async () => {
    const w = world({ discard: MISSING })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() => expect(w.management.discardParsedDocument).toHaveBeenCalled())
    expect(w.discarded).not.toHaveBeenCalled()
    expect(await screen.findByText(TITLE)).toBeDefined()
  })

  it('closes the confirm modal without discarding', async () => {
    const w = world()
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteCancel }).at(-1)!)
    expect(await screen.findByText(TITLE)).toBeDefined()
    expect(w.management.discardParsedDocument).not.toHaveBeenCalled()
  })

  it('shows the guiding empty state without any row actions', async () => {
    world({ list: listOf([]) })
    expect(await screen.findByText(en.parsedManagerEmpty)).toBeDefined()
    expect(screen.getByText(en.parsedManagerEmptyHint)).toBeDefined()
    expect(screen.queryByRole('button', { name: en.parsedManagerOpen })).toBeNull()
    expect(screen.queryByRole('button', { name: en.parsedManagerSelectAll })).toBeNull()
  })

  it('shows a skeleton until the first page arrives', async () => {
    const pending = deferred<ListResult>()
    world({ pendingList: async () => await pending.promise })
    expect(screen.getByRole('status', { name: en.parsedManagerLoading })).toBeDefined()
    pending.resolve(listOf([row]))
    expect(await screen.findByText(TITLE)).toBeDefined()
    expect(screen.queryByRole('status', { name: en.parsedManagerLoading })).toBeNull()
  })

  it('surfaces a list failure and retries it', async () => {
    const failure: ListResult = { ok: false, error: new Error('disk refused') }
    const w = world({ list: failure })
    expect(
      await screen.findByText(en.parsedManagerError.replace('{message}', 'disk refused')),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: en.parsedManagerOpen })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerRetry }))
    await vi.waitFor(() => expect(w.management.listParsedDocuments).toHaveBeenCalledTimes(2))
  })

  it('refuses to list without authorization and locks the refresh control', async () => {
    const w = world({ listAllowed: false })
    expect(screen.getByText(en.parsedManagerDenied)).toBeDefined()
    const refresh = screen.getByRole('button', { name: en.parsedManagerRefresh })
    expect((refresh as HTMLButtonElement).disabled).toBe(true)
    expect(w.management.listParsedDocuments).not.toHaveBeenCalled()
  })

  it('disables open for a broken row and shows its reason', async () => {
    world({
      list: listOf([
        {
          ...row,
          title: undefined,
          state: 'broken',
          actionable: false,
          broken: { code: 'unreadable-meta', detail: 'bad meta' },
        },
      ]),
    })
    expect(await screen.findByText('bad meta')).toBeDefined()
    expect(
      within(listRegion()).getByText(en.parsedManagerStateBroken).getAttribute('data-tone'),
    ).toBe('danger')
    const open = screen.getByRole('button', { name: en.parsedManagerOpen }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(screen.getByRole('button', { name: en.libraryParsedReparse })).toBeDefined()
  })

  it('offers show more only while the listing holds another page', async () => {
    world({ list: listOf([row, secondRow], 2) })
    await screen.findByText(TITLE)
    expect(screen.queryByRole('button', { name: en.parsedManagerShowMore })).toBeNull()
  })

  it('grows the window with show more instead of paging', async () => {
    const w = world({ lists: [listOf([row], 120), listOf([secondRow], 120)] })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerShowMore }))
    expect(await screen.findByText(SECOND_TITLE)).toBeDefined()
    expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
      { sessionId: SESSION, offset: 1, limit: 50 },
      expect.any(AbortSignal),
    )
  })

  it('withdraws to the unavailable state and stops requesting', () => {
    const w = world({ mounted: false })
    expect(screen.getByText(en.parsedManagerUnavailable)).toBeDefined()
    expect(w.management.listParsedDocuments).not.toHaveBeenCalled()
  })

  it('offers the URL parse entry and a refresh control', async () => {
    const w = world()
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.libraryParseUrl }))
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerRefresh }))
    await vi.waitFor(() => expect(w.management.listParsedDocuments).toHaveBeenCalledTimes(2))
  })

  it('clears the search text from its own control', async () => {
    const w = world()
    await screen.findByText(TITLE)
    fireEvent.change(screen.getByPlaceholderText(en.parsedManagerSearchPlaceholder), {
      target: { value: 'attention' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerClearSearch }))
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50 },
        expect.any(AbortSignal),
      ),
    )
  })

  it('surfaces a discard refusal instead of refreshing open tabs', async () => {
    const w = world({ discard: { ok: false, error: new Error('locked') } })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    expect(
      await screen.findByText(en.parsedManagerError.replace('{message}', 'locked')),
    ).toBeDefined()
    expect(w.discarded).not.toHaveBeenCalled()
  })

  it('opens a URL-sourced row by its title', async () => {
    const w = world({
      list: listOf([{ ...row, sourceKind: 'url', targetLabel: 'https://papers.example.org/…' }]),
    })
    expect(await screen.findByText(/https:\/\/papers\.example\.org\/…/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerOpen }))
    expect(w.openParsed).toHaveBeenCalledWith(SESSION, ID, TITLE)
    expect(screen.getByRole('button', { name: en.libraryParsedReparse })).toBeDefined()
  })

  it('opens the reparse dialog for a row', async () => {
    world()
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.libraryParsedReparse }))
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('validates and labels an opaque artifact target', () => {
    const target = { kind: 'artifact' as const, artifactId: ID }
    expect(validDocumentParseTarget(target)).toBe(true)
    expect(validDocumentParseTarget({ ...target, artifactId: 'nope' })).toBe(false)
    expect(documentParseLabel(target, 'A paper')).toBe('A paper')
    expect(documentParseLabel({ kind: 'url', url: 'https://papers.example.org/a.pdf?x=1' })).toBe(
      'https://papers.example.org/…',
    )
  })

  it('renders the manager tab title', () => {
    render(
      <ParsedManagerTitle
        {...({
          t: makeTranslate(en),
          useTabInfo: () => ({
            tab: { navigation: { address: parsedManagerTabAddress({ sessionId: SESSION }) } },
          }),
        } as unknown as ComponentProps<typeof ParsedManagerTitle>)}
      />,
    )
    expect(screen.getByText(en.tabParsedManager)).toBeDefined()
  })
})
