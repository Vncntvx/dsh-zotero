// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bytes, host, lifetime, pdf, sawPage } from './support/pdf-runtime.ts'
import { mountPdf, type PdfSelection } from '../../../src/client/reader/pdf-runtime.ts'

it('handles page and zoom shortcuts while leaving editable controls and modified keystrokes alone', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const surface = host.shadowRoot!.querySelector('[tabindex="0"]')!
  const press = (key: string, target = surface, options?: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  const input = document.createElement('input')
  const textarea = document.createElement('textarea')
  const editable = document.createElement('div')
  Object.defineProperty(editable, 'isContentEditable', { value: true })
  surface.append(input, textarea, editable)
  expect(press('PageDown', input)).toBe(false)
  expect(press('PageDown', textarea)).toBe(false)
  expect(press('PageDown', editable)).toBe(false)
  expect(press('PageDown', surface, { altKey: true })).toBe(false)
  expect(press('PageDown', surface, { ctrlKey: true })).toBe(false)
  expect(press('PageDown', surface, { metaKey: true })).toBe(false)
  expect(press('q')).toBe(false)
  expect(sawPage.mock.lastCall?.[0].page).toBe(1)
  expect(press('PageDown')).toBe(true)
  expect(sawPage.mock.lastCall?.[0].page).toBe(2)
  expect(press('Home')).toBe(true)
  expect(sawPage.mock.lastCall?.[0].page).toBe(1)
  expect(press('+')).toBe(true)
  expect(pdf.scale).toHaveBeenLastCalledWith({ scaleFactor: 1.2, origin: undefined })
  expect(press('-')).toBe(true)
  expect(pdf.scale.mock.lastCall?.[0].scaleFactor).toBeCloseTo(1 / 1.2)
  await controls.dispose()
  expect(press('End')).toBe(false)
})

it('refits width and page modes on resize and disconnects its observer on disposal', async () => {
  let resize: (() => void) | undefined
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe
      disconnect = disconnect
      constructor(callback: () => void) {
        resize = callback
      }
    },
  )
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const visual = host.shadowRoot!.querySelector('[tabindex="0"]')!
  let width = 300
  Object.defineProperty(visual, 'clientWidth', { get: () => width })
  expect(observe).toHaveBeenCalledExactlyOnceWith(visual)
  pdf.fit.mockClear()
  resize!()
  resize!()
  expect(pdf.fit).toHaveBeenCalledExactlyOnceWith('page-width')
  controls.fit('page-fit')
  width = 400
  resize!()
  expect(pdf.fit.mock.calls).toEqual([['page-width'], ['page-fit'], ['page-fit']])
  controls.zoom(1.2)
  pdf.fit.mockClear()
  width = 500
  resize!()
  expect(pdf.fit).not.toHaveBeenCalled()
  await controls.dispose()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('captures the intersecting PDF page interior and keeps its printed label and provenance', async () => {
  const render = vi.fn(() => ({ promise: Promise.resolve() }))
  pdf.page.mockResolvedValue({
    render,
    getViewport: ({ scale }: { scale: number }) => ({
      width: 160 * scale,
      height: 100 * scale,
      convertToPdfPoint: (x: number, y: number) => [x / scale, 100 - y / scale],
    }),
  })
  const bitmap = new Blob(['page crop'], { type: 'image/png' })
  const fillText = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText,
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((reply) => reply(bitmap))
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  await controls.getOutline()
  const first = host.shadowRoot!.querySelector<HTMLElement>('[data-page-number="1"]')!
  const second = host.shadowRoot!.querySelector<HTMLElement>('[data-page-number="2"]')!
  first.getBoundingClientRect = () => new DOMRect(0, -300, 162, 102)
  second.getBoundingClientRect = () => new DOMRect(0, 50, 162, 102)
  Object.defineProperties(second, {
    clientTop: { value: 1 },
    clientLeft: { value: 1 },
    clientWidth: { value: 160 },
  })
  second.querySelector<HTMLElement>('.textLayer')!.hidden = true
  await expect(
    controls.capture({ x: 0, y: 45, width: 31, height: 16 }, lifetime.signal, 'Paper PDF'),
  ).resolves.toMatchObject({
    png: bitmap,
    width: 240,
    height: 56,
    textIncomplete: true,
    regions: [
      {
        pageIndex: 1,
        pageLabel: '1',
        section: 'Results',
        rects: [{ x: 0, y: 90, width: 30, height: 10 }],
      },
    ],
  })
  expect(pdf.page).toHaveBeenCalledExactlyOnceWith(2)
  expect(render).toHaveBeenCalledOnce()
  expect(fillText).toHaveBeenCalledWith('Paper PDF', expect.any(Number), expect.any(Number), 224)
  await controls.dispose()
})

it('keeps cross-page excerpts readable when a line loses its annotation geometry', async () => {
  const onSelection = vi.fn<(selection: PdfSelection | undefined) => void>()
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, undefined, { onSelection })
  const root = host.shadowRoot!
  const [first, second] = root.querySelectorAll('.textLayer')
  const firstLine = document.createTextNode('Placebo baseline')
  const nextLine = document.createTextNode('matched.')
  const secondLine = document.createTextNode('Treatment effect increased.')
  first!.replaceChildren(firstLine, document.createElement('br'), nextLine)
  second!.replaceChildren(secondLine)
  const range = document.createRange()
  range.setStart(firstLine, 8)
  range.setEnd(secondLine, 16)
  const getRangeAt = vi.fn(() => range)
  Object.defineProperty(root, 'getSelection', { value: () => ({ rangeCount: 1, getRangeAt }) })
  const surface = root.querySelector<HTMLElement>('[tabindex="0"]')!
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 160, 100)

  let nextLineVisible = true
  const rects = function (this: Range) {
    if (this.startContainer === firstLine) return [new DOMRect(10, 64, 38, 8)]
    if (this.startContainer === nextLine)
      return nextLineVisible ? [new DOMRect(10, 76, 44, 8)] : [new DOMRect(170, 76, 44, 8)]
    return [new DOMRect(20, 5, 58, 8)]
  }
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: rects })
  try {
    surface.dispatchEvent(new Event('pointerup'))
    const selected = {
      text: 'baseline\nmatched.\nTreatment effect',
      nearBottom: true,
      canAnnotate: true,
      pages: [
        {
          pageIndex: 0,
          pageLabel: 'iv',
          text: 'baseline\nmatched.',
          textOffset: 8,
          top: 64,
          rects: [
            { x: 10, y: 28, width: 38, height: 8 },
            { x: 10, y: 16, width: 44, height: 8 },
          ],
        },
        {
          pageIndex: 1,
          pageLabel: '1',
          text: 'Treatment effect',
          textOffset: 0,
          top: 5,
          rects: [{ x: 20, y: 87, width: 58, height: 8 }],
        },
      ],
    }
    expect(onSelection).toHaveBeenLastCalledWith(selected)

    nextLineVisible = false
    document.dispatchEvent(new Event('selectionchange'))
    expect(onSelection).toHaveBeenLastCalledWith({
      ...selected,
      canAnnotate: false,
      pages: [
        { ...selected.pages[0], rects: selected.pages[0]!.rects.slice(0, 1) },
        selected.pages[1],
      ],
    })
    range.collapse()
    surface.dispatchEvent(new Event('keyup'))
    expect(onSelection).toHaveBeenLastCalledWith(undefined)
    await controls.dispose()
    onSelection.mockClear()
    document.dispatchEvent(new Event('selectionchange'))
    expect(onSelection).not.toHaveBeenCalled()
  } finally {
    Reflect.deleteProperty(Range.prototype, 'getClientRects')
  }
})
