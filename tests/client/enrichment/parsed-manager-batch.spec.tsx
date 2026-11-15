// @vitest-environment jsdom
/** Narrowing, selection and bulk discard: the window is the unit of work. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../../src/client/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import {
  DISCARDED,
  SECOND_ID,
  SECOND_TITLE,
  SESSION,
  TITLE,
  listOf,
  row,
  secondRow,
  world,
  type DiscardResult,
  type ListResult,
} from './support/parsed-manager-world.tsx'

const selectRow = (title: string) =>
  screen.getByRole('checkbox', { name: en.parsedManagerSelectRow.replace('{title}', title) })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('parsed document manager narrowing', () => {
  it('presents the four state pills as one labelled, single-active group', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    const group = screen.getByRole('group', { name: en.parsedManagerFilterLabel })
    const pills = within(group).getAllByRole('button')
    expect(pills.map((pill) => pill.textContent)).toEqual([
      en.parsedManagerFilterAll,
      en.parsedManagerFilterIndexed,
      en.parsedManagerFilterOrphan,
      en.parsedManagerFilterBroken,
    ])
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    fireEvent.click(pills[3]!)
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ])
  })

  it('narrows by state and starts the window over', async () => {
    const w = world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerFilterBroken }))
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50, state: 'broken' },
        expect.any(AbortSignal),
      ),
    )
  })

  it('narrows by text after the host search cadence', async () => {
    const w = world()
    await screen.findByText(TITLE)
    fireEvent.change(screen.getByPlaceholderText(en.parsedManagerSearchPlaceholder), {
      target: { value: 'attention' },
    })
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50, query: 'attention' },
        expect.any(AbortSignal),
      ),
    )
  })

  it('tells an empty filter apart from an empty library', async () => {
    world({ list: listOf([]) })
    await screen.findByText(en.parsedManagerEmpty)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerFilterOrphan }))
    expect(await screen.findByText(en.parsedManagerEmptyFiltered)).toBeDefined()
    expect(screen.queryByText(en.parsedManagerEmptyHint)).toBeNull()
  })
})

describe('parsed document manager selection', () => {
  it('selects every loaded row and discards one request per row', async () => {
    const w = world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerSelectAll }))
    expect(await screen.findByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerDeleteSelected }))
    expect(
      await screen.findByText(en.parsedManagerBatchDeleteTitle.replace('{count}', '2')),
    ).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() => expect(w.management.discardParsedDocument).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(w.discarded).toHaveBeenCalledTimes(2))
    expect(w.management.discardParsedDocument).toHaveBeenNthCalledWith(
      1,
      { sessionId: SESSION, artifactId: row.artifactId },
      expect.any(AbortSignal),
    )
    expect(w.management.discardParsedDocument).toHaveBeenNthCalledWith(
      2,
      { sessionId: SESSION, artifactId: SECOND_ID },
      expect.any(AbortSignal),
    )
    expect(
      await screen.findByText(en.parsedManagerBatchDeleted.replace('{count}', '2')),
    ).toBeDefined()
  })

  it('keeps a failed row selected and reports the partial batch', async () => {
    const w = world({
      lists: [listOf([row, secondRow], 2), listOf([secondRow], 1)],
      discards: [DISCARDED, { ok: false, error: new Error('locked') }],
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerSelectAll }))
    fireEvent.click(await screen.findByRole('button', { name: en.parsedManagerDeleteSelected }))
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    expect(
      await screen.findByText(
        en.parsedManagerBatchPartial.replace('{removed}', '1').replace('{failed}', '1'),
      ),
    ).toBeDefined()
    // The survivor is the only row left, and it stays selected for a retry.
    expect((selectRow(SECOND_TITLE) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(w.discarded).toHaveBeenCalledTimes(1)
  })

  it('clears the selection when the narrowing changes', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerSelectAll }))
    expect(await screen.findByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerFilterIndexed }))
    await vi.waitFor(() =>
      expect(screen.queryByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeNull(),
    )
  })

  it('toggles one row without selecting all', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    const box = selectRow(TITLE) as HTMLInputElement
    fireEvent.click(box)
    expect(box.checked).toBe(true)
    expect(screen.getByRole('button', { name: en.parsedManagerSelectAll })).toBeDefined()
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })

  it('clears a selection with the clear control', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerSelectAll }))
    await screen.findByText(en.parsedManagerSelected.replace('{count}', '2'))
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerClearSelection }))
    expect(screen.queryByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeNull()
  })

  it('toggles the select-all control between selecting and deselecting', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerSelectAll }))
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerDeselectAll }))
    expect(screen.queryByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeNull()
  })

  it('re-reads the window it showed after a discard', async () => {
    const w = world({
      lists: [listOf([row], 2), listOf([secondRow], 2), listOf([row], 1)],
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerShowMore }))
    await screen.findByText(SECOND_TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[1]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    // The window is re-read in one request at its previous size, so the reader
    // is never stranded on a page that no longer holds anything.
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50 },
        expect.any(AbortSignal),
      ),
    )
  })

  it('keeps one show-more request in flight at a time', async () => {
    const w = world({
      listImpl: async (request) =>
        request.offset === 0 ? listOf([row], 100) : listOf([secondRow], 100),
    })
    await screen.findByText(TITLE)
    const more = screen.getByRole('button', { name: en.parsedManagerShowMore })
    fireEvent.click(more)
    fireEvent.click(more)
    await vi.waitFor(() => expect(w.management.listParsedDocuments).toHaveBeenCalledTimes(2))
  })

  it('reports a failed show more', async () => {
    world({
      listImpl: async (request) => {
        if (request.offset === 0) return listOf([row], 100)
        throw new Error('more broke')
      },
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerShowMore }))
    expect(
      await screen.findByText(en.parsedManagerError.replace('{message}', 'more broke')),
    ).toBeDefined()
  })

  it('drops a page that settles after the tab is gone', async () => {
    const pending = deferred<ListResult>()
    const w = world({
      listImpl: async (request) =>
        request.offset === 0 ? listOf([row], 100) : await pending.promise,
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerShowMore }))
    w.unmount()
    pending.resolve(listOf([secondRow], 100))
    await vi.waitFor(() => expect(screen.queryByText(SECOND_TITLE)).toBeNull())
  })

  it('closes the dialog with Escape', async () => {
    world()
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ignores a page that settles after the tab is gone', async () => {
    const pending = deferred<ListResult>()
    const w = world({ pendingList: async () => await pending.promise })
    w.unmount()
    pending.resolve(listOf([row]))
    await vi.waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())
  })

  it('drops an abandoned rejection instead of reporting it', async () => {
    const release = deferred<DiscardResult>()
    const w = world({ discardImpl: async () => await release.promise })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() => expect(w.management.discardParsedDocument).toHaveBeenCalled())
    w.unmount()
    release.reject(new Error('locked'))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
