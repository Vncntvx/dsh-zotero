// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { readerZh } from '../../../src/client/reader/locales.ts'
import type { PdfExcerpt } from '../../../src/client/reader/pdf-excerpt.ts'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, REF, SESSION } from './support/reader-tab.ts'

afterEach(cleanup)

async function openReader(
  runtime: ReturnType<typeof pdfRuntime>,
  overrides?: Partial<ReaderTabFace>,
) {
  const inputActions = {
    insertQuote: vi.fn<(draft: string, quote: { body: string }) => boolean>(() => true),
    persistDraft: vi.fn(),
    submit: vi.fn(),
  }
  const props = propsOf({ load: async () => runtime, ...overrides })
  render(<ReaderTab {...({ ...props, inputActions } as typeof props)} />)
  return inputActions
}

async function citePdf() {
  fireEvent.click(await screen.findByRole('button', { name: readerZh.quoteDocument }))
  return within(screen.getByRole('region', { name: readerZh.quoteDocument }))
}

it('adds a document reference without extracting page text or submitting the draft', async () => {
  const runtime = pdfRuntime()
  const actions = await openReader(runtime)
  const panel = await citePdf()
  fireEvent.click(panel.getByRole('button', { name: readerZh.quoteAddDraft }))
  const [draft, { body }] = actions.insertQuote.mock.calls[0]!
  expect(body).toBe(`Zotero 附件 ${REF}`)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    attachmentRef: REF,
    fingerprint: 'fingerprint',
    precision: 'document',
    sourceType: 'document',
    pages: [],
  })
  expect(actions.persistDraft).toHaveBeenCalledOnce()
  expect(actions.submit).not.toHaveBeenCalled()
  expect(runtime.controls.readExcerpt).not.toHaveBeenCalled()
})

it('combines preselected PDF scopes across tabs in one review draft', async () => {
  const other = REF.replace('ABCD1234', 'EFGH5678')
  const reviews: Required<ReaderTabFace>['reviews'] = createSnapshotStore(new Map())
  const actions = {
    insertQuote: vi.fn<(draft: string, quote: { body: string }) => boolean>(() => true),
    persistDraft: vi.fn(),
  }
  const mount = (ref: string) => {
    const runtime = pdfRuntime(undefined, { count: 3, page: 2 })
    runtime.controls.readExcerpt.mockResolvedValue({
      text: 'Observed the treatment response.',
      emptyPages: 0,
      truncated: false,
      pages: [{ pageIndex: 1, pageLabel: '2' }],
    })
    const props = propsOf(
      {
        reviews,
        load: async () => runtime,
        resolve: async () => ({ path: 'papers/paper.pdf', ref }),
      },
      readerAddress(SESSION, ref),
    )
    return render(<ReaderTab {...({ ...props, inputActions: actions } as typeof props)} />)
  }

  const first = mount(REF)
  const firstQuote = await citePdf()
  fireEvent.click(firstQuote.getByRole('button', { name: readerZh.quoteReviewSelect }))
  expect(firstQuote.queryByRole('button', { name: readerZh.quoteReviewDraft })).toBeNull()
  first.unmount()

  mount(other)
  const secondQuote = await citePdf()
  fireEvent.change(secondQuote.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'pages' },
  })
  fireEvent.click(secondQuote.getByRole('button', { name: readerZh.quotePrepare }))
  await secondQuote.findByText('Observed the treatment response.')
  fireEvent.click(secondQuote.getByRole('button', { name: readerZh.quoteReviewSelect }))
  expect(actions.insertQuote).not.toHaveBeenCalled()
  fireEvent.click(secondQuote.getByRole('button', { name: readerZh.quoteReviewDraft }))

  const [draft] = actions.insertQuote.mock.calls[0]!
  expect(draft).toContain('Observed the treatment response.')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject([
    { attachmentRef: REF, precision: 'document', pages: [] },
    { attachmentRef: other, precision: 'page', pages: [{ pageIndex: 1 }] },
  ])
  expect(actions.persistDraft).toHaveBeenCalledOnce()
  expect(reviews.getSnapshot().size).toBe(0)
})

it('previews the capped physical page range and estimate before adding it to the Composer', async () => {
  const runtime = pdfRuntime(undefined, { page: 2, count: 41 })
  const pages = [{ pageIndex: 1, pageLabel: 'ii' }]
  runtime.controls.readExcerpt.mockResolvedValue({
    text: 'Excerpt',
    truncated: true,
    emptyPages: 0,
    pages,
  })
  const actions = await openReader(runtime)
  const panel = await citePdf()
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'pages' },
  })
  fireEvent.change(panel.getByRole('spinbutton', { name: readerZh.quoteLastPage }), {
    target: { value: '41' },
  })
  fireEvent.click(panel.getByRole('button', { name: readerZh.quotePrepare }))
  await panel.findByText(readerZh.quoteExcerptTruncated)
  expect(panel.getByText(/草稿预计使用 \d+ 个 token/)).toBeTruthy()
  expect(runtime.controls.readExcerpt).toHaveBeenCalledExactlyOnceWith(
    2,
    41,
    expect.any(AbortSignal),
  )
  expect(actions.insertQuote).not.toHaveBeenCalled()
  fireEvent.click(panel.getByRole('button', { name: readerZh.quoteAddDraft }))
  const [draft, { body }] = actions.insertQuote.mock.calls[0]!
  expect(body).toBe('Excerpt')
  expect(draft).toContain(readerZh.quoteExcerptTruncated)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    pages,
    precision: 'page',
    requestedPages: { firstPageIndex: 1, lastPageIndex: 40 },
    excerptTruncated: true,
  })
  expect(actions.persistDraft).toHaveBeenCalledOnce()
})

it('reads a bookmark through its children up to the next sibling section', async () => {
  const runtime = pdfRuntime(undefined, { page: 2, count: 10 })
  runtime.controls.getOutline.mockResolvedValue([
    {
      id: '0',
      title: 'Methods',
      pageIndex: 1,
      destination: null,
      children: [{ id: '0.0', title: 'Cohort', pageIndex: 2, destination: null, children: [] }],
    },
    { id: '1', title: 'Results', pageIndex: 4, destination: null, children: [] },
  ])
  runtime.controls.readExcerpt.mockResolvedValue({
    text: 'Methods excerpt',
    pages: [{ pageIndex: 1, pageLabel: 'ii' }],
    emptyPages: 0,
    truncated: false,
  })
  const actions = await openReader(runtime)
  const panel = await citePdf()
  await panel.findByRole('option', { name: readerZh.quoteSectionRange })
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'sections' },
  })
  expect(panel.getByText(/物理页 2–4/)).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: readerZh.quotePrepare }))
  await panel.findByText('Methods excerpt')
  expect(runtime.controls.readExcerpt).toHaveBeenCalledExactlyOnceWith(
    2,
    4,
    expect.any(AbortSignal),
  )
  fireEvent.click(panel.getByRole('button', { name: readerZh.quoteAddDraft }))
  const [draft] = actions.insertQuote.mock.calls[0]!
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    sectionPath: ['Methods'],
    endSectionPath: ['Methods'],
  })
})

it('quotes selected UTF-16 text and records only the pages the range touches', async () => {
  const runtime = pdfRuntime(undefined, { count: 2 })
  runtime.controls.readExcerpt.mockResolvedValue({
    text: 'First\n\n𝒳 evidence',
    pages: [
      { pageIndex: 0, pageLabel: 'i', textRange: { start: 0, end: 5 } },
      { pageIndex: 1, pageLabel: '1', textRange: { start: 7, end: 18 } },
    ],
    emptyPages: 0,
    truncated: false,
  })
  const actions = await openReader(runtime)
  const panel = await citePdf()
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'characters' },
  })
  fireEvent.change(panel.getByRole('spinbutton', { name: readerZh.quoteLastPage }), {
    target: { value: '2' },
  })
  fireEvent.click(panel.getByRole('button', { name: readerZh.quotePrepare }))
  const text = await panel.findByRole('textbox', { name: readerZh.quoteExtractedText })
  const first = panel.getByRole('spinbutton', { name: readerZh.quoteFirstCharacter })
  fireEvent.change(first, { target: { value: '9' } })
  expect(panel.queryByRole('button', { name: readerZh.quoteAddDraft })).toBeNull()
  expect(panel.getByText(readerZh.quoteInvalidCharacters)).toBeTruthy()

  ;(text as HTMLTextAreaElement).focus()
  ;(text as HTMLTextAreaElement).setSelectionRange(7, 9)
  fireEvent.select(text)
  fireEvent.click(panel.getByRole('button', { name: readerZh.quoteAddDraft }))
  const [draft, { body }] = actions.insertQuote.mock.calls[0]!
  expect(body).toBe('𝒳')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    precision: 'text',
    textRange: { start: 7, end: 9 },
    requestedPages: { firstPageIndex: 0, lastPageIndex: 1 },
    pages: [{ pageIndex: 1, pageLabel: '1' }],
  })
  expect(actions.persistDraft).toHaveBeenCalledOnce()
})

it('aborts an unfinished preview and ignores a late result after cancellation', async () => {
  const runtime = pdfRuntime(undefined, { count: 12 })
  const read = deferred<PdfExcerpt>()
  runtime.controls.readExcerpt.mockReturnValue(read.promise)
  const actions = await openReader(runtime)
  const panel = await citePdf()
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'full' },
  })
  fireEvent.click(panel.getByRole('button', { name: readerZh.quotePrepare }))
  const [start, end, signal] = runtime.controls.readExcerpt.mock.calls[0]!
  expect([start, end]).toEqual([1, 12])
  expect(signal.aborted).toBe(false)
  fireEvent.click(panel.getByRole('button', { name: readerZh.cancel }))
  expect(signal.aborted).toBe(true)
  await act(async () =>
    read.resolve({ text: 'Late content', pages: [], emptyPages: 0, truncated: false }),
  )
  expect(screen.queryByText('Late content')).toBeNull()
  expect(actions.insertQuote).not.toHaveBeenCalled()
})

it('keeps an unreadable or image-only PDF from adding empty text and preserves a prepared quote after draft refusal', async () => {
  const runtime = pdfRuntime(undefined, { count: 2 })
  const pages = [{ pageIndex: 0, pageLabel: 'i' }]
  runtime.controls.readExcerpt
    .mockRejectedValueOnce(new Error('Text stream interrupted'))
    .mockResolvedValueOnce({ text: '', pages, emptyPages: 1, truncated: false })
    .mockResolvedValueOnce({ text: 'Results', pages, emptyPages: 1, truncated: false })
  const actions = await openReader(runtime)
  actions.insertQuote.mockReturnValueOnce(false)
  const panel = await citePdf()
  fireEvent.change(panel.getByRole('combobox', { name: readerZh.quoteScope }), {
    target: { value: 'pages' },
  })
  const prepare = panel.getByRole('button', { name: readerZh.quotePrepare })
  const end = panel.getByRole('spinbutton', { name: readerZh.quoteLastPage })
  fireEvent.change(end, { target: { value: '3' } })
  expect(prepare.matches(':disabled')).toBe(true)
  fireEvent.change(end, { target: { value: '2' } })
  fireEvent.click(prepare)
  await panel.findByText(readerZh.quoteReadFailed)
  fireEvent.click(prepare)
  await panel.findByText(readerZh.quoteNoText)
  expect(panel.queryByRole('button', { name: readerZh.quoteAddDraft })).toBeNull()

  fireEvent.click(prepare)
  const insert = await panel.findByRole('button', { name: readerZh.quoteAddDraft })
  fireEvent.click(insert)
  expect(panel.getByText(readerZh.quoteInsertFailed)).toBeTruthy()
  expect(panel.getByText('Results')).toBeTruthy()
  expect(actions.persistDraft).not.toHaveBeenCalled()
  fireEvent.click(insert)
  expect(actions.persistDraft).toHaveBeenCalledOnce()
  expect(JSON.parse(actions.insertQuote.mock.lastCall![0].split('\n\n').at(-1)!)).toMatchObject({
    pagesWithoutText: 1,
    requestedPages: { firstPageIndex: 0, lastPageIndex: 1 },
  })
})

it('quotes a Zotero annotation with its own ref, comment, and PDF region', async () => {
  const runtime = pdfRuntime(undefined, { count: 3 })
  const ref = 'zotero://user/0/annotation/ANNO0001'
  const rects = [{ x: 1, y: 2, width: 3, height: 4 }]
  runtime.controls.pageLabel.mockReturnValue('ii')
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
    items: [
      {
        ref,
        type: 'highlight',
        text: 'Marked passage',
        comment: 'Reader comment',
        pageLabel: '2A',
        position: { pageIndex: 1, rects },
      },
    ],
    total: 1,
    returned: 1,
    limit: 50,
    offset: 0,
    writeEnabled: false,
  })
  const actions = await openReader(runtime, { annotations })
  fireEvent.click(await screen.findByRole('button', { name: readerZh.annotations }))
  fireEvent.click(await screen.findByRole('button', { name: readerZh.quoteAnnotation }))
  const panel = within(screen.getByRole('region', { name: readerZh.quoteAnnotation }))
  fireEvent.click(panel.getByRole('button', { name: readerZh.quoteAddDraft }))
  const [draft, { body }] = actions.insertQuote.mock.calls[0]!
  expect(body).toBe('Marked passage\n\n标注评论：Reader comment')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    annotationRef: ref,
    annotationPageLabel: '2A',
    sourceType: 'annotation',
    precision: 'region',
    pages: [{ pageIndex: 1, pageLabel: 'ii', rects }],
  })
  expect(runtime.controls.readExcerpt).not.toHaveBeenCalled()
})

it('adds selected annotations as one draft citation with per-annotation PDF provenance', async () => {
  const runtime = pdfRuntime(undefined, { count: 3 })
  const refs = ['ANNO0001', 'ANNO0002', 'ANNO0003'].map(
    (key) => `zotero://user/0/annotation/${key}`,
  )
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
    items: [
      {
        ref: refs[0],
        type: 'highlight',
        text: 'First finding',
        position: { pageIndex: 0, rects: [] },
      },
      { ref: refs[1], type: 'underline', text: 'Second finding', comment: 'Check the units' },
      { ref: refs[2], type: 'highlight', text: 'Outside the batch' },
    ],
    total: 3,
    returned: 3,
    limit: 50,
    offset: 0,
    writeEnabled: false,
  })
  const actions = await openReader(runtime, { annotations })
  fireEvent.click(await screen.findByRole('button', { name: readerZh.annotations }))
  fireEvent.click(await screen.findByText(readerZh.quoteAnnotationBatch))
  fireEvent.click(screen.getByRole('checkbox', { name: 'First finding' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Second finding/ }))
  fireEvent.click(screen.getByRole('button', { name: readerZh.quoteAddDraft }))
  expect(actions.insertQuote).toHaveBeenCalledOnce()
  const [draft, { body }] = actions.insertQuote.mock.calls[0]!
  expect(body).toContain('标注评论：Check the units')
  expect(body).not.toContain('Outside the batch')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject([
    { attachmentRef: REF, annotationRef: refs[0], precision: 'page', pages: [{ pageIndex: 0 }] },
    { attachmentRef: REF, annotationRef: refs[1], precision: 'document', pages: [] },
  ])
  expect(actions.persistDraft).toHaveBeenCalledOnce()
  expect(actions.submit).not.toHaveBeenCalled()
})
