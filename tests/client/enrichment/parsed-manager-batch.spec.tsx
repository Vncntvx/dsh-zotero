// @vitest-environment jsdom
/** Narrowing, selection and bulk discard: the window is the unit of work. */
import { cleanup, fireEvent, screen } from '@testing-library/react'
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
  waitForIdle,
  world,
  type DiscardResult,
  type ListResult,
} from './support/parsed-manager-world.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('parsed document manager narrowing', () => {
  it('narrows by state and starts the window over', async () => {
    const w = world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('tab', { name: en.parsedManagerStateBroken }))
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50, state: 'broken' },
        expect.any(AbortSignal),
      ),
    )
  })

  it('narrows by text after the library search cadence', async () => {
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
    fireEvent.click(screen.getByRole('tab', { name: en.parsedManagerStateOrphan }))
    expect(await screen.findByText(en.parsedManagerEmptyFiltered)).toBeDefined()
    expect(screen.queryByText(en.parsedManagerEmptyHint)).toBeNull()
  })
})

describe('parsed document manager selection', () => {
  it('selects the whole page and discards one request per row', async () => {
    const w = world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('checkbox', { name: en.parsedManagerSelectPage }))
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
      list: listOf([row, secondRow]),
      discards: [DISCARDED, { ok: false, error: new Error('locked') }],
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('checkbox', { name: en.parsedManagerSelectPage }))
    fireEvent.click(await screen.findByRole('button', { name: en.parsedManagerDeleteSelected }))
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    expect(
      await screen.findByText(
        en.parsedManagerBatchPartial.replace('{removed}', '1').replace('{failed}', '1'),
      ),
    ).toBeDefined()
    expect((screen.getByRole('checkbox', { name: SECOND_TITLE }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('checkbox', { name: TITLE }) as HTMLInputElement).checked).toBe(false)
    expect(w.discarded).toHaveBeenCalledTimes(1)
  })

  it('clears the selection when the window moves', async () => {
    world({ list: listOf([row, secondRow], 120) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('checkbox', { name: en.parsedManagerSelectPage }))
    expect(await screen.findByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.libraryPageNext }))
    expect(await screen.findByText(en.parsedManagerTotal.replace('{count}', '120'))).toBeDefined()
    expect(screen.queryByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeNull()
  })

  it('steps back a page when the discard empties the window', async () => {
    const w = world({ list: listOf([row], 51) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.libraryPageNext }))
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 50, limit: 50 },
        expect.any(AbortSignal),
      ),
    )
    // The request records before it settles; the controls unlock on the answer.
    await waitForIdle()
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50 },
        expect.any(AbortSignal),
      ),
    )
  })

  it('toggles one row without selecting the page', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    const box = screen.getByRole('checkbox', { name: TITLE }) as HTMLInputElement
    fireEvent.click(box)
    expect(box.checked).toBe(true)
    expect(
      (screen.getByRole('checkbox', { name: en.parsedManagerSelectPage }) as HTMLInputElement)
        .checked,
    ).toBe(false)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })

  it('clears a selection with the clear control', async () => {
    world({ list: listOf([row, secondRow]) })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('checkbox', { name: en.parsedManagerSelectPage }))
    await screen.findByText(en.parsedManagerSelected.replace('{count}', '2'))
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerClearSelection }))
    expect(screen.queryByText(en.parsedManagerSelected.replace('{count}', '2'))).toBeNull()
  })

  it('steps back when the page shrinks under the window', async () => {
    // A concurrent removal answers the second page with one row in total.
    const w = world({ lists: [listOf([row, secondRow], 120), listOf([row], 1)] })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: en.libraryPageNext }))
    await vi.waitFor(() =>
      expect(w.management.listParsedDocuments).toHaveBeenLastCalledWith(
        { sessionId: SESSION, offset: 0, limit: 50 },
        expect.any(AbortSignal),
      ),
    )
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
