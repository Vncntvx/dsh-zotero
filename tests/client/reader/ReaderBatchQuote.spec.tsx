// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderBatchQuote } from '../../../src/client/reader/ReaderBatchQuote.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { attachmentRef, itemRef } from '../../helpers/server/keys.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)
const source = {
  attachmentRef: attachmentRef(),
  itemRef: itemRef(),
  libraryRef: 'zotero://user/0/',
  fingerprint: 'batch-fixture',
  title: 'Example article',
}

afterEach(cleanup)

function annotation(index: number, text: string) {
  const rects = [{ x: 12, y: 40, width: 30, height: 8 }]
  return {
    ref: `zotero://user/0/annotation/ANNO${String(index).padStart(4, '0')}`,
    type: 'highlight',
    text,
    pageLabel: String(index + 1),
    position: { pageIndex: index, rects },
  }
}

function mount(entries: readonly ReturnType<typeof annotation>[]) {
  const insertQuote = vi.fn<(draft: string) => boolean>(() => true)
  const persistDraft = vi.fn()
  render(
    <ReaderBatchQuote
      t={t}
      kind="annotation"
      source={source}
      pageCount={2}
      entries={entries}
      inputActions={{ insertQuote, persistDraft }}
      tabSignal={new AbortController().signal}
    />,
  )
  fireEvent.click(screen.getByText(readerEn.quoteAnnotationBatch))
  return { insertQuote, persistDraft }
}

it('quotes only the selected annotations and downgrades an unavailable page to a document anchor', () => {
  const excerpt = { ...annotation(0, 'First mark'), comment: 'Compare this with the control' }
  const missing = annotation(3, 'Page removed')
  const { insertQuote, persistDraft } = mount([excerpt, annotation(1, ''), missing])
  const choices = screen.getAllByRole('checkbox')
  expect(choices).toHaveLength(2)
  for (const choice of choices) fireEvent.click(choice)
  const add = screen.getByRole('button', { name: readerEn.quoteAddDraft })
  insertQuote.mockReturnValueOnce(false)
  fireEvent.click(add)
  expect(screen.getByText(readerEn.quoteInsertFailed)).toBeTruthy()
  expect(persistDraft).not.toHaveBeenCalled()
  fireEvent.click(add)
  const [draft] = insertQuote.mock.lastCall!
  expect(draft).toContain(excerpt.comment)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject([
    {
      sourceType: 'annotation',
      annotationRef: excerpt.ref,
      precision: 'page',
      pages: [{ pageIndex: 0 }],
    },
    { sourceType: 'annotation', annotationRef: missing.ref, precision: 'document', pages: [] },
  ])
  expect(persistDraft).toHaveBeenCalledOnce()
  expect(screen.getByText(readerEn.quoteBatchAdded)).toBeTruthy()
})

it('offers the next annotation again when the user deselects one at the eight-entry limit', () => {
  const entries = Array.from({ length: 9 }, (_, index) => annotation(index, `Finding ${index}`))
  mount(entries)
  const choices = screen.getAllByRole<HTMLInputElement>('checkbox')
  for (const choice of choices.slice(0, 8)) fireEvent.click(choice)
  expect(choices[8]?.disabled).toBe(true)
  fireEvent.click(choices[0]!)
  expect(choices[8]?.disabled).toBe(false)
  fireEvent.click(choices[8]!)
  expect(choices.filter((choice) => choice.checked)).toHaveLength(8)
  expect(choices[0]?.disabled).toBe(true)
})
