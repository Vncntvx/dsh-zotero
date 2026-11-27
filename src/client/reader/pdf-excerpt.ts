import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api.d.ts'
import { raceWithSignal } from '../../race-signal.ts'
import type { TextRange } from '../../reader/evidence.ts'
import { textPrefix } from './text-boundary.ts'

export const MAX_EXCERPT_PAGES = 32
export const MAX_EXCERPT_RECTS = 48
export const MAX_EXCERPT_TEXT = 16_000

export { textPrefix as excerptPrefix }

export interface PdfExcerpt {
  readonly text: string
  readonly pages: readonly {
    readonly pageIndex: number
    readonly pageLabel: string
    readonly textRange?: TextRange
  }[]
  readonly emptyPages: number
  readonly truncated: boolean
}

/** Read physical pages in order, stopping the worker stream when the excerpt is full. */
export async function readPdfExcerpt(
  pdf: {
    readonly numPages: number
    getPage(number: number): Promise<Pick<PDFPageProxy, 'streamTextContent'>>
  },
  labels: readonly string[] | null,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<PdfExcerpt> {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > pdf.numPages
  )
    throw new RangeError('Invalid physical PDF page range.')

  const lastPage = Math.min(end, start + MAX_EXCERPT_PAGES - 1)
  const pages: PdfExcerpt['pages'][number][] = []
  let text = ''
  let emptyPages = 0
  let truncated = lastPage < end
  for (let number = start; number <= lastPage; number++) {
    signal.throwIfAborted()
    const page = await raceWithSignal(pdf.getPage(number), signal)
    signal.throwIfAborted()
    // PDF.js 6.3.289 declares the stream without its chunk type.
    const reader = (page.streamTextContent() as ReadableStream<TextContent>).getReader()
    let complete = false
    let omittedText = false
    let pageText = ''
    const remaining = MAX_EXCERPT_TEXT - text.length - (text ? 2 : 0)
    try {
      while (!omittedText) {
        const chunk = await raceWithSignal(reader.read(), signal)
        if (chunk.done) {
          complete = true
          break
        }
        for (const item of chunk.value.items) {
          if (!('str' in item)) continue
          const pending = `${item.str}${item.hasEOL ? '\n' : ''}`
          const content = pageText ? pending : pending.trimStart()
          const budget = Math.max(0, remaining - pageText.length)
          if (content.length > budget) {
            const tail = textPrefix(content, budget)
            omittedText = content.slice(tail.length).trim().length > 0
            pageText += tail
            if (omittedText) break
          } else {
            pageText += content
          }
        }
      }
    } finally {
      if (!complete) void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    pageText = pageText.trimEnd()
    if (complete || pageText) {
      const start = text.length + (text ? 2 : 0)
      pages.push({
        pageIndex: number - 1,
        pageLabel: labels?.[number - 1] || String(number),
        ...(pageText && { textRange: { start, end: start + pageText.length } }),
      })
      if (pageText) text += `${text ? '\n\n' : ''}${pageText}`
      else emptyPages++
    }
    if (omittedText) {
      truncated = true
      break
    }
  }
  return { text, pages, emptyPages, truncated }
}
