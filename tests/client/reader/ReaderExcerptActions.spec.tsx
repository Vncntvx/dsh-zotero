// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ZOTERO_READER_TRANSLATION_SOURCE_CHARS } from '../../../src/constants.ts'
import { ReaderExcerptActions } from '../../../src/client/reader/ReaderExcerptActions.tsx'
import { excerptRegion } from '../../../src/client/reader/excerpt-region.ts'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const { writeClipboard } = vi.hoisted(() => ({
  writeClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard }
})

const t = makeTranslate(readerEn)

beforeEach(() => {
  writeClipboard.mockReset().mockResolvedValue(true)
})

afterEach(cleanup)

function open(text: string, onQuote = vi.fn(() => true)) {
  const body = createRef<HTMLDivElement>()
  const owner = new AbortController()
  const view = render(
    <>
      <div ref={body}>{text}</div>
      <ReaderExcerptActions
        t={t}
        body={body}
        title="Research note"
        tabSignal={owner.signal}
        onQuote={onQuote}
      />
    </>,
  )
  return { body, onQuote, owner, view }
}

function select(node: Node, start = 0, end = node.textContent!.length) {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(node.firstChild!, start)
  range.setEnd(node.firstChild!, end)
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
}

it('copies and cites the selected UTF-16 range', async () => {
  const { onQuote } = open('A 𝒳 result')
  const source = screen.getByText('A 𝒳 result')
  select(source, 2, 4)

  fireEvent.click(screen.getByRole('button', { name: readerEn.copy }))
  await screen.findByText(readerEn.copied)
  expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('𝒳')

  fireEvent.click(screen.getByRole('button', { name: readerEn.quote }))
  expect(onQuote).toHaveBeenCalledExactlyOnceWith(
    { text: '𝒳', start: 2, truncated: false },
    undefined,
    undefined,
  )
  expect(await screen.findByText(readerEn.quoteBatchAdded)).toBeTruthy()
})

it('clears the toolbar when selection moves outside the document or collapses', () => {
  const { view } = open('Document text')
  const source = screen.getByText('Document text')
  select(source, 0, 8)
  expect(screen.getByRole('group', { name: readerEn.documentSelection })).toBeTruthy()

  const outside = document.createElement('span')
  outside.textContent = 'Outside'
  view.container.append(outside)
  select(outside)
  expect(screen.queryByRole('group', { name: readerEn.documentSelection })).toBeNull()

  const selection = document.getSelection()!
  const collapsed = document.createRange()
  collapsed.setStart(source.firstChild!, 0)
  collapsed.collapse(true)
  selection.removeAllRanges()
  selection.addRange(collapsed)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('group', { name: readerEn.documentSelection })).toBeNull()
})

it('signals shortened excerpts and reports when Composer refuses a citation', async () => {
  const onQuote = vi.fn(() => false)
  open('x'.repeat(ZOTERO_READER_TRANSLATION_SOURCE_CHARS + 10), onQuote)
  const source = screen.getByText('x'.repeat(ZOTERO_READER_TRANSLATION_SOURCE_CHARS + 10))
  select(source, 0, ZOTERO_READER_TRANSLATION_SOURCE_CHARS + 10)
  expect(screen.getByText(readerEn.quoteBatchTruncated)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: readerEn.quote }))
  expect(onQuote).toHaveBeenCalledExactlyOnceWith(
    {
      text: 'x'.repeat(ZOTERO_READER_TRANSLATION_SOURCE_CHARS),
      start: 0,
      truncated: true,
    },
    undefined,
    undefined,
  )
  expect(await screen.findByText(readerEn.quoteInsertFailed)).toBeTruthy()
})

it('captures the selected rendered layout and quotes it as a screenshot source', async () => {
  const png = new Blob(['rendered selection'], { type: 'image/png' })
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  const context = {
    fillRect,
    drawImage,
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 8 }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(png))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:selected-layout')
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(24, 34, 96, 22))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 200),
  )
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode() {
        return Promise.resolve()
      }
    },
  )
  const onQuote = vi.fn(() => true)
  const { body } = open('Selected layout', onQuote)
  select(screen.getByText('Selected layout'))
  expect(excerptRegion(body.current!, document.getSelection()!.getRangeAt(0))).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: readerEn.documentCapture }))
  const preview = await screen.findByRole('img', { name: readerEn.documentCapturePreview })
  expect(preview.getAttribute('src')).toBe('blob:selected-layout')
  expect(drawImage).toHaveBeenCalledOnce()

  fireEvent.click(screen.getByRole('button', { name: readerEn.captureQuote }))
  expect(onQuote).toHaveBeenCalledExactlyOnceWith(
    { text: 'Selected layout', start: 0, truncated: false },
    undefined,
    true,
  )
  expect(await screen.findByText(readerEn.quoteBatchAdded)).toBeTruthy()
})

it('discards clipboard feedback after the Reader tab is aborted', async () => {
  const pending = deferred<boolean>()
  writeClipboard.mockReturnValueOnce(pending.promise)
  const { owner } = open('Selection')
  select(screen.getByText('Selection'), 0, 9)
  fireEvent.click(screen.getByRole('button', { name: readerEn.copy }))
  owner.abort()
  await act(async () => pending.resolve(true))
  expect(screen.queryByText(readerEn.copied)).toBeNull()
})

it('reports a refused clipboard write and ignores blank or aborted selections', async () => {
  writeClipboard.mockResolvedValueOnce(false)
  const { owner } = open('Selection')
  select(screen.getByText('Selection'), 0, 9)
  fireEvent.click(screen.getByRole('button', { name: readerEn.copy }))
  expect(await screen.findByText(readerEn.copyFailed)).toBeTruthy()

  const blank = screen.getByText('Selection').parentElement!
  const range = document.createRange()
  range.selectNodeContents(blank)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('group', { name: readerEn.documentSelection })).toBeNull()

  owner.abort()
  select(screen.getByText('Selection'), 0, 9)
  expect(screen.queryByRole('group', { name: readerEn.documentSelection })).toBeNull()
})
