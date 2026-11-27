// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderNote } from '../../../src/client/reader/ReaderNote.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const noteRef = 'zotero://group/42/item/NOTE0001?server=reader-instance'
const imageRef = 'zotero://group/42/attachment/PNG00001?server=reader-instance'

function noteWithImages(readImage: NonNullable<Parameters<typeof ReaderNote>[0]['readImage']>) {
  const createObjectURL = vi.fn().mockReturnValue('blob:reader-fixture')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
  const controller = new AbortController()
  const read = vi.fn().mockResolvedValue({
    ref: noteRef,
    title: 'Research note',
    text: 'Caption',
    html: `<p><img alt="Figure" src="https://example.com/irrelevant.png"
      data-attachment-key="PNG00001" onerror="alert(1)">
      <img alt="External" src="https://example.com/external.png">
      <img data-attachment-key="../wrong" alt="Invalid"></p>`,
  })
  const view = render(
    <ReaderNote
      t={makeTranslate(readerEn)}
      refString={noteRef}
      sessionId="reader-session"
      tabSignal={controller.signal}
      read={read}
      readImage={readImage}
      onDeleted={vi.fn()}
    />,
  )
  return { controller, view, createObjectURL, revokeObjectURL }
}

it('uses a qualified local image only on request and revokes its URL when the note closes', async () => {
  const blob = new Blob(['example'], { type: 'image/png' })
  const readImage = vi.fn().mockResolvedValue(blob)
  const note = noteWithImages(readImage)
  const show = await screen.findByRole('button', { name: 'Show note image · Figure' })
  expect(screen.getByText(`External · ${readerEn.noteImage}`)).toBeTruthy()
  expect(screen.getByText(`Invalid · ${readerEn.noteImage}`)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
  expect(readImage).not.toHaveBeenCalled()
  fireEvent.click(show)
  const shown = await screen.findByRole('img', { name: 'Figure' })
  expect(readImage).toHaveBeenCalledExactlyOnceWith(
    'reader-session',
    noteRef,
    imageRef,
    expect.any(AbortSignal),
  )
  expect(shown.getAttribute('src')).toBe('blob:reader-fixture')
  expect(shown.getAttribute('onerror')).toBeNull()
  expect(note.createObjectURL).toHaveBeenCalledExactlyOnceWith(blob)
  note.view.unmount()
  expect(note.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:reader-fixture')
})

it('cancels a requested local image when the tab closes during the read', async () => {
  const pending = deferred<Blob>()
  const readImage = vi.fn(() => pending.promise)
  const note = noteWithImages(readImage)
  fireEvent.click(await screen.findByRole('button', { name: 'Show note image · Figure' }))
  const [, , , signal]: unknown[] = readImage.mock.lastCall ?? []
  note.controller.abort()
  expect(signal).toHaveProperty('aborted', true)
  await act(async () => pending.resolve(new Blob(['late'], { type: 'image/png' })))
  expect(note.createObjectURL).not.toHaveBeenCalled()
  expect(screen.queryByRole('img')).toBeNull()
})

it('discards an undecodable local image and waits for an explicit retry', async () => {
  const invalid = new Blob(['invalid PNG'], { type: 'image/png' })
  const replacement = new Blob(['replacement PNG'], { type: 'image/png' })
  const readImage = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(replacement)
  const note = noteWithImages(readImage)
  note.createObjectURL.mockReturnValueOnce('blob:invalid').mockReturnValueOnce('blob:replacement')
  const request = { name: 'Show note image · Figure' }

  fireEvent.click(await screen.findByRole('button', request))
  const broken = await screen.findByRole('img', { name: 'Figure' })
  expect(broken.getAttribute('src')).toBe('blob:invalid')
  fireEvent.error(broken)
  expect(screen.queryByRole('img', { name: 'Figure' })).toBeNull()
  expect(screen.getByRole('status').textContent).toBe(readerEn.noteImage)
  expect(note.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:invalid')
  expect(readImage).toHaveBeenCalledOnce()

  fireEvent.click(screen.getByRole('button', request))
  expect((await screen.findByRole('img', { name: 'Figure' })).getAttribute('src')).toBe(
    'blob:replacement',
  )
  expect(note.createObjectURL.mock.calls).toEqual([[invalid], [replacement]])
  note.view.unmount()
  expect(note.revokeObjectURL.mock.calls).toEqual([['blob:invalid'], ['blob:replacement']])
})

it('closes an edit or delete mutation and restores focus to the initiating button', async () => {
  const controller = new AbortController()
  const read = vi.fn().mockResolvedValue({
    ref: noteRef,
    title: 'Research note',
    text: 'Editable note text',
    version: 4,
    editableRuns: [{ offset: 0, text: 'Editable note text' }],
  })
  const write = vi.fn().mockResolvedValue({ kind: 'applied', message: 'Saved' })
  render(
    <ReaderNote
      t={makeTranslate(readerEn)}
      refString={noteRef}
      sessionId="reader-session"
      tabSignal={controller.signal}
      read={read}
      write={write}
      onDeleted={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: readerEn.noteEdit }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.cancel }))
  await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: readerEn.noteEdit }))

  fireEvent.click(screen.getByRole('button', { name: readerEn.annotationDeleteConfirm }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.cancel }))
  await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)))
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: readerEn.annotationDeleteConfirm }),
  )
})
