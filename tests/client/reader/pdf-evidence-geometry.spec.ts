// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { pdfQuoteRects, pdfTextRect } from '../../../src/client/reader/pdf-evidence.ts'

afterEach(() => vi.restoreAllMocks())

const frame = new DOMRect(100, 200, 300, 240)
const viewport = {
  width: 450,
  height: 360,
  convertToPdfPoint: (x: number, y: number) => [y / 1.5 + 20, x / 1.5 + 30],
} as Parameters<typeof pdfTextRect>[2]

it('maps clipped text geometry through a rotated, cropped viewport', () => {
  expect(pdfTextRect(new DOMRect(80, 215, 30, 25), frame, viewport)).toEqual({
    x: 35,
    y: 30,
    width: 25,
    height: 10,
  })
  expect(pdfTextRect(new DOMRect(20, 215, 30, 25), frame, viewport)).toBeUndefined()
})

function renderedText() {
  const layer = document.createElement('div')
  layer.innerHTML = '<span>Start ﬁrst</span><br><span>ﬁnding ends.</span>'
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(frame)
  const createRange = document.createRange.bind(document)
  const rects = vi.fn((range: Range) =>
    range.toString() === 'ﬁrst' ? [new DOMRect(110, 220, 40, 10)] : [new DOMRect(102, 235, 52, 10)],
  )
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange()
    Object.defineProperty(range, 'getClientRects', { value: () => rects(range) })
    return range
  })
  return { layer, rects }
}

it('maps only the matched glyph ranges across line and ligature boundaries', () => {
  const { layer, rects } = renderedText()
  const result = pdfQuoteRects(layer, viewport, 'first finding')
  expect(result).toEqual([
    { x: 40, y: 40, width: 10, height: 40 },
    { x: 55, y: 32, width: 10, height: 52 },
  ])
  expect(rects).toHaveBeenCalledTimes(2)
})

it('keeps page precision when rendering duplicates the text or leaves part without geometry', () => {
  const { layer, rects } = renderedText()
  rects.mockReturnValueOnce([new DOMRect(110, 220, 40, 10)]).mockReturnValueOnce([])
  expect(pdfQuoteRects(layer, viewport, 'first finding')).toEqual([])
  layer.append(' first finding')
  expect(pdfQuoteRects(layer, viewport, 'first finding')).toEqual([])
  expect(rects).toHaveBeenCalledTimes(2)
})
