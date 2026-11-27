// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { capturePdfRegion } from '../../../src/client/reader/pdf-capture.ts'
import { deferred } from '../../helpers/sync.ts'

const frame = { x: 20, y: 20, width: 100, height: 120 }
const page = { pageIndex: 2, pageLabel: 'iv', rotation: 90, frame, section: 'Methods' }
const region = { x: 25, y: 35, width: 25, height: 15 }
const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() }
const blob = new Blob(['capture'], { type: 'image/png' })

function pdfFixture(promise = Promise.resolve()) {
  const cancel = vi.fn()
  const render = vi.fn(() => ({ promise, cancel }))
  const getPage = vi.fn(async () => ({
    render,
    getViewport: ({ scale }: { scale: number }) => ({
      width: frame.width * scale,
      height: frame.height * scale,
      convertToPdfPoint: (x: number, y: number) => [y / scale + 3, x / scale + 4],
    }),
  }))
  return { pdf: { getPage } as unknown as PDFDocumentProxy, getPage, render, cancel }
}

function measureText(measure: (range: Range) => DOMRect) {
  const makeRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = makeRange()
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => measure(range) })
    return range
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((reply) => reply(blob))
})

afterEach(() => vi.restoreAllMocks())

it('renders a bounded slice and preserves source geometry when the text layer is unavailable', async () => {
  const { pdf, render, getPage } = pdfFixture()
  const result = await capturePdfRegion(pdf, [page], region, new AbortController().signal)

  expect(getPage).toHaveBeenCalledExactlyOnceWith(3)
  expect(render).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      transform: [1, 0, 0, 1, -10, -30],
    }),
  )
  expect(result).toEqual({
    png: blob,
    width: 50,
    height: 30,
    text: '',
    textIncomplete: true,
    regions: [
      {
        pageIndex: 2,
        pageLabel: 'iv',
        section: 'Methods',
        rects: [{ x: 18, y: 9, width: 15, height: 25 }],
      },
    ],
  })
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLCanvasElement), 0, 0)
  expect((context.drawImage.mock.calls[0]?.[0] as HTMLCanvasElement).width).toBe(0)
})

it('refuses an empty crop before requesting PDF pages', async () => {
  const { pdf, getPage } = pdfFixture()

  await expect(
    capturePdfRegion(pdf, [page], { ...region, x: 0, width: 1 }, new AbortController().signal),
  ).rejects.toThrow('Choose a region over PDF pages.')
  expect(getPage).not.toHaveBeenCalled()
})

it('adds an optional source footer outside the captured pixels', async () => {
  const { pdf } = pdfFixture()
  const result = await capturePdfRegion(
    pdf,
    [page],
    region,
    new AbortController().signal,
    'Research document',
  )
  expect(result).toMatchObject({ width: 240, height: 66, regions: [{ pageIndex: 2 }] })
  expect(context.fillRect).toHaveBeenLastCalledWith(0, 30, 240, 36)
  expect(context.fillText.mock.calls).toEqual([
    ['Research document', 8, 44, 224],
    ['iv (3)', 8, 58, 224],
  ])
})

it('keeps complete lines and graphemes inside the crop in physical-page order', async () => {
  const first = document.createElement('div')
  first.innerHTML = '<span>Lead</span><br><span>A😀BC</span><span>Outside</span>'
  const next = document.createElement('div')
  next.textContent = 'Next page'
  measureText((range) => {
    switch (range.startContainer.textContent) {
      case 'Lead':
        return new DOMRect(28, 40, 14, 10)
      case 'Outside':
        return new DOMRect(50, 54, 30, 10)
      case 'Next page':
        return new DOMRect(26, 168, 22, 10)
      default: {
        if (range.toString() === 'A😀BC') return new DOMRect(15, 54, 40, 10)
        const index = [0, 1, 3, 4].indexOf(range.startOffset)
        return new DOMRect(15 + index * 10, 54, 10, 10)
      }
    }
  })
  const nextFrame = { ...frame, y: 160 }
  const { pdf, getPage } = pdfFixture()
  const result = await capturePdfRegion(
    pdf,
    [
      { ...page, textLayer: first },
      { ...page, pageIndex: 3, frame: nextFrame, textLayer: next },
    ],
    { ...region, height: 150 },
    new AbortController().signal,
  )

  expect(result.text).toBe('Lead\n😀B\n\nNext page')
  expect(result.textIncomplete).toBe(false)
  expect(getPage.mock.calls).toEqual([[3], [4]])
})

it('marks a bounded text excerpt and keeps a supplementary character intact', async () => {
  const layer = document.createElement('div')
  layer.textContent = `${'a'.repeat(15_999)}😀b`
  measureText(() => new DOMRect(28, 40, 14, 10))
  const { pdf } = pdfFixture()
  const result = await capturePdfRegion(
    pdf,
    [{ ...page, textLayer: layer }],
    region,
    new AbortController().signal,
  )
  expect(result.text).toBe('a'.repeat(15_999))
  expect(result.textIncomplete).toBe(true)
})

it('releases the stitched canvas when PNG encoding fails', async () => {
  let canvas: HTMLCanvasElement | undefined
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
    this: HTMLCanvasElement,
    reply,
  ) {
    canvas = this
    reply(null)
  })
  const { pdf } = pdfFixture()
  await expect(capturePdfRegion(pdf, [page], region, new AbortController().signal)).rejects.toThrow(
    'Could not encode the PDF capture.',
  )
  expect(canvas).toMatchObject({ width: 0, height: 0 })
})

it('cancels the running tile and releases its canvas when the tab aborts', async () => {
  const controller = new AbortController()
  const rendering = deferred<void>()
  const started = deferred<HTMLCanvasElement>()
  const { pdf, render, cancel } = pdfFixture(rendering.promise)
  render.mockImplementation((...args: unknown[]) => {
    started.resolve((args[0] as { canvas: HTMLCanvasElement }).canvas)
    return { promise: rendering.promise, cancel }
  })
  cancel.mockImplementation(() => rendering.reject(controller.signal.reason))

  const pending = capturePdfRegion(pdf, [page], region, controller.signal)
  const canvas = await started.promise
  controller.abort(new Error('Tab closed'))
  await expect(pending).rejects.toThrow('Tab closed')
  expect(cancel).toHaveBeenCalledOnce()
  expect(canvas.width).toBe(0)
  expect(context.drawImage).not.toHaveBeenCalled()
})
