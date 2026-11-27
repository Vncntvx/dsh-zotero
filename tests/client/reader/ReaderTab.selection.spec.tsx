// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerZh } from '../../../src/client/reader/locales.ts'
import type { PdfSelection } from '../../../src/client/reader/pdf-runtime.ts'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, REF, SESSION, t } from './support/reader-tab.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const selection = {
  text: 'The observed effect was reproducible.',
  nearBottom: true,
  canAnnotate: true,
  pages: [
    {
      pageIndex: 0,
      pageLabel: 'iv',
      rects: [{ x: 12, y: 34, width: 56, height: 8 }],
      text: 'The observed effect was reproducible.',
      top: 34,
      textOffset: 10,
    },
  ],
} satisfies PdfSelection
const writableAnnotations = {
  items: [],
  total: 0,
  returned: 0,
  offset: 0,
  limit: 50,
  writeEnabled: true,
}

function openSelection(excerpt: PdfSelection = selection, face: Partial<ReaderTabFace> = {}) {
  const runtime = pdfRuntime(excerpt)
  const inputActions = {
    insertQuote: vi.fn<(draft: string, quote: { body: string }) => boolean>(() => true),
    persistDraft: vi.fn(),
    submit: vi.fn(),
  }
  const props = propsOf({ load: async () => runtime, ...face })
  const view = render(<ReaderTab {...({ ...props, inputActions } as typeof props)} />)
  return { view, inputActions, runtime }
}

it('stages a selection question with physical page, folio, and precise location after Composer accepts it', async () => {
  const { inputActions } = openSelection()
  inputActions.insertQuote.mockReturnValueOnce(false)
  const ask = await screen.findByRole('button', { name: readerZh.ask })
  fireEvent.click(ask)
  expect(screen.getByText(readerZh.quoteFailed)).toBeTruthy()
  expect(inputActions.persistDraft).not.toHaveBeenCalled()
  fireEvent.click(ask)
  const [draft, quote] = inputActions.insertQuote.mock.lastCall!
  expect(draft).toContain(readerZh.askPrompt)
  expect(quote.body).toBe(selection.text)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    attachmentRef: REF,
    sourceType: 'selection',
    precision: 'region',
    pages: [{ pageIndex: 0, pageLabel: 'iv', rects: selection.pages[0]!.rects }],
  })
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
  expect(inputActions.submit).not.toHaveBeenCalled()
  expect(screen.queryByText(readerZh.quoteFailed)).toBeNull()
})

it('adds the original and translated passages to a draft and preserves the truncation warning', async () => {
  const translated = '观察到的效应可重复。'
  const translate = vi.fn().mockResolvedValue(translated)
  const { inputActions } = openSelection({ ...selection, textTruncated: true }, { translate })
  fireEvent.click(await screen.findByRole('button', { name: readerZh.translate }))
  const panel = within(screen.getByRole('region', { name: readerZh.translation }))
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.translationTarget }), {
    target: { value: 'zh' },
  })
  fireEvent.click(panel.getByRole('button', { name: readerZh.translationModel }))
  await panel.findByText(translated)
  expect(translate).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, text: selection.text, target: 'zh' },
    expect.any(AbortSignal),
  )
  fireEvent.click(panel.getByRole('button', { name: readerZh.translationQuote }))
  const [draft, quote] = inputActions.insertQuote.mock.lastCall!
  expect(quote.body).toContain(selection.text)
  expect(quote.body).toContain(translated)
  expect(draft).toContain(readerZh.selectionTextTruncated)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    textTruncated: true,
    translation: { target: 'zh', engine: 'model' },
    pages: [{ pageIndex: 0, rects: selection.pages[0]!.rects }],
  })
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
  expect(inputActions.submit).not.toHaveBeenCalled()
})

it('shows the missing or failed cache response while leaving the original PDF selection usable', async () => {
  const region = { pageIndex: 0, box: [100, 200, 300, 400] } as const
  const openParsedPassage = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error())
  const { runtime, inputActions } = openSelection(selection, { openParsedPassage })
  runtime.controls.artifactSelection.mockResolvedValue(region)
  const locate = await screen.findByRole('button', { name: readerZh.locateInParsed })
  fireEvent.click(locate)
  await screen.findByText(readerZh.parsedMissing)
  expect(openParsedPassage).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    expect.objectContaining({ attachmentRef: REF }),
    { quote: selection.text, region },
    expect.any(AbortSignal),
  )
  await act(async () => fireEvent.click(locate))
  expect(screen.getByText(readerZh.parsedOpenFailed)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: readerZh.quote }))
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
})

it('keeps a parsed lookup for the same selection and cancels it at a different occurrence', async () => {
  const original = deferred<boolean>()
  const openParsedPassage = vi
    .fn<NonNullable<ReaderTabFace['openParsedPassage']>>()
    .mockReturnValueOnce(original.promise)
    .mockResolvedValueOnce(true)
  const { runtime } = openSelection(selection, { openParsedPassage })
  const locate = await screen.findByRole<HTMLButtonElement>('button', {
    name: readerZh.locateInParsed,
  })
  fireEvent.click(locate)
  fireEvent.click(locate)
  await act(async () => {})
  const signal = openParsedPassage.mock.calls[0]![3]
  expect(openParsedPassage).toHaveBeenCalledOnce()
  expect(locate.disabled).toBe(true)
  expect(signal.aborted).toBe(false)

  const onSelection = runtime.mountPdf.mock.calls[0]?.[5]?.onSelection
  act(() => onSelection?.({ ...selection, nearBottom: false }))
  expect(signal.aborted).toBe(false)
  expect(locate.disabled).toBe(true)

  const next = { ...selection, pages: [{ ...selection.pages[0]!, textOffset: 100 }] }
  const nextRegion = { pageIndex: 0, box: [500, 600, 700, 800] } as const
  runtime.controls.artifactSelection.mockResolvedValue(nextRegion)
  act(() => onSelection?.(next))
  expect(signal.aborted).toBe(true)
  expect(locate.disabled).toBe(false)
  await act(async () => original.resolve(false))
  expect(screen.queryByText(readerZh.parsedMissing)).toBeNull()
  await act(async () => fireEvent.click(locate))
  expect(openParsedPassage).toHaveBeenLastCalledWith(
    SESSION,
    expect.objectContaining({ attachmentRef: REF }),
    { quote: next.text, region: nextRegion },
    expect.any(AbortSignal),
  )
})

it('keeps the selected passage available to quote after clipboard denial', async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    .mockResolvedValueOnce(undefined)
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
  const { inputActions } = openSelection()
  const group = within(await screen.findByRole('group', { name: readerZh.selection }))
  const copy = group.getByRole('button', { name: readerZh.copy })
  fireEvent.click(copy)
  expect(await screen.findByText(readerZh.copyFailed)).toBeTruthy()
  const quote = group.getByRole('button', { name: readerZh.quote })
  expect(fireEvent.mouseDown(quote)).toBe(false)
  fireEvent.click(quote)
  expect(inputActions.insertQuote.mock.lastCall?.[1].body).toBe(selection.text)

  fireEvent.click(copy)
  expect(await screen.findByText(readerZh.copied)).toBeTruthy()
  expect(writeText.mock.calls).toEqual([[selection.text], [selection.text]])
})

it('preserves native selection while opening and canceling a highlight draft', async () => {
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue(writableAnnotations)
  const createAnnotations = vi.fn<ReaderTabFace['createAnnotations']>()
  openSelection(selection, { annotations, createAnnotations })
  const add = await screen.findByRole('button', { name: readerZh.addHighlight })
  expect(fireEvent.mouseDown(add)).toBe(false)
  fireEvent.click(add)
  const form = within(screen.getByRole('form', { name: readerZh.addHighlight }))
  fireEvent.change(form.getByLabelText(readerZh.annotationComment), { target: { value: 'Draft' } })
  fireEvent.click(form.getByRole('button', { name: readerZh.cancel }))

  expect(screen.queryByRole('form', { name: readerZh.addHighlight })).toBeNull()
  expect(screen.getByRole('button', { name: readerZh.addHighlight })).toBeTruthy()
  expect(createAnnotations).not.toHaveBeenCalled()
})

it('reports a declined highlight without trying to verify or resubmit the write', async () => {
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue(writableAnnotations)
  const createAnnotations = vi.fn<ReaderTabFace['createAnnotations']>().mockResolvedValue({
    kind: 'declined',
  })
  openSelection(selection, { annotations, createAnnotations })
  fireEvent.click(await screen.findByRole('button', { name: readerZh.addHighlight }))
  fireEvent.submit(screen.getByRole('form', { name: readerZh.addHighlight }))

  await screen.findByText(readerZh.annotationsDeclined)
  expect(createAnnotations).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ type: 'highlight', pages: selection.pages }),
    expect.any(AbortSignal),
  )
  expect(annotations).toHaveBeenCalledOnce()
  expect(screen.queryByRole('form', { name: readerZh.addHighlight })).toBeNull()
})

it('shows the exact ref for a highlight committed without a verified readback', async () => {
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue(writableAnnotations)
  const ref = 'zotero://user/0/annotation/ANNO0001?server=fixture'
  const createAnnotations = vi.fn<ReaderTabFace['createAnnotations']>().mockResolvedValue({
    kind: 'settled',
    pages: [{ pageIndex: 0, status: 'committed-unverified', ref }],
  })
  openSelection(selection, { annotations, createAnnotations })
  fireEvent.click(await screen.findByRole('button', { name: readerZh.addHighlight }))
  fireEvent.submit(screen.getByRole('form', { name: readerZh.addHighlight }))

  await screen.findByText(t('annotationCreateUnverified', { page: 1 }))
  fireEvent.click(screen.getByText(readerZh.annotationUnverifiedDetail))
  expect(screen.getByText(t('annotationUnverifiedRef', { ref })).closest('details')?.open).toBe(
    true,
  )
  expect(annotations).toHaveBeenCalledTimes(2)
  expect(createAnnotations).toHaveBeenCalledOnce()
})
