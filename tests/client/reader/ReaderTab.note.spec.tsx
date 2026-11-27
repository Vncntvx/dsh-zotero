// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { readerZh } from '../../../src/client/reader/locales.ts'
import type { ZoteroReaderNoteView } from '../../../src/contract.ts'
import { itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { inputActionsStub } from '../helpers/zotero-client.ts'
import { propsOf, SESSION } from './support/reader-tab.ts'

const ref = `${itemRef(NOTE_KEY)}?server=reader-instance`
const note = {
  ref,
  title: 'Standalone Zotero note',
  html: '<p>Research <em>notes</em></p><img src="https://example.org/should-not-load">',
  text: 'Research notes',
  truncated: false,
}

afterEach(cleanup)

it('reads a standalone note through the note remote when PDF and write capabilities are absent', async () => {
  const readNote = vi.fn<ReaderTabFace['readNote']>().mockResolvedValue(note)
  const load = vi.fn<ReaderTabFace['load']>()
  const props = propsOf({ readNote, load }, readerAddress(SESSION, ref, 'note'))
  render(
    <ReaderTab
      {...props}
      useRemoteAccess={(method) => method === 'zotero/readerNote'}
      useAccess={() => false}
    />,
  )
  const article = await screen.findByRole('article', { name: note.title })
  expect(article.querySelector('em')?.textContent).toBe('notes')
  expect(article.querySelector('img')).toBeNull()
  expect(readNote).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, ref },
    expect.any(AbortSignal),
  )
  expect(load).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: readerZh.noteEdit })).toBeNull()
})

it('cancels a standalone read when note access is revoked', async () => {
  const pending = deferred<ZoteroReaderNoteView>()
  const readNote = vi.fn<ReaderTabFace['readNote']>().mockReturnValue(pending.promise)
  const props = propsOf({ readNote }, readerAddress(SESSION, ref, 'note'))
  const view = render(<ReaderTab {...props} />)
  const [, signal] = readNote.mock.calls[0]!
  view.rerender(
    <ReaderTab {...props} useRemoteAccess={(method) => method !== 'zotero/readerNote'} />,
  )
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(note))
  expect(screen.getByText(readerZh.unavailable)).toBeTruthy()
  expect(screen.queryByRole('article')).toBeNull()
})

it('opens the standalone note editor while the owning conversation is idle between turns', async () => {
  const writeNote = vi.fn<ReaderTabFace['writeNote']>()
  const props = propsOf(
    {
      readNote: vi.fn().mockResolvedValue({
        ...note,
        version: 2,
        editableRuns: [{ offset: 3, text: 'Research ' }],
      }),
      writeNote,
    },
    readerAddress(SESSION, ref, 'note'),
  )
  render(<ReaderTab {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: readerZh.noteEdit }))
  expect(screen.getByRole('form', { name: readerZh.noteEdit })).toBeTruthy()
  expect(writeNote).not.toHaveBeenCalled()
})

it('translates only selected note text and drafts a citation to the same note revision', async () => {
  const translate = vi.fn<ReaderTabFace['translate']>().mockResolvedValue('Notas')
  const inputActions = {
    ...inputActionsStub(),
    captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 0 })),
    addAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    insertQuote: vi.fn(() => true),
  }
  const props = propsOf(
    { readNote: vi.fn().mockResolvedValue({ ...note, version: 7 }), translate },
    readerAddress(SESSION, ref, 'note'),
  )
  render(<ReaderTab {...props} inputActions={inputActions} />)
  const article = await screen.findByRole('article', { name: note.title })
  const text = article.querySelector('em')!.firstChild!
  const range = document.createRange()
  range.selectNodeContents(text)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))

  const actions = within(screen.getByRole('group', { name: readerZh.documentSelection }))
  expect(actions.getByRole('button', { name: readerZh.documentCapture })).toBeTruthy()
  fireEvent.click(actions.getByRole('button', { name: readerZh.translation }))
  fireEvent.change(screen.getByRole('combobox', { name: readerZh.translationTarget }), {
    target: { value: 'es' },
  })
  expect(translate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: readerZh.translationModel }))
  await screen.findByText('Notas')
  expect(translate).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, text: 'notes', target: 'es' },
    expect.any(AbortSignal),
  )
  fireEvent.click(screen.getByRole('button', { name: readerZh.translationQuote }))
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
  expect(inputActions.insertQuote).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining(
      JSON.stringify({
        noteRef: ref,
        sourceType: 'note',
        title: note.title,
        noteVersion: 7,
        translation: { target: 'es', engine: 'model' },
      }),
    ),
    expect.objectContaining({ body: `notes\n\n${readerZh.translationResult}\nNotas` }),
  )
})
