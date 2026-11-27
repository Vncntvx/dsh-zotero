// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderDetails } from '../../../src/client/reader/ReaderDetails.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { en } from '../../../src/client/locales.ts'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

import { current, details, mount, translated } from './support/reader-details.tsx'

afterEach(cleanup)

it('shows the bibliographic details and keeps previously loaded attachments during pagination', async () => {
  const read = vi.fn<Parameters<typeof ReaderDetails>[0]['details']>()
  read.mockResolvedValueOnce(details).mockResolvedValueOnce({
    ...details,
    attachments: { offset: 1, limit: 1, total: 2, returned: 1, items: [translated] },
  })
  mount({ details: read })
  const panel = within(screen.getByRole('complementary', { name: readerEn.details }))
  expect(await panel.findByText(details.abstract)).toBeTruthy()
  expect(panel.getByText('Ada Ng')).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: readerEn.more }))
  await panel.findByRole('button', { name: translated.title })
  expect(panel.getByText(current.title).getAttribute('aria-current')).toBe('true')
  expect(read.mock.calls.map(([request]) => request.offset)).toEqual([0, 1])
})

it('quotes the Zotero item abstract with its ref and reported truncation', async () => {
  const inputActions = { insertQuote: vi.fn().mockReturnValue(true), persistDraft: vi.fn() }
  mount({
    inputActions,
    details: vi.fn().mockResolvedValue({ ...details, abstractTruncated: true }),
  })
  fireEvent.click(await screen.findByRole('button', { name: readerEn.quoteAbstract }))
  const body = `${details.abstract}\n\n${readerEn.abstractQuoteTruncated}`
  expect(inputActions.insertQuote).toHaveBeenCalledExactlyOnceWith(
    `Zotero item ${details.ref} · abstract\n\n${body}`,
    { label: readerEn.detailsAbstract, title: details.title, body },
  )
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
  expect(screen.getByText(readerEn.abstractQuoteAdded)).toBeTruthy()
})

it('reports a details read failure and retries the same request', async () => {
  const read = vi
    .fn<Parameters<typeof ReaderDetails>[0]['details']>()
    .mockRejectedValueOnce(new Error('details unavailable'))
    .mockResolvedValueOnce(details)
  mount({ details: read })

  expect((await screen.findByRole('alert')).textContent).toContain('details unavailable')
  fireEvent.click(screen.getByRole('button', { name: readerEn.retry }))
  expect(await screen.findByText(details.abstract)).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(2)
})

it('keeps a prepared abstract citation visible when Composer refuses it', async () => {
  const inputActions = { insertQuote: vi.fn().mockReturnValue(false), persistDraft: vi.fn() }
  mount({ inputActions })

  fireEvent.click(await screen.findByRole('button', { name: readerEn.quoteAbstract }))
  expect(screen.getByText(readerEn.quoteInsertFailed)).toBeTruthy()
  expect(inputActions.persistDraft).not.toHaveBeenCalled()
})

it('copies the parent item citation through the Library export permission', async () => {
  const citation = { ref: details.ref, text: '(Ng, 2026)' }
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
  try {
    const read = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { format: 'citation', citations: [citation] } })
    const { rerender, ...props } = mount({
      citationCopy: { read, translate: makeTranslate(en) },
      canExport: true,
    })
    fireEvent.click(await screen.findByRole('button', { name: en.libraryCopyCitation }))
    await screen.findByRole('button', { name: en.libraryCopyCitationDone })
    const signal = read.mock.calls[0]?.[1] as AbortSignal
    expect(read).toHaveBeenCalledExactlyOnceWith(
      { refs: [details.ref], format: 'citation' },
      signal,
    )
    expect(writeText).toHaveBeenCalledExactlyOnceWith(citation.text)
    rerender(<ReaderDetails {...props} canExport={false} />)
    expect(signal.aborted).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.libraryCopyCitation }).disabled,
    ).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('quotes selected note excerpts across pages and reports a shortened source', async () => {
  const items = [
    { ref: itemRef(NOTE_KEY), text: 'First note', truncated: true },
    { ref: itemRef('NOTE0002'), text: 'Second note', truncated: false },
  ]
  const inputActions = {
    insertQuote: vi.fn<
      NonNullable<Parameters<typeof ReaderDetails>[0]['inputActions']>['insertQuote']
    >(() => true),
    persistDraft: vi.fn(),
  }
  const read = vi.fn<Parameters<typeof ReaderDetails>[0]['details']>()
  read
    .mockResolvedValueOnce({
      ...details,
      notes: { items: [items[0]!], offset: 0, limit: 1, total: 2, returned: 1, nextOffset: 1 },
    })
    .mockResolvedValueOnce({
      ...details,
      notes: { items: [items[1]!], offset: 1, limit: 1, total: 2, returned: 1 },
    })
  mount({ inputActions, details: read })
  fireEvent.click(await screen.findByText(readerEn.quoteNoteBatch))
  fireEvent.click(screen.getByRole('checkbox', { name: items[0]!.text }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.moreNotes }))
  fireEvent.click(await screen.findByRole('checkbox', { name: items[1]!.text }))
  expect(screen.getByText(current.title).getAttribute('aria-current')).toBe('true')
  expect(screen.queryByRole('button', { name: readerEn.moreNotes })).toBeNull()
  expect(read.mock.calls.map(([request]) => request.notesOffset)).toEqual([undefined, 1])
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteAddDraft }))
  const [draft, quote] = inputActions.insertQuote.mock.calls[0]!
  expect(quote?.body).toContain(readerEn.quoteBatchTruncated)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject([
    { sourceType: 'note', itemRef: details.ref, noteRef: items[0]!.ref, excerptTruncated: true },
    { sourceType: 'note', itemRef: details.ref, noteRef: items[1]!.ref },
  ])
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
})

it('refreshes the note list from the start after deleting a later-page note', async () => {
  const first = { ref: itemRef(NOTE_KEY), text: 'First note', truncated: false }
  const later = { ref: itemRef('NOTE0002'), text: 'Later note', truncated: false }
  const initial = {
    ...details,
    noteWriteEnabled: true,
    notes: { items: [first], offset: 0, limit: 1, total: 2, returned: 1, nextOffset: 1 },
  }
  const read = vi.fn<Parameters<typeof ReaderDetails>[0]['details']>()
  read
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({
      ...initial,
      notes: { items: [later], offset: 1, limit: 1, total: 2, returned: 1 },
    })
    .mockResolvedValueOnce({
      ...initial,
      notes: { items: [first], offset: 0, limit: 1, total: 1, returned: 1 },
    })
  const readNote = vi.fn().mockResolvedValue({ ...later, title: later.text, version: 9 })
  const writeNote = vi.fn().mockResolvedValue({ kind: 'applied', message: 'Deleted in Zotero' })
  mount({ details: read, readNote, writeNote })

  fireEvent.click(await screen.findByRole('button', { name: readerEn.moreNotes }))
  fireEvent.click(
    await screen.findByRole('button', { name: readerEn.noteOpen, description: later.text }),
  )
  fireEvent.click(await screen.findByRole('button', { name: readerEn.annotationDeleteConfirm }))
  expect(writeNote).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('form', { name: readerEn.noteDelete })
  fireEvent.click(
    within(confirmation).getByRole('button', { name: readerEn.annotationDeleteConfirm }),
  )

  await screen.findByText('Deleted in Zotero')
  expect(writeNote).toHaveBeenCalledExactlyOnceWith(
    { operation: 'delete', ref: later.ref, sessionId: 'reader-session', expectedVersion: 9 },
    expect.any(AbortSignal),
  )
  expect(read.mock.calls.map(([request]) => request.notesOffset)).toEqual([undefined, 1, undefined])
  expect(await screen.findByText(first.text)).toBeTruthy()
  expect(screen.queryByText(later.text)).toBeNull()
})

it('switches only after the new PDF resolves', async () => {
  const result = deferred<{ path: string; ref: string }>()
  const read = vi.fn<Parameters<typeof ReaderDetails>[0]['details']>().mockResolvedValue({
    ...details,
    attachments: { offset: 0, limit: 2, total: 2, returned: 2, items: [current, translated] },
  })
  const { onSwitch, resolve } = mount({ details: read, resolve: vi.fn(() => result.promise) })
  const button = await screen.findByRole('button', { name: translated.title })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(resolve).toHaveBeenCalledTimes(1)
  expect(resolve).toHaveBeenCalledWith(translated.ref, expect.any(AbortSignal))
  expect(onSwitch).not.toHaveBeenCalled()
  await act(async () => result.resolve({ path: 'fixtures/translated.pdf', ref: translated.ref }))
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith(translated)
})

it('opens a translation annotation only in its owning attachment', async () => {
  const position = { pageIndex: 2, rects: [{ x: 10, y: 60, width: 85, height: 14 }] }
  const readAnnotations = vi.fn().mockResolvedValue({
    offset: 0,
    limit: 20,
    total: 2,
    returned: 2,
    writeEnabled: false,
    items: [
      { ref: 'other', parentRef: current.ref, type: 'highlight', text: 'Different copy', position },
      {
        ref: 'translation',
        parentRef: translated.ref,
        type: 'underline',
        text: 'Translated excerpt',
        position,
      },
    ],
  })
  const { onSwitch, resolve } = mount({
    details: vi.fn().mockResolvedValue({
      ...details,
      attachments: { offset: 0, limit: 2, total: 2, returned: 2, items: [current, translated] },
    }),
    readAnnotations,
    resolve: vi.fn().mockResolvedValue({ ref: translated.ref, path: 'fixtures/translated.pdf' }),
  })
  const toggle = await screen.findByRole('button', { name: 'Zotero annotations in Translation' })
  expect(readAnnotations).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  const excerpt = await screen.findByRole('button', { name: 'Translated excerpt' })
  expect(screen.queryByRole('button', { name: 'Different copy' })).toBeNull()
  expect(readAnnotations).toHaveBeenCalledExactlyOnceWith(
    { sessionId: 'reader-session', ref: translated.ref, offset: 0, limit: expect.any(Number) },
    expect.any(AbortSignal),
  )
  fireEvent.click(excerpt)
  await act(async () => {})

  expect(resolve).toHaveBeenCalledExactlyOnceWith(translated.ref, expect.any(AbortSignal))
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith(translated, position)
})

it('shows unlocated sibling annotations, empty pages, and retries a failed page', async () => {
  const readAnnotations = vi
    .fn<NonNullable<Parameters<typeof ReaderDetails>[0]['readAnnotations']>>()
    .mockRejectedValueOnce(new Error('annotation page unavailable'))
    .mockResolvedValueOnce({
      offset: 0,
      limit: 20,
      total: 2,
      returned: 2,
      writeEnabled: false,
      nextOffset: 20,
      items: [
        { ref: 'unlocated', parentRef: 'other', type: 'highlight', text: 'Other copy' },
        {
          ref: 'located',
          parentRef: translated.ref,
          type: 'underline',
          text: '',
          comment: 'A comment',
        },
      ],
    })
    .mockResolvedValueOnce({
      offset: 20,
      limit: 20,
      total: 2,
      returned: 0,
      writeEnabled: false,
      items: [],
    })
  mount({
    details: vi.fn().mockResolvedValue({
      ...details,
      attachments: { offset: 0, limit: 2, total: 2, returned: 2, items: [current, translated] },
    }),
    readAnnotations,
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Zotero annotations in Translation' }))
  expect((await screen.findByRole('alert')).textContent).toContain(readerEn.annotationFailed)
  fireEvent.click(screen.getByRole('button', { name: readerEn.retry }))
  expect((await screen.findByText(/Other copy/)).textContent).toContain(
    readerEn.annotationUnlocated,
  )
  expect(screen.getByText(/A comment/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: readerEn.more }))
  expect(await screen.findByText(readerEn.annotationEmpty)).toBeTruthy()
})

it('looks up only the publication name on request and hides metrics after permission is revoked', async () => {
  const publicationTitle = 'Journal of Reader Research'
  const read = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      status: 'ready',
      fetchedAt: 1,
      official: [
        { field: 'sci', value: 'Q1' },
        { field: 'jci', value: '1.23' },
      ],
      custom: [],
    },
  })
  let enabled = false
  let update: (() => void) | undefined
  const snapshot = () => ({
    preferences: { ...LIBRARY_DEFAULTS, journalMetricsEnabled: enabled },
  })
  let current = snapshot()
  mount({
    details: vi.fn().mockResolvedValue({ ...details, publicationTitle }),
    journalMetrics: {
      preferences: {
        getSnapshot: () => current,
        subscribe(listener) {
          update = listener
          return () => {
            update = undefined
          }
        },
      },
      read,
      translate: makeTranslate(en),
    },
  })
  await screen.findByText(details.abstract)
  expect(screen.queryByRole('button', { name: readerEn.detailsLoadMetrics })).toBeNull()
  enabled = true
  current = snapshot()
  act(() => update?.())

  const button = screen.getByRole('button', { name: readerEn.detailsLoadMetrics })
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(button)
  await screen.findByText('Q1')
  expect(screen.queryByText('1.23')).toBeNull()
  expect(read).toHaveBeenCalledExactlyOnceWith(
    { publicationName: publicationTitle, priority: 'detail' },
    expect.any(AbortSignal),
  )

  enabled = false
  current = snapshot()
  act(() => update?.())
  expect(screen.queryByText('Q1')).toBeNull()
  expect(read.mock.calls[0]?.[1].aborted).toBe(true)
})
