import { expect, it, vi } from 'vitest'
import { MAX_EXCERPT_TEXT, readPdfExcerpt } from '../../../src/client/reader/pdf-excerpt.ts'
import { deferred } from '../../helpers/sync.ts'

function stream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ items: [{ str: text, hasEOL: true }] })
      controller.close()
    },
  })
}

it('streams only the requested physical pages and preserves their printed labels', async () => {
  const getPage = vi.fn(async (number: number) => ({
    streamTextContent: () => stream(number === 3 ? '' : `Page ${number}`),
  }))
  const excerpt = await readPdfExcerpt(
    { getPage, numPages: 5 },
    ['i', 'ii', 'iii', '1', '2'],
    2,
    4,
    new AbortController().signal,
  )
  expect(getPage.mock.calls).toEqual([[2], [3], [4]])
  expect(excerpt).toEqual({
    text: 'Page 2\n\nPage 4',
    pages: [
      { pageIndex: 1, pageLabel: 'ii', textRange: { start: 0, end: 6 } },
      { pageIndex: 2, pageLabel: 'iii' },
      { pageIndex: 3, pageLabel: '1', textRange: { start: 8, end: 14 } },
    ],
    emptyPages: 1,
    truncated: false,
  })
})

it('stops at 32 pages even when more pages were requested', async () => {
  const getPage = vi.fn(async (number: number) => ({
    streamTextContent: () => stream(`Page ${number}`),
  }))
  const result = await readPdfExcerpt(
    { getPage, numPages: 55 },
    null,
    5,
    45,
    new AbortController().signal,
  )
  expect(getPage).toHaveBeenCalledTimes(32)
  expect(getPage).toHaveBeenLastCalledWith(36)
  expect(result).toMatchObject({ truncated: true, emptyPages: 0 })
  expect(result.text).toMatch(/Page 36$/)
})

it('cancels the active text stream at the character cap without splitting a surrogate pair', async () => {
  const cancel = vi.fn()
  const prefix = 'a'.repeat(MAX_EXCERPT_TEXT - 1)
  const getPage = vi.fn(async () => ({
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: [{ str: `${prefix}𝒳 tail` }] })
        },
        cancel,
      }),
  }))
  const result = await readPdfExcerpt(
    { getPage, numPages: 2 },
    null,
    1,
    2,
    new AbortController().signal,
  )
  expect(result).toMatchObject({
    text: prefix,
    truncated: true,
    pages: [{ pageIndex: 0, pageLabel: '1', textRange: { start: 0, end: prefix.length } }],
  })
  expect(getPage).toHaveBeenCalledExactlyOnceWith(1)
  expect(cancel).toHaveBeenCalledOnce()
})

it('cancels a blocked PDF.js stream when the reader leaves the preview', async () => {
  const pulled = deferred<void>()
  const cancel = vi.fn()
  const streamTextContent = () => new ReadableStream({ pull: () => pulled.resolve(), cancel })
  const getPage = vi.fn(async () => ({ streamTextContent }))
  const controller = new AbortController()
  const result = readPdfExcerpt({ getPage, numPages: 2 }, null, 1, 2, controller.signal)
  await pulled.promise
  const reason = new Error('Preview closed')
  controller.abort(reason)
  await expect(result).rejects.toBe(reason)
  expect(getPage).toHaveBeenCalledExactlyOnceWith(1)
  expect(cancel).toHaveBeenCalledOnce()
})
