import { afterEach, beforeEach, vi } from 'vitest'
import type { mountPdf } from '../../../../src/client/reader/pdf-runtime.ts'

const pdf = vi.hoisted(() => ({
  load: vi.fn(),
  page: vi.fn(),
  bus: undefined as { dispatch(name: string, detail?: unknown): void } | undefined,
  destroy: vi.fn(async () => {}),
  destroyBridge: vi.fn(),
  detach: vi.fn(),
  destination: vi.fn(async () => {}),
  feed: vi.fn(),
  fit: vi.fn(),
  scale: vi.fn(),
  viewerOptions: vi.fn(),
}))

export { pdf }

vi.mock('pdfjs-dist', () => ({
  AnnotationEditorType: { DISABLE: -1 },
  AnnotationMode: { ENABLE: 1 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: pdf.load,
  PDFWorker: { create: () => ({ destroy: pdf.destroyBridge }) },
}))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  const FindState = { FOUND: 0, NOT_FOUND: 1, WRAPPED: 2, PENDING: 3 }
  class EventBus {
    private readonly target = new EventTarget()
    on(name: string, listener: (event: unknown) => void, options?: AddEventListenerOptions) {
      this.target.addEventListener(
        name,
        (event) => listener((event as CustomEvent).detail),
        options,
      )
    }
    dispatch(name: string, detail?: unknown) {
      pdf.feed(name, detail)
      this.target.dispatchEvent(new CustomEvent(name, { detail }))
    }
  }
  class PDFViewer {
    private readonly pageViews = new Map<number, { div: HTMLElement }>()
    private page = 1
    private rotation = 0
    currentScale = 1
    private scaleValue = 'page-width'
    firstPagePromise = Promise.resolve()
    constructor(private readonly options: { viewer: HTMLElement; eventBus: EventBus }) {
      pdf.viewerOptions(options)
      pdf.bus = options.eventBus
    }
    setDocument(documentRef: { numPages: number } | null) {
      if (!documentRef) {
        pdf.detach()
        this.pageViews.clear()
        return
      }
      for (let number = 1; number <= documentRef.numPages; number++) {
        const div = document.createElement('div')
        div.className = 'page'
        div.dataset.pageNumber = String(number)
        div.dataset.loaded = 'true'
        Object.defineProperty(div, 'clientHeight', { value: 100 })
        div.getBoundingClientRect = () => new DOMRect(0, -10, 160, 100)
        const layer = document.createElement('div')
        layer.className = 'textLayer'
        layer.getBoundingClientRect = () => new DOMRect(0, 0, 160, 100)
        layer.append(`Text for page ${number}`)
        div.append(layer)
        this.options.viewer.append(div)
        this.pageViews.set(number - 1, { div })
      }
      this.options.eventBus.dispatch('pagesinit')
    }
    setPageLabels() {}
    get currentScaleValue() {
      return this.scaleValue
    }
    set currentScaleValue(value: string) {
      this.scaleValue = value
      pdf.fit(value)
    }
    getPageView(index: number) {
      const page = this.pageViews.get(index)
      if (!page) return undefined
      return {
        ...page,
        pdfPage: { view: [0, 0, 160, 100] },
        viewport: {
          width: 160,
          height: 100,
          rotation: this.pagesRotation,
          convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
          convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
        },
      }
    }
    get currentPageNumber() {
      return this.page
    }
    set currentPageNumber(value: number) {
      this.page = value
      this.options.eventBus.dispatch('pagechanging')
      this.options.eventBus.dispatch('updateviewarea')
    }
    get pagesRotation() {
      return this.rotation
    }
    set pagesRotation(value: number) {
      this.rotation = value
      this.options.eventBus.dispatch('rotationchanging')
    }
    updateScale(options: { scaleFactor: number }) {
      pdf.scale(options)
      this.currentScale *= options.scaleFactor
      this.currentScaleValue = String(this.currentScale)
      this.options.eventBus.dispatch('updateviewarea')
    }
  }
  return {
    EventBus,
    FindState,
    PDFViewer,
    PDFFindController: class {},
    PDFLinkService: class {
      externalLinkEnabled = true
      goToDestination = pdf.destination
      setDocument() {}
      setViewer() {}
    },
  }
})

export const terminate = vi.fn()
export const revoke = vi.fn()
export let worker: EventTarget
export let host: HTMLDivElement
export let lifetime: AbortController
export const bytes = new Uint8Array()
export const sawPage = vi.fn<Parameters<typeof mountPdf>[3]>()

beforeEach(() => {
  vi.clearAllMocks()
  pdf.bus = undefined
  pdf.page.mockImplementation(async (number: number) => ({
    rotate: 0,
    getViewport: () => ({
      width: 160,
      height: 100,
      convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
      convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
    }),
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: [{ str: `Text for page ${number}` }] })
          controller.close()
        },
      }),
  }))
  host = document.createElement('div')
  document.body.append(host)
  lifetime = new AbortController()
  class ReaderWorker extends EventTarget {
    terminate = terminate
    constructor() {
      super()
      worker = this
    }
  }
  vi.stubGlobal('Worker', ReaderWorker)
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: () => 'blob:pdf-test',
      revokeObjectURL: revoke,
    }),
  )
  pdf.load.mockImplementation(() => ({
    destroy: pdf.destroy,
    promise: Promise.resolve({
      numPages: 2,
      getPage: pdf.page,
      fingerprints: ['fixture-copy'],
      getPageLabels: async () => ['iv', '1'],
      getOutline: async () => [
        { title: 'Opening', dest: [0, { name: 'Fit' }] },
        { title: 'Methods', dest: 'method', items: [{ title: 'Results', dest: [{ num: 7 }] }] },
        { title: 'Unresolved', dest: 'broken' },
      ],
      getDestination: async (name: string) => {
        if (name === 'broken') throw new Error('Invalid destination')
        return [1, { name: 'Fit' }]
      },
      getPageIndex: async () => 1,
    }),
  }))
})

afterEach(() => {
  lifetime.abort()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
