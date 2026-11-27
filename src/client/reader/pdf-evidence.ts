import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view.d.ts'
import type { PdfRect } from '../../reader/evidence.ts'
import { readPdfExcerpt } from './pdf-excerpt.ts'

const MAX_SEARCH_PAGES = 256
const MAX_QUOTE_LENGTH = 2_000
const SEARCH_TIMEOUT_MS = 5_000
const ligatures = ['ff', 'fi', 'fl', 'ffi', 'ffl', 'st', 'st']

function normalize(text: string, offsets?: number[]): string {
  let normalized = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (/\s/u.test(char)) {
      if (!normalized || normalized.endsWith(' ')) continue
      normalized += ' '
      offsets?.push(index)
    } else {
      const part = ligatures[char.charCodeAt(0) - 0xfb00] ?? char
      normalized += part
      for (let i = 0; offsets && i < part.length; i++) offsets.push(index)
    }
  }
  return normalized
}

export type PdfEvidenceMatch =
  | { readonly kind: 'unique'; readonly pageIndex: number; readonly endPageIndex: number }
  | { readonly kind: 'ambiguous'; readonly pages: readonly number[] }
  | { readonly kind: 'missing' | 'incomplete' }

/** Only a complete text scan can establish that a quote occurs once. */
export async function locatePdfQuote(
  pdf: Parameters<typeof readPdfExcerpt>[0],
  quote: string,
  signal: AbortSignal,
): Promise<PdfEvidenceMatch> {
  signal.throwIfAborted()
  if (quote.length > MAX_QUOTE_LENGTH || pdf.numPages > MAX_SEARCH_PAGES)
    return { kind: 'incomplete' }
  const needle = normalize(quote).trimEnd()
  if (!needle) return { kind: 'missing' }
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), SEARCH_TIMEOUT_MS)
  const scan = AbortSignal.any([signal, timeout.signal])
  const pages = new Set<number>()
  let count = 0
  let first: { pageIndex: number; endPageIndex: number } | undefined
  let tail = ''
  let tailPages: number[] = []
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await readPdfExcerpt(pdf, null, number, number, scan)
      if (page.truncated) return { kind: 'incomplete' }
      const currentPage = number - 1
      const pageText = normalize(page.text)
      if (!pageText) {
        tail = ''
        tailPages = []
        continue
      }
      const text = tail + pageText
      for (
        let start = text.indexOf(needle);
        start !== -1;
        start = text.indexOf(needle, start + 1)
      ) {
        const pageIndex = tailPages[start] ?? currentPage
        pages.add(pageIndex)
        count++
        first ??= { pageIndex, endPageIndex: currentPage }
      }
      // Retain only enough text to match a passage crossing a physical page
      // break. This suffix is shorter than the quote so hits cannot repeat.
      const offset = Math.max(0, text.length + 2 - needle.length)
      tail = `${text} `.slice(offset)
      tailPages = Array.from(
        { length: tail.length },
        (_, index) => tailPages[index + offset] ?? currentPage,
      )
    }
    if (count > 1) return { kind: 'ambiguous', pages: [...pages].sort((a, b) => a - b) }
    if (first) return { kind: 'unique', ...first }
    return { kind: 'missing' }
  } catch (cause) {
    signal.throwIfAborted()
    if (timeout.signal.aborted) return { kind: 'incomplete' }
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

export function pdfTextRect(
  rect: DOMRect,
  frame: DOMRect,
  viewport: PDFPageView['viewport'],
): PdfRect | undefined {
  const left = Math.max(rect.left, frame.left) - frame.left
  const right = Math.min(rect.right, frame.right) - frame.left
  const top = Math.max(rect.top, frame.top) - frame.top
  const bottom = Math.min(rect.bottom, frame.bottom) - frame.top
  if (right <= left || bottom <= top) return
  const scaleX = viewport.width / frame.width
  const scaleY = viewport.height / frame.height
  const [x1, y1] = viewport.convertToPdfPoint(left * scaleX, top * scaleY) as [number, number]
  const [x2, y2] = viewport.convertToPdfPoint(right * scaleX, bottom * scaleY) as [number, number]
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** Map the matching text spans of a rendered page into physical PDF space. */
export function pdfQuoteRects(
  layer: HTMLElement,
  viewport: PDFPageView['viewport'],
  quote: string,
): PdfRect[] {
  const nodes: { node: Text; start: number }[] = []
  let raw = ''
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      nodes.push({ node, start: raw.length })
      raw += node.data
    } else if (node instanceof HTMLBRElement) raw += '\n'
    if (raw.length > 32_000) return []
  }
  const offsets: number[] = []
  const text = normalize(raw, offsets)
  const needle = normalize(quote).trimEnd()
  const match = text.indexOf(needle)
  if (!needle || match < 0 || text.includes(needle, match + 1)) return []
  const from = offsets[match]!
  const to = offsets[match + needle.length - 1]! + 1
  const frame = layer.getBoundingClientRect()
  const range = document.createRange()
  const rects: PdfRect[] = []
  for (const { node, start } of nodes) {
    const lo = Math.max(0, from - start)
    const hi = Math.min(node.length, to - start)
    if (hi <= lo || !node.data.slice(lo, hi).trim()) continue
    range.setStart(node, lo)
    range.setEnd(node, hi)
    let placed = false
    for (const rect of range.getClientRects()) {
      const mapped = pdfTextRect(rect, frame, viewport)
      if (!mapped) continue
      rects.push(mapped)
      if (rects.length > 128) return []
      placed = true
    }
    if (!placed) return []
  }
  return rects
}
