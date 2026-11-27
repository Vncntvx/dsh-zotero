// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderQuote, type ReaderReviews } from '../../../src/client/reader/ReaderQuote.tsx'
import type { PdfQuoteSource } from '../../../src/reader/evidence.ts'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const sessionId = 'reader-review-session' as SessionId
const t = makeTranslate(readerEn)
const view = { page: 1, count: 1, fingerprint: 'review-fixture' }
const outline: [] = []
const tabSignal = new AbortController().signal
const readExcerpt = vi.fn(async () => ({ text: '', pages: [], emptyPages: 0, truncated: false }))

afterEach(cleanup)

function source(index: number): PdfQuoteSource {
  return {
    attachmentRef: `zotero://user/0/items/ATTACH${String(index).padStart(4, '0')}`,
    libraryRef: 'zotero://user/0/',
    fingerprint: 'review-fixture',
    title: `Article ${index}`,
  }
}

function open(current: PdfQuoteSource, reviews: ReaderReviews, insertQuote = vi.fn(() => true)) {
  const inputActions = { insertQuote, persistDraft: vi.fn() }
  const onClose = vi.fn()
  const props = {
    t,
    source: current,
    view,
    outline,
    tabSignal,
    inputActions,
    review: { store: reviews, sessionId },
    read: readExcerpt,
    pageLabel: (pageIndex: number) => String(pageIndex + 1),
    onClose,
  }
  const rendered = render(<ReaderQuote {...props} />)
  return { ...rendered, inputActions, onClose }
}

it('keeps the eight-source review limit without dropping accepted citations', async () => {
  const reviews = createSnapshotStore(new Map()) as unknown as ReaderReviews
  let rendered = open(source(1), reviews)
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))

  for (let index = 2; index <= 8; index++) {
    rendered.rerender(
      <ReaderQuote
        t={t}
        source={source(index)}
        view={view}
        outline={outline}
        tabSignal={tabSignal}
        inputActions={rendered.inputActions}
        review={{ store: reviews, sessionId }}
        read={readExcerpt}
        pageLabel={(pageIndex) => String(pageIndex + 1)}
        onClose={rendered.onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))
  }

  expect(reviews.getSnapshot().get(sessionId)).toHaveLength(8)
  rendered.rerender(
    <ReaderQuote
      t={t}
      source={source(9)}
      view={view}
      outline={outline}
      tabSignal={tabSignal}
      inputActions={rendered.inputActions}
      review={{ store: reviews, sessionId }}
      read={readExcerpt}
      pageLabel={(pageIndex) => String(pageIndex + 1)}
      onClose={rendered.onClose}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))

  expect((await screen.findByRole('alert')).textContent).toContain('Choose up to 8 sources')
  expect(
    reviews
      .getSnapshot()
      .get(sessionId)
      ?.map(({ provenance }) => provenance.attachmentRef),
  ).toEqual(Array.from({ length: 8 }, (_, index) => source(index + 1).attachmentRef))
})

it('removes a review source and preserves the remaining draft after Composer refusal', async () => {
  const reviews = createSnapshotStore(new Map()) as unknown as ReaderReviews
  const insertQuote = vi.fn(() => false)
  const rendered = open(source(1), reviews, insertQuote)
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))

  rendered.rerender(
    <ReaderQuote
      t={t}
      source={source(2)}
      view={view}
      outline={outline}
      tabSignal={tabSignal}
      inputActions={rendered.inputActions}
      review={{ store: reviews, sessionId }}
      read={readExcerpt}
      pageLabel={(pageIndex) => String(pageIndex + 1)}
      onClose={rendered.onClose}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))
  fireEvent.click(
    screen.getByRole('button', {
      name: readerEn.quoteReviewRemove.replace('{title}', 'Article 1'),
    }),
  )
  expect(
    reviews
      .getSnapshot()
      .get(sessionId)
      ?.map(({ label }) => label),
  ).toEqual(['Article 2'])

  rendered.rerender(
    <ReaderQuote
      t={t}
      source={source(3)}
      view={view}
      outline={outline}
      tabSignal={tabSignal}
      inputActions={rendered.inputActions}
      review={{ store: reviews, sessionId }}
      read={readExcerpt}
      pageLabel={(pageIndex) => String(pageIndex + 1)}
      onClose={rendered.onClose}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewSelect }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.quoteReviewDraft }))
  expect(screen.getByRole('alert').textContent).toBe(readerEn.quoteInsertFailed)
  expect(reviews.getSnapshot().get(sessionId)).toHaveLength(2)
  expect(rendered.inputActions.persistDraft).not.toHaveBeenCalled()
  expect(rendered.onClose).not.toHaveBeenCalled()
})
