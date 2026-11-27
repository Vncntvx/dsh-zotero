// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { noteDraftFormats } from '../../../src/client/reader/note-draft.ts'
import { ZOTERO_WRITE_APPROVAL_UNAVAILABLE } from '../../../src/error-codes.ts'
import { ReaderNoteMutation } from '../../../src/client/reader/ReaderNote.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const ref = 'zotero://user/0/item/NOTE0001?server=instance-a'

beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

function props(overrides: Partial<Parameters<typeof ReaderNoteMutation>[0]> = {}) {
  return {
    t: makeTranslate(readerEn),
    action: { operation: 'edit', sessionId: 'reader-session', ref, expectedVersion: 4 },
    runs: [{ offset: 15, text: 'Zotero text' }],
    signal: new AbortController().signal,
    write: vi.fn().mockResolvedValue({ kind: 'applied', message: 'Saved' }),
    onApplied: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof ReaderNoteMutation>[0]
}

function editDraft() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Text 1' }), {
    target: { value: 'Recovered draft' },
  })
}

it('drops restored formatting ranges that split a Unicode character', () => {
  const text = 'Zotero 𝒳 text'
  expect(noteDraftFormats('strong:7:8', text)).toEqual([])
  expect(
    noteDraftFormats(JSON.stringify([{ format: 'strong', range: { start: 7, end: 8 } }]), text),
  ).toEqual([])
})

it('recovers same-version text after closing and clears the draft after a verified save', async () => {
  const editor = props()
  const first = render(<ReaderNoteMutation {...editor} />)
  editDraft()
  fireEvent.change(screen.getByRole('combobox', { name: 'Formatting for text 1' }), {
    target: { value: 'em' },
  })
  expect(screen.getByRole('status').textContent).toBe(readerEn.noteDraftKept)
  first.unmount()
  expect(editor.write).not.toHaveBeenCalled()

  const reopened = render(<ReaderNoteMutation {...editor} />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).value).toBe(
    'Recovered draft',
  )
  expect(
    screen.getByRole<HTMLSelectElement>('combobox', { name: 'Formatting for text 1' }).value,
  ).toBe('')
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await act(async () => {})
  expect(editor.onApplied).toHaveBeenCalledExactlyOnceWith('Saved')
  expect(editor.write).toHaveBeenCalledExactlyOnceWith(
    { ...editor.action, edits: [{ offset: 15, text: 'Recovered draft', format: 'em' }] },
    expect.any(AbortSignal),
  )
  reopened.unmount()

  render(<ReaderNoteMutation {...editor} />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).value).toBe(
    'Zotero text',
  )
})

it('keeps multiple overlapping formats in the draft and removes them independently', async () => {
  const editor = props({ runs: [{ offset: 15, text: 'Zotero 𝒳 text' }] })
  const first = render(<ReaderNoteMutation {...editor} />)
  const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  const add = (format: string, start: number, end: number) => {
    field.setSelectionRange(start, end)
    fireEvent.change(screen.getByRole('combobox', { name: 'Formatting for text 1' }), {
      target: { value: format },
    })
  }
  add('strong', 0, 6)
  add('em', 7, 9)
  add('u', 7, 9)
  first.unmount()

  const reopened = render(<ReaderNoteMutation {...editor} />)
  const preview = screen.getByRole('group', { name: 'Formatting preview for text 1' })
  expect(preview.querySelector('strong')?.textContent).toBe('Zotero')
  expect(preview.querySelector('u em')?.textContent).toBe('𝒳')
  fireEvent.click(
    screen.getByRole('button', { name: `${readerEn.noteFormatRemove} ${readerEn.noteFormatEm}` }),
  )
  expect(preview.querySelector('em')).toBeNull()
  expect(preview.querySelector('strong')?.textContent).toBe('Zotero')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave })))
  expect(editor.write).toHaveBeenCalledExactlyOnceWith(
    {
      ...editor.action,
      edits: [
        {
          offset: 15,
          text: 'Zotero 𝒳 text',
          formatting: [
            { format: 'strong', range: { start: 0, end: 6 } },
            { format: 'u', range: { start: 7, end: 9 } },
          ],
        },
      ],
    },
    expect.any(AbortSignal),
  )
  reopened.unmount()
})

it('keeps a stale draft copyable and requires discarding it before editing the new version', () => {
  const first = render(<ReaderNoteMutation {...props()} />)
  editDraft()
  first.unmount()

  const current = props({
    action: { operation: 'edit', sessionId: 'reader-session', ref, expectedVersion: 5 },
    runs: [{ offset: 15, text: 'Concurrent change' }],
  })
  render(<ReaderNoteMutation {...current} />)
  const text = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  expect(text.value).toBe('Recovered draft')
  expect(text.readOnly).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe(readerEn.noteDraftStale)
  fireEvent.submit(screen.getByRole('form', { name: readerEn.noteEdit }))
  expect(current.write).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: readerEn.noteDiscardDraft }))
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).value).toBe(
    'Concurrent change',
  )
})

it('previews selected note formatting and preserves its offsets when the editor reopens', async () => {
  const editor = props({ runs: [{ offset: 15, text: 'Zotero 𝒳 text' }] })
  const first = render(<ReaderNoteMutation {...editor} />)
  const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  field.setSelectionRange(7, 9)
  fireEvent.change(screen.getByRole('combobox', { name: 'Formatting for text 1' }), {
    target: { value: 'strong' },
  })
  const preview = () => screen.getByRole('group', { name: 'Formatting preview for text 1' })
  expect(preview().textContent).toContain('Zotero 𝒳 text')
  expect(preview().querySelector('strong')?.textContent).toBe('𝒳')
  first.unmount()

  const reopened = render(<ReaderNoteMutation {...editor} />)
  expect(preview().querySelector('strong')?.textContent).toBe('𝒳')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave })))
  expect(editor.write).toHaveBeenCalledExactlyOnceWith(
    {
      ...editor.action,
      edits: [
        { offset: 15, text: 'Zotero 𝒳 text', format: 'strong', formatRange: { start: 7, end: 9 } },
      ],
    },
    expect.any(AbortSignal),
  )
  reopened.unmount()
})

it.each([
  ['u', 'Underline', 'u'],
  ['s', 'Strikethrough', 's'],
  ['mark', 'Highlight', 'mark'],
  ['sub', 'Subscript', 'sub'],
  ['sup', 'Superscript', 'sup'],
] as const)('previews %s note formatting with its semantic element', (format, label, tag) => {
  render(<ReaderNoteMutation {...props({ runs: [{ offset: 15, text: 'Chemical H2O' }] })} />)
  const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  field.setSelectionRange(10, 11)
  fireEvent.change(screen.getByRole('combobox', { name: 'Formatting for text 1' }), {
    target: { value: format },
  })
  const preview = screen.getByRole('group', { name: 'Formatting preview for text 1' })
  expect(preview.querySelector(tag)?.textContent).toBe('2')
  expect(screen.getByRole('option', { name: label })).toBeTruthy()
})

it('drops the formatting range when subsequent text edits move its offsets', async () => {
  const editor = props()
  render(<ReaderNoteMutation {...editor} />)
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).setSelectionRange(0, 6)
  fireEvent.change(screen.getByRole('combobox', { name: 'Formatting for text 1' }), {
    target: { value: 'code' },
  })
  editDraft()
  expect(screen.queryByRole('group', { name: 'Formatting preview for text 1' })).toBeNull()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave })))
  expect(editor.write).toHaveBeenCalledExactlyOnceWith(
    { ...editor.action, edits: [{ offset: 15, text: 'Recovered draft' }] },
    expect.any(AbortSignal),
  )
})

it('keeps an ambiguous create draft read-only when the editor reopens', async () => {
  const editor = props({
    action: { operation: 'create', sessionId: 'reader-session', ref },
    write: vi.fn().mockResolvedValue({ kind: 'committed-unverified', message: 'Check Zotero' }),
  })
  const first = render(<ReaderNoteMutation {...editor} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
    target: { value: 'A new note' },
  })
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await act(async () => {})
  first.unmount()

  render(<ReaderNoteMutation {...editor} />)
  expect(screen.getByRole('alert').textContent).toBe(readerEn.noteDraftUnverified)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown' }).value).toBe(
    'A new note',
  )
  fireEvent.submit(screen.getByRole('form', { name: readerEn.noteCreate }))
  expect(editor.write).toHaveBeenCalledTimes(1)
})

it('recovers the latest edit and clears it after storage quota returns', async () => {
  const editor = props()
  const first = render(<ReaderNoteMutation {...editor} />)
  editDraft()
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota reached', 'QuotaExceededError')
  })
  try {
    fireEvent.change(screen.getByRole('textbox', { name: 'Text 1' }), {
      target: { value: 'Latest edit kept in memory' },
    })
    expect(screen.getByRole('status').textContent).toBe(readerEn.noteDraftMemory)
    first.unmount()

    const reopened = render(<ReaderNoteMutation {...editor} />)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).value).toBe(
      'Latest edit kept in memory',
    )
    expect(screen.getByRole('status').textContent).toBe(readerEn.noteDraftMemory)
    quota.mockRestore()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave })))
    expect(editor.write).toHaveBeenCalledExactlyOnceWith(
      { ...editor.action, edits: [{ offset: 15, text: 'Latest edit kept in memory' }] },
      expect.any(AbortSignal),
    )
    reopened.unmount()

    render(<ReaderNoteMutation {...editor} />)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' }).value).toBe(
      'Zotero text',
    )
  } finally {
    quota.mockRestore()
  }
})

it('keeps a newer draft from another editor after the pending version is saved', async () => {
  const pending = deferred<{ kind: 'applied'; message: string }>()
  const editor = props({ write: vi.fn().mockReturnValue(pending.promise) })
  const first = render(<ReaderNoteMutation {...editor} />)
  const second = render(<ReaderNoteMutation {...editor} />)
  const firstEditor = within(first.container)
  const secondEditor = within(second.container)
  fireEvent.change(firstEditor.getByRole('textbox', { name: 'Text 1' }), {
    target: { value: 'Submitted text' },
  })
  fireEvent.click(firstEditor.getByRole('button', { name: readerEn.noteSave }))
  expect(editor.write).toHaveBeenCalledOnce()
  fireEvent.change(secondEditor.getByRole('textbox', { name: 'Text 1' }), {
    target: { value: 'Continue from another tab' },
  })
  await act(async () => pending.resolve({ kind: 'applied', message: 'Saved' }))
  expect(editor.onApplied).toHaveBeenCalledExactlyOnceWith('Saved')
  first.unmount()
  second.unmount()

  render(
    <ReaderNoteMutation
      {...editor}
      action={{ operation: 'edit', sessionId: 'reader-session', ref, expectedVersion: 5 }}
    />,
  )
  expect(screen.getByRole('alert').textContent).toBe(readerEn.noteDraftStale)
  const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  expect(textarea.value).toBe('Continue from another tab')
  expect(textarea.readOnly).toBe(true)
})

it('keeps an approval-unavailable draft editable without treating it as a submitted write', async () => {
  const refusal = new RemoteError(
    'zotero/write',
    'Approval requires an active conversation turn.',
    {
      code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    },
  )
  const editor = props({
    write: vi
      .fn()
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce({ kind: 'applied', message: 'Saved' }),
  })
  const first = render(<ReaderNoteMutation {...editor} />)
  editDraft()
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe(refusal.message)
  first.unmount()

  render(<ReaderNoteMutation {...editor} />)
  const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text 1' })
  expect(textarea.value).toBe('Recovered draft')
  expect(textarea.readOnly).toBe(false)
  expect(screen.queryByText(readerEn.noteDraftUnverified)).toBeNull()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave })))
  expect(editor.onApplied).toHaveBeenCalledExactlyOnceWith('Saved')
})

it('cancels an unchanged edit and ignores an empty create', async () => {
  const edit = props({ onCancel: vi.fn() })
  render(<ReaderNoteMutation {...edit} />)
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await act(async () => {})
  expect(edit.onCancel).toHaveBeenCalledOnce()
  expect(edit.write).not.toHaveBeenCalled()

  cleanup()
  const create = props({
    action: { operation: 'create', sessionId: 'reader-session', ref },
    runs: undefined,
    onCancel: vi.fn(),
  })
  render(<ReaderNoteMutation {...create} />)
  fireEvent.click(screen.getByRole('button', { name: readerEn.noteSave }))
  await act(async () => {})
  expect(create.write).not.toHaveBeenCalled()
})
