import { expect, it, vi } from 'vitest'
import { locatePdfQuote } from '../../../src/client/reader/pdf-evidence.ts'
import { MAX_EXCERPT_TEXT } from '../../../src/client/reader/pdf-excerpt.ts'
import { deferred } from '../../helpers/sync.ts'

function pdfWithText(...pages: string[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (number: number) => ({
      streamTextContent: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ items: [{ str: pages[number - 1], hasEOL: true }] })
            controller.close()
          },
        }),
    })),
  }
}

it('locates the complete passage across PDF text whitespace and ligatures', async () => {
  const pdf = pdfWithText('Prior findings', 'The ﬁndings\n continued here.', 'Later findings')
  const signal = new AbortController().signal
  await expect(locatePdfQuote(pdf, 'The findings continued here.', signal)).resolves.toEqual({
    kind: 'unique',
    pageIndex: 1,
    endPageIndex: 1,
  })
  expect(pdf.getPage.mock.calls).toEqual([[1], [2], [3]])
})

it.each([
  { text: ['one result', 'one result'], pages: [0, 1] },
  { text: ['one result and one result', ''], pages: [0] },
])('reports repeated text with the candidate physical pages', async ({ text, pages }) => {
  const result = await locatePdfQuote(
    pdfWithText(...text),
    'one result',
    new AbortController().signal,
  )
  expect(result).toEqual({ kind: 'ambiguous', pages })
})

it('locates a quote across adjacent physical pages', async () => {
  const pdf = pdfWithText('Begin the selected', 'passage. Afterwards')
  await expect(
    locatePdfQuote(pdf, 'the selected passage', new AbortController().signal),
  ).resolves.toEqual({ kind: 'unique', pageIndex: 0, endPageIndex: 1 })
})

it('does not join text across a physical page without extractable text', async () => {
  const pdf = pdfWithText('the selected', '', 'passage')
  await expect(
    locatePdfQuote(pdf, 'the selected passage', new AbortController().signal),
  ).resolves.toEqual({
    kind: 'missing',
  })
})

it('does not report a unique match when another page exceeds its text budget', async () => {
  const pdf = pdfWithText('one result', 'a'.repeat(MAX_EXCERPT_TEXT + 1))
  await expect(locatePdfQuote(pdf, 'one result', new AbortController().signal)).resolves.toEqual({
    kind: 'incomplete',
  })
})

it('declines an oversized document or quote before getting any page', async () => {
  const pdf = pdfWithText('one result')
  const signal = new AbortController().signal
  await expect(locatePdfQuote({ ...pdf, numPages: 257 }, 'one result', signal)).resolves.toEqual({
    kind: 'incomplete',
  })
  await expect(locatePdfQuote(pdf, 'a'.repeat(2_001), signal)).resolves.toEqual({
    kind: 'incomplete',
  })
  expect(pdf.getPage).not.toHaveBeenCalled()
})

it('cancels an active text stream when the navigation leaves', async () => {
  const pulled = deferred()
  const cancel = vi.fn()
  const pdf = {
    numPages: 2,
    getPage: vi.fn(async () => ({
      streamTextContent: () => new ReadableStream({ pull: () => pulled.resolve(), cancel }),
    })),
  }
  const controller = new AbortController()
  const match = locatePdfQuote(pdf, 'one result', controller.signal)
  await pulled.promise
  const reason = new Error('Navigation changed')
  controller.abort(reason)
  await expect(match).rejects.toBe(reason)
  expect(cancel).toHaveBeenCalledOnce()
  expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1)
})

it('reports an incomplete scan when the deadline elapses', async () => {
  vi.useFakeTimers()
  try {
    const getPage = vi.fn(() => deferred<never>().promise)
    const match = locatePdfQuote(
      { numPages: 1, getPage },
      'one result',
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(match).resolves.toEqual({ kind: 'incomplete' })
    expect(getPage).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
