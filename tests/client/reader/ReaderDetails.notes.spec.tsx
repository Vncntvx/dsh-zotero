// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { details, mount } from './support/reader-details.tsx'

afterEach(cleanup)

it('opens a note in place, renders inert rich text, and quotes a bounded excerpt', async () => {
  const ref = itemRef(NOTE_KEY)
  const body = 'Analysis and citation'
  const html = [
    '<h2>Analysis</h2><p><strong>Conclusion</strong> <a href="https://fixture.invalid/link" onclick="alert(1)">Reference</a></p>',
    '<table><tbody><tr><td colspan="2">Result</td></tr></tbody></table>',
    '<script>alert(1)</script><iframe src="https://fixture.invalid/frame"></iframe><img src="https://fixture.invalid/image" alt="Figure 1">',
  ].join('')
  const read = vi
    .fn()
    .mockResolvedValue({ ref, html, text: body, title: 'Study note', truncated: false })
  const detailsRead = vi.fn().mockResolvedValue({
    ...details,
    notes: {
      offset: 0,
      limit: 1,
      returned: 1,
      total: 1,
      items: [{ ref, text: 'Open study note', truncated: false }],
    },
  })
  const input = { insertQuote: vi.fn().mockReturnValue(true), persistDraft: vi.fn() }
  mount({ details: detailsRead, readNote: read, inputActions: input })
  fireEvent.click(
    await screen.findByRole('button', { name: readerEn.noteOpen, description: 'Open study note' }),
  )

  const article = await screen.findByRole('article', { name: 'Study note' })
  expect(read).toHaveBeenCalledExactlyOnceWith(
    { ref, sessionId: 'reader-session' },
    expect.any(AbortSignal),
  )
  expect(within(article).getByRole('heading', { name: 'Analysis' })).toBeTruthy()
  expect(within(article).getByRole('cell', { name: 'Result' }).getAttribute('colspan')).toBe('2')
  expect(within(article).getByText('Reference').hasAttribute('href')).toBe(false)
  expect(within(article).getByText(`Figure 1 · ${readerEn.noteImage}`)).toBeTruthy()
  expect(article.querySelector('script, iframe, img, [onclick]')).toBeNull()

  fireEvent.click(within(article).getByRole('button', { name: readerEn.quote }))
  expect(input.insertQuote).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining(ref),
    expect.objectContaining({ body, title: 'Study note' }),
  )
  expect(input.persistDraft).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteBack }))
  expect(screen.getByRole('heading', { name: details.title })).toBeTruthy()
})

it('retries a failed note read and keeps the note available for a refused quote', async () => {
  const ref = itemRef(NOTE_KEY)
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('note temporarily unavailable'))
    .mockResolvedValueOnce({ ref, title: 'Retry note', text: 'Readable text', truncated: false })
  const input = { insertQuote: vi.fn().mockReturnValue(false), persistDraft: vi.fn() }
  const detailsRead = vi.fn().mockResolvedValue({
    ...details,
    notes: {
      offset: 0,
      limit: 1,
      returned: 1,
      total: 1,
      items: [{ ref, text: 'Retry note', truncated: false }],
    },
  })
  mount({ details: detailsRead, readNote: read, inputActions: input })
  fireEvent.click(
    await screen.findByRole('button', { name: readerEn.noteOpen, description: 'Retry note' }),
  )

  expect((await screen.findByRole('alert')).textContent).toContain(readerEn.noteFailed)
  fireEvent.click(screen.getByRole('button', { name: readerEn.retry }))
  const article = await screen.findByRole('article', { name: 'Retry note' })
  fireEvent.click(within(article).getByRole('button', { name: readerEn.quote }))
  expect(screen.getByText(readerEn.noteQuoteFailed)).toBeTruthy()
  expect(input.persistDraft).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledTimes(2)
})

it('submits only changed text against the displayed note version and preserves the draft on conflict', async () => {
  const ref = itemRef(NOTE_KEY)
  const readNote = vi.fn().mockResolvedValue({
    ref,
    version: 4,
    title: 'Research note',
    text: 'Original text',
    truncated: false,
    editableRuns: [
      { offset: 3, text: 'Original text' },
      { offset: 30, text: 'Other text' },
    ],
  })
  const writeNote = vi.fn().mockResolvedValue({
    kind: 'failed',
    code: 'ZOTERO_WRITE_CONFLICT',
    message: 'The note changed in Zotero.',
  })
  mount({
    readNote,
    writeNote,
    details: vi.fn().mockResolvedValue({
      ...details,
      noteWriteEnabled: true,
      notes: {
        offset: 0,
        limit: 1,
        returned: 1,
        total: 1,
        items: [{ ref, text: 'Open note', truncated: false }],
      },
    }),
  })
  fireEvent.click(
    await screen.findByRole('button', { name: readerEn.noteOpen, description: 'Open note' }),
  )
  fireEvent.click(await screen.findByRole('button', { name: readerEn.noteEdit }))
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  fireEvent.change(input, { target: { value: 'My draft' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))

  expect((await screen.findByRole('alert')).textContent).toBe('The note changed in Zotero.')
  expect(input.value).toBe('My draft')
  expect(writeNote).toHaveBeenCalledExactlyOnceWith(
    {
      sessionId: 'reader-session',
      operation: 'edit',
      ref,
      expectedVersion: 4,
      edits: [{ offset: 3, text: 'My draft' }],
    },
    expect.any(AbortSignal),
  )
  expect(screen.getByRole<HTMLButtonElement>('button', { name: readerEn.noteSave }).disabled).toBe(
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.refresh }))
  await screen.findByRole('article', { name: 'Research note' })
  expect(readNote).toHaveBeenCalledTimes(2)
})

it('creates a linked note from the details panel and refreshes the list after approval', async () => {
  const writeNote = vi.fn().mockResolvedValue({ kind: 'applied', message: 'Saved the new note' })
  const detailsRead = vi.fn().mockResolvedValue({ ...details, noteWriteEnabled: true })
  mount({ details: detailsRead, writeNote })
  fireEvent.click(await screen.findByRole('button', { name: readerEn.noteCreate }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
    target: { value: 'A **result**.' },
  })
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await screen.findByRole('heading', { name: details.title })
  expect(screen.getByText('Saved the new note')).toBeTruthy()
  expect(writeNote).toHaveBeenCalledExactlyOnceWith(
    {
      operation: 'create',
      ref: details.ref,
      sessionId: 'reader-session',
      markdown: 'A **result**.',
    },
    expect.any(AbortSignal),
  )
  expect(detailsRead).toHaveBeenCalledTimes(2)
})

it('requires an explicit confirmation before deleting a note, then refreshes the list', async () => {
  const ref = itemRef(NOTE_KEY)
  const note = { ref, title: 'Research note', text: 'Open note', version: 10, truncated: false }
  const detailsRead = vi.fn().mockResolvedValue({
    ...details,
    noteWriteEnabled: true,
    notes: { offset: 0, limit: 1, returned: 1, total: 1, items: [note] },
  })
  const readNote = vi.fn().mockResolvedValue(note)
  const writeNote = vi.fn().mockResolvedValue({ kind: 'applied', message: 'Deleted note' })
  mount({ details: detailsRead, readNote, writeNote })
  fireEvent.click(
    await screen.findByRole('button', { name: readerEn.noteOpen, description: note.text }),
  )
  fireEvent.click(await screen.findByRole('button', { name: readerEn.annotationDeleteConfirm }))
  const confirmation = screen.getByRole('form', { name: readerEn.noteDelete })
  expect(writeNote).not.toHaveBeenCalled()
  fireEvent.click(
    within(confirmation).getByRole('button', { name: readerEn.annotationDeleteConfirm }),
  )
  await screen.findByRole('heading', { name: details.title })
  expect(screen.getByText('Deleted note')).toBeTruthy()
  expect(writeNote).toHaveBeenCalledExactlyOnceWith(
    {
      operation: 'delete',
      sessionId: 'reader-session',
      ref,
      expectedVersion: 10,
    },
    expect.any(AbortSignal),
  )
  expect(detailsRead).toHaveBeenCalledTimes(2)
})
