import {
  AnnotationEditorType,
  AnnotationMode,
  getDocument,
  PasswordResponses,
  PDFWorker,
} from 'pdfjs-dist'
import {
  EventBus,
  FindState,
  PDFLinkService,
  PDFViewer,
  PDFFindController,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { ReadingState } from '../../reader/reading-state.ts'
import type { ZoteroAnnotationRowView } from '../../contract.ts'
import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view.d.ts'
import type {
  PdfAnnotationSelectionPage,
  PdfArtifactRegion,
  PdfEvidenceQuote,
  PdfPageRegion,
  PdfRect,
} from '../../reader/evidence.ts'
import { raceWithSignal } from '../../race-signal.ts'
import { stylesheet, workerSource } from 'reader-pdf-assets'
import { annotationColorOf } from './annotation-color.ts'
import { capturePdfRegion } from './pdf-capture.ts'
import {
  locatePdfQuote,
  pdfQuoteRects,
  pdfTextRect,
  type PdfEvidenceMatch,
} from './pdf-evidence.ts'
import { excerptPrefix, MAX_EXCERPT_TEXT, readPdfExcerpt } from './pdf-excerpt.ts'

type PdfPosition = Pick<ReadingState, 'pageIndex' | 'pageOffset' | 'zoom' | 'fitMode' | 'rotation'>

export interface PdfOutline {
  readonly id: string
  readonly title: string
  readonly destination: string | unknown[] | null
  readonly pageIndex?: number
  readonly children: readonly PdfOutline[]
}

async function outlinePageIndex(
  destination: PdfOutline['destination'],
  pdf: Awaited<ReturnType<typeof getDocument>['promise']>,
) {
  if (!destination) return undefined
  try {
    const explicit =
      typeof destination === 'string' ? await pdf.getDestination(destination) : destination
    if (!Array.isArray(explicit)) return undefined
    const page = explicit[0]
    if (typeof page === 'number') return Number.isInteger(page) && page >= 0 ? page : undefined
    return await pdf.getPageIndex(page as Parameters<typeof pdf.getPageIndex>[0])
  } catch {
    return undefined
  }
}

async function outlineTree(
  items: readonly { title: string; dest: string | unknown[] | null; items?: unknown }[],
  pdf: Awaited<ReturnType<typeof getDocument>['promise']>,
  path: readonly number[] = [],
  depth = 0,
): Promise<readonly PdfOutline[]> {
  if (depth >= 20) return []
  return await Promise.all(
    items.map(async ({ title, dest, items: children }, index) => ({
      id: [...path, index].join('.'),
      title,
      destination: dest,
      pageIndex: await outlinePageIndex(dest, pdf),
      children: Array.isArray(children)
        ? await outlineTree(
            children as Parameters<typeof outlineTree>[0],
            pdf,
            [...path, index],
            depth + 1,
          )
        : [],
    })),
  )
}

function outlineAtPage(items: readonly PdfOutline[], pageIndex: number): PdfOutline | undefined {
  let active: PdfOutline | undefined
  for (const item of items) {
    if (
      item.pageIndex !== undefined &&
      item.pageIndex <= pageIndex &&
      (active?.pageIndex === undefined || item.pageIndex >= active.pageIndex)
    )
      active = item
    const child = outlineAtPage(item.children, pageIndex)
    if (
      child?.pageIndex !== undefined &&
      (active?.pageIndex === undefined || child.pageIndex >= active.pageIndex)
    )
      active = child
  }
  return active
}

interface PdfPreferences {
  restore: (fingerprint: string) => PdfPosition | undefined
  onPosition: (position: PdfPosition) => void
}

export interface PdfView {
  readonly page: number
  readonly count: number
  readonly label?: string
  readonly fingerprint: string
  readonly sectionId?: string
  readonly sectionTitle?: string
}

export interface PdfFindStatus {
  readonly state?: 'pending' | 'found' | 'not-found' | 'wrapped'
  readonly current: number
  readonly total: number
}

export interface PdfSelection {
  readonly text: string
  readonly pages: readonly PdfAnnotationSelectionPage[]
  readonly canAnnotate: boolean
  readonly textTruncated?: boolean
  /**
   * The selection starts in the lower part of the pane, where a bar pinned to
   * the bottom edge would sit on top of what was just selected.
   */
  readonly nearBottom?: boolean
}

export interface PdfPasswordRequest {
  readonly incorrect: boolean
  readonly submit: (password: string) => void
}

export type PdfEvidenceLocation =
  | Exclude<PdfEvidenceMatch, { kind: 'unique' }>
  | { readonly kind: 'region' | 'page'; readonly pageIndex: number; readonly endPageIndex?: number }

interface PdfInteractions {
  readonly onPassword?: (request: PdfPasswordRequest) => void
  readonly onSelection?: (selection: PdfSelection | undefined) => void
  readonly onAnnotationPick?: (refs: readonly string[]) => void
  readonly onFindStatus?: (status: PdfFindStatus) => void
}

export async function mountPdf(
  host: HTMLElement,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  onPage: (view: PdfView) => void,
  preferences?: PdfPreferences,
  { onPassword, onSelection, onAnnotationPick, onFindStatus }: PdfInteractions = {},
) {
  signal.throwIfAborted()
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = stylesheet
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;inset:0;overflow:auto'
  container.tabIndex = 0
  const pages = document.createElement('div')
  pages.className = 'pdfViewer'
  container.append(pages)
  root.replaceChildren(style, container)

  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  const lifetime = new AbortController()
  let worker: Worker | undefined
  let bridge: PDFWorker | undefined
  let task: ReturnType<typeof getDocument> | undefined
  let detachViewer: (() => void) | undefined
  let stopRefit: (() => void) | undefined
  let rejectFailure!: (reason: unknown) => void
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject
  })
  const workerFailed = () => rejectFailure(new Error('PDF.js worker failed'))
  let disposal: Promise<void> | undefined
  const dispose = () => {
    if (disposal) return disposal
    lifetime.abort()
    signal.removeEventListener('abort', dispose)
    rejectFailure(signal.reason)
    try {
      stopRefit?.()
      detachViewer?.()
    } finally {
      container.remove()
      style.remove()
      const destroy = task?.destroy()
      disposal = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1000)
        void (destroy ?? Promise.resolve())
          .then(resolve, resolve)
          .finally(() => clearTimeout(timeout))
      }).finally(() => {
        bridge?.destroy()
        worker?.terminate()
        URL.revokeObjectURL(workerUrl)
      })
    }
    return disposal
  }
  signal.addEventListener('abort', dispose, { once: true })
  // Observe cancellation even if the native Worker constructor fails first.
  void failed.catch(() => undefined)
  try {
    // Web Crypto snapshots the bytes before PDF.js transfers them to its worker.
    const digest = globalThis.crypto?.subtle?.digest('SHA-256', data).then(
      (bytes) =>
        `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
      () => undefined,
    )
    worker = new Worker(workerUrl, { type: 'module', name: 'zotero-reader' })
    worker.addEventListener('error', workerFailed, { signal: lifetime.signal })
    worker.addEventListener('messageerror', workerFailed, { signal: lifetime.signal })
    bridge = PDFWorker.create({ port: worker })
    task = getDocument({
      data,
      worker: bridge,
      enableXfa: false,
      useWorkerFetch: false,
      stopAtErrors: true,
    })
    if (onPassword) {
      task.onPassword = (update: (password: string) => void, reason: number) => {
        if (lifetime.signal.aborted) return
        let submitted = false
        onPassword({
          incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
          submit(password) {
            if (submitted || lifetime.signal.aborted) return
            submitted = true
            update(password)
          },
        })
      }
    }
    const pdf = await Promise.race([task.promise, failed])
    const labels = await Promise.race([pdf.getPageLabels(), failed])
    signal.throwIfAborted()
    let outline: readonly PdfOutline[] = []
    const outlineReady = pdf.getOutline().then(async (items) => {
      outline = await outlineTree(items ?? [], pdf)
      return outline
    })
    void outlineReady.catch(() => undefined)
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    linkService.externalLinkEnabled = false
    const findController = new PDFFindController({ eventBus, linkService })
    const reportFindStatus = (event: {
      readonly matchesCount: { readonly current: number; readonly total: number }
      readonly state?: number
    }) => {
      onFindStatus?.({
        ...(event.state === undefined
          ? {}
          : {
              state:
                event.state === FindState.PENDING
                  ? 'pending'
                  : event.state === FindState.NOT_FOUND
                    ? 'not-found'
                    : event.state === FindState.WRAPPED
                      ? 'wrapped'
                      : 'found',
            }),
        current: event.matchesCount.current,
        total: event.matchesCount.total,
      })
    }
    eventBus.on('updatefindcontrolstate', reportFindStatus, { signal: lifetime.signal })
    eventBus.on('updatefindmatchescount', reportFindStatus, { signal: lifetime.signal })
    // The pinned viewer implements abortSignal even though its declaration omits it.
    const options = {
      container,
      viewer: pages,
      eventBus,
      linkService,
      findController,
      abortSignal: lifetime.signal,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      annotationMode: AnnotationMode.ENABLE,
      enableAutoLinking: false,
      maxCanvasPixels: 16_777_216,
      // The viewer's canvas selection renderer reads `document.getSelection()`,
      // which retargets to the shadow host: it paints nothing, while its
      // `selectionRendering` class turns the native highlight transparent, so the
      // reader showed no selection at all. Native `::selection` works here.
      enableSelectionRendering: false,
    }
    const viewer = new PDFViewer(options)
    const fingerprint =
      (await Promise.race([digest, failed])) ??
      `pdfjs:${pdf.fingerprints.filter(Boolean).join(':')}`
    // PDFViewer follows its container's height but never its width, so a panel
    // toggle or a sidebar drag leaves a fit mode at the old scale and the page
    // hangs out of the viewport. Re-apply the fit mode when the width changes.
    let fittedWidth = 0
    const refit = () => {
      const width = container.clientWidth
      if (width === 0 || width === fittedWidth) return
      fittedWidth = width
      const value = viewer.currentScaleValue
      if (value === 'page-width' || value === 'page-fit') viewer.currentScaleValue = value
    }
    // jsdom has no ResizeObserver; the behaviour is exercised by the browser smoke.
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : undefined
    resized?.observe(container)
    stopRefit = () => resized?.disconnect()
    // PDFViewer uses null to cancel every page task and reset the view.
    detachViewer = () => viewer.setDocument(null!)
    const updatePage = () => {
      const section = outlineAtPage(outline, viewer.currentPageNumber - 1)
      onPage({
        page: viewer.currentPageNumber,
        count: pdf.numPages,
        fingerprint,
        label: labels?.[viewer.currentPageNumber - 1],
        ...(section ? { sectionId: section.id, sectionTitle: section.title } : {}),
      })
    }
    let initialize!: () => void
    const initialized = new Promise<void>((resolve) => {
      initialize = resolve
    })
    const goTo = (page: number) => {
      if (Number.isInteger(page) && page >= 1 && page <= pdf.numPages)
        viewer.currentPageNumber = page
    }
    const zoom = (factor: number, origin?: number[]) => {
      const scale = Math.min(4, Math.max(0.25, viewer.currentScale * factor))
      viewer.updateScale({ scaleFactor: scale / viewer.currentScale, origin })
    }
    container.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        const factor = Math.exp(Math.max(-0.35, Math.min(0.35, -event.deltaY / 400)))
        zoom(factor, [event.clientX, event.clientY])
      },
      { passive: false, signal: lifetime.signal },
    )
    container.addEventListener(
      'keydown',
      (event) => {
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.defaultPrevented ||
          (event.target instanceof HTMLInputElement && event.target.type !== 'range') ||
          event.target instanceof HTMLTextAreaElement ||
          (event.target instanceof HTMLElement && event.target.isContentEditable)
        )
          return
        if (event.key === '+' || event.key === '-') zoom(event.key === '+' ? 1.2 : 1 / 1.2)
        else if (event.key === 'Home' || event.key === 'End')
          goTo(event.key === 'Home' ? 1 : pdf.numPages)
        else if (event.key === 'PageUp' || event.key === 'ArrowUp')
          goTo(viewer.currentPageNumber - 1)
        else if (event.key === 'PageDown' || event.key === 'ArrowDown')
          goTo(viewer.currentPageNumber + 1)
        else return
        event.preventDefault()
      },
      { signal: lifetime.signal },
    )
    const pageElement = (page: number) =>
      pages.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`)
    const selectedEndpoints = () => {
      const selection =
        (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ??
        document.getSelection()
      if (!selection?.rangeCount) return undefined
      // WebKit can report a collapsed document selection when its endpoints
      // have been retargeted to the same shadow host.
      const endpoints =
        selection.getComposedRanges?.({ shadowRoots: [root] })[0] ?? selection.getRangeAt(0)
      if (
        (endpoints.startContainer === endpoints.endContainer &&
          endpoints.startOffset === endpoints.endOffset) ||
        !root.contains(endpoints.startContainer) ||
        !root.contains(endpoints.endContainer)
      )
        return undefined
      return endpoints
    }
    function reportSelection() {
      const endpoints = selectedEndpoints()
      if (!onSelection || !endpoints) return onSelection?.(undefined)
      const range = document.createRange()
      range.setStart(endpoints.startContainer, endpoints.startOffset)
      range.setEnd(endpoints.endContainer, endpoints.endOffset)
      const textPageOf = (node: Node) => {
        const element = node instanceof Element ? node : node.parentElement
        return Number(
          element?.closest('.textLayer')?.closest<HTMLElement>('.page')?.dataset.pageNumber,
        )
      }
      const firstPage = textPageOf(range.startContainer)
      const lastPage = textPageOf(range.endContainer)
      let complete = Number.isInteger(firstPage) && Number.isInteger(lastPage)
      let textTruncated = false
      const selectedPages: PdfAnnotationSelectionPage[] = []
      // Where the first selected line sits in the pane, so the caller can move
      // the selection's actions to the other edge instead of covering it.
      let anchorTop: number | undefined
      for (const layer of pages.querySelectorAll<HTMLElement>('.page[data-loaded] .textLayer')) {
        if (!range.intersectsNode(layer)) continue
        const parent = layer.closest<HTMLElement>('.page[data-page-number]')
        const pageIndex = Number(parent?.dataset.pageNumber) - 1
        const page = viewer.getPageView(pageIndex) as PDFPageView | undefined
        if (!page?.pdfPage) continue
        const segment = range.cloneRange()
        if (!layer.contains(segment.startContainer)) segment.setStart(layer, 0)
        if (!layer.contains(segment.endContainer)) segment.setEnd(layer, layer.childNodes.length)
        const frame = layer.getBoundingClientRect()
        const { viewport } = page
        const rects: PdfRect[] = []
        const textParts: string[] = []
        const walker = document.createTreeWalker(
          layer,
          NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) =>
              node instanceof Text || node instanceof HTMLBRElement
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP,
          },
        )
        const fragment = document.createRange()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!segment.intersectsNode(node)) continue
          if (!(node instanceof Text)) {
            textParts.push('\n')
            continue
          }
          const start = node === segment.startContainer ? segment.startOffset : 0
          const end = node === segment.endContainer ? segment.endOffset : node.length
          if (end <= start) continue
          const text = node.data.slice(start, end)
          textParts.push(text)
          if (!text.trim()) continue
          fragment.setStart(node, start)
          fragment.setEnd(node, end)
          let placed = false
          for (const rect of fragment.getClientRects()) {
            if (rects.length >= 1024) break
            const mapped = pdfTextRect(rect, frame, viewport)
            if (!mapped) continue
            anchorTop ??= rect.top
            rects.push(mapped)
            placed = true
          }
          if (!placed) complete = false
        }
        const text = textParts.join('').trim()
        if (!text) continue
        if (text.length > MAX_EXCERPT_TEXT) textTruncated = true
        if (textTruncated || !rects.length || rects.length === 1024) complete = false
        const prefix = document.createRange()
        prefix.setStart(layer, 0)
        prefix.setEnd(segment.startContainer, segment.startOffset)
        selectedPages.push({
          pageIndex,
          rects,
          text: excerptPrefix(text, MAX_EXCERPT_TEXT),
          pageLabel: labels?.[pageIndex] || String(pageIndex + 1),
          textOffset: Math.min(prefix.toString().length, 999999),
          top:
            rects.length === 0
              ? 0
              : Math.min(
                  99999,
                  Math.max(
                    0,
                    Math.floor(
                      page.pdfPage.view[3]! -
                        Math.max(...rects.map((rect) => rect.y + rect.height)),
                    ),
                  ),
                ),
        })
      }
      const text = selectedPages.map((page) => page.text).join('\n')
      // jsdom reports a zero-height pane, so the flip only ever engages on a
      // real pane; the browser smoke covers it.
      const pane = container.getBoundingClientRect()
      const nearBottom =
        anchorTop !== undefined && pane.height > 0 && anchorTop - pane.top > pane.height * 0.6
      textTruncated ||= text.length > MAX_EXCERPT_TEXT
      onSelection(
        text
          ? {
              text: excerptPrefix(text, MAX_EXCERPT_TEXT),
              pages: selectedPages,
              ...(textTruncated ? { textTruncated: true } : {}),
              canAnnotate:
                complete && selectedPages.length === lastPage - firstPage + 1 && !textTruncated,
              nearBottom,
            }
          : undefined,
      )
    }
    if (onSelection) {
      document.addEventListener('selectionchange', reportSelection, { signal: lifetime.signal })
      container.addEventListener('pointerup', reportSelection, { signal: lifetime.signal })
      container.addEventListener('keyup', reportSelection, { signal: lifetime.signal })
    }
    if (onAnnotationPick) {
      container.addEventListener(
        'click',
        (event) => {
          const { target, clientX, clientY } = event
          if (!(target instanceof Element) || target.closest('a, button, input, textarea, select'))
            return
          if (selectedEndpoints()) return
          const page = target.closest('.page')
          if (!page) return
          const refs = new Set<string>()
          for (const mark of page.querySelectorAll<HTMLElement>(
            '.zoteroAnnotations [data-annotation]',
          )) {
            const { left, top, right, bottom } = mark.getBoundingClientRect()
            if (clientX >= left && clientX < right && clientY >= top && clientY < bottom)
              refs.add(mark.dataset.annotation!)
          }
          if (refs.size) onAnnotationPick([...refs])
        },
        { signal: lifetime.signal },
      )
    }
    let annotations: readonly ZoteroAnnotationRowView[] = []
    let selectedAnnotation: string | undefined
    let evidence: PdfPageRegion | undefined
    // Both layers take their chrome from the shadow theme block that the PDF
    // chunk build appends, so only geometry is set here.
    const paintAnnotations = (pageNumber: number) => {
      const view = viewer.getPageView(pageNumber - 1) as PDFPageView | undefined
      if (!view?.pdfPage) return
      view.div.querySelector('.zoteroAnnotations')?.remove()
      const layer = document.createElement('div')
      layer.className = 'zoteroAnnotations'
      layer.setAttribute('aria-hidden', 'true')
      const { viewport } = view
      for (const annotation of annotations) {
        if (annotation.position?.pageIndex !== pageNumber - 1) continue
        const { type } = annotation
        if (type !== 'highlight' && type !== 'underline') continue
        let showComment = Boolean(annotation.comment?.trim())
        for (const { x, y, width, height } of annotation.position.rects) {
          const [x1, y1] = viewport.convertToViewportPoint(x, y) as [number, number]
          const [x2, y2] = viewport.convertToViewportPoint(x + width, y + height) as [
            number,
            number,
          ]
          const left = Math.max(0, Math.min(x1, x2))
          const top = Math.max(0, Math.min(y1, y2))
          const right = Math.min(viewport.width, Math.max(x1, x2))
          const bottom = Math.min(viewport.height, Math.max(y1, y2))
          if (right <= left || bottom <= top) continue
          const mark = document.createElement('span')
          mark.dataset.annotation = annotation.ref
          if (annotation.ref === selectedAnnotation) mark.className = 'zoteroAnnotationSelected'
          Object.assign(mark.style, {
            position: 'absolute',
            left: `${(100 * left) / viewport.width}%`,
            top: `${(100 * top) / viewport.height}%`,
            width: `${(100 * (right - left)) / viewport.width}%`,
            height: `${(100 * (bottom - top)) / viewport.height}%`,
          })
          const paint = annotationColorOf(annotation.color)
          if (type === 'highlight') {
            mark.style.backgroundColor = paint
            mark.style.opacity = '.35'
          } else {
            const onSide = viewport.rotation % 180 === 90
            const border = `2px solid ${paint}`
            if (onSide && viewport.rotation === 90) mark.style.borderLeft = border
            else if (onSide) mark.style.borderRight = border
            else if (viewport.rotation === 180) mark.style.borderTop = border
            else mark.style.borderBottom = border
          }
          layer.append(mark)
          if (showComment) {
            const indicator = document.createElement('span')
            indicator.className = 'zoteroAnnotationComment'
            indicator.dataset.annotation = annotation.ref
            indicator.style.left = `${(100 * right) / viewport.width}%`
            indicator.style.top = mark.style.top
            layer.append(indicator)
            showComment = false
          }
        }
      }
      if (layer.hasChildNodes()) view.div.append(layer)
    }
    const repaintOverlays = () => {
      for (const page of pages.querySelectorAll<HTMLElement>('.page[data-loaded]'))
        paintOverlays(Number(page.dataset.pageNumber))
    }
    function paintEvidence(pageNumber: number) {
      const view = viewer.getPageView(pageNumber - 1) as PDFPageView | undefined
      if (!view?.pdfPage) return
      view.div.querySelector('.zoteroEvidence')?.remove()
      if (evidence?.pageIndex !== pageNumber - 1) return
      const layer = document.createElement('div')
      layer.className = 'zoteroEvidence'
      layer.setAttribute('aria-hidden', 'true')
      const { viewport } = view
      for (const { x, y, width, height } of evidence.rects) {
        const [x1, y1] = viewport.convertToViewportPoint(x, y) as [number, number]
        const [x2, y2] = viewport.convertToViewportPoint(x + width, y + height) as [number, number]
        const left = Math.max(0, Math.min(x1, x2))
        const top = Math.max(0, Math.min(y1, y2))
        const right = Math.min(viewport.width, Math.max(x1, x2))
        const bottom = Math.min(viewport.height, Math.max(y1, y2))
        if (right <= left || bottom <= top) continue
        const mark = document.createElement('span')
        mark.className = 'zoteroEvidenceRegion'
        Object.assign(mark.style, {
          position: 'absolute',
          left: `${(100 * left) / viewport.width}%`,
          top: `${(100 * top) / viewport.height}%`,
          width: `${(100 * (right - left)) / viewport.width}%`,
          height: `${(100 * (bottom - top)) / viewport.height}%`,
        })
        layer.append(mark)
      }
      if (layer.hasChildNodes()) view.div.append(layer)
    }
    function paintOverlays(pageNumber: number) {
      paintAnnotations(pageNumber)
      paintEvidence(pageNumber)
    }
    async function locateEvidence(
      { quote }: PdfEvidenceQuote,
      request: AbortSignal,
    ): Promise<PdfEvidenceLocation> {
      const signal = AbortSignal.any([request, lifetime.signal])
      const match = await locatePdfQuote(pdf, quote, signal)
      signal.throwIfAborted()
      if (match.kind !== 'unique') return match
      const { pageIndex, endPageIndex } = match
      const pageNumber = pageIndex + 1
      goTo(pageNumber)
      if (endPageIndex !== pageIndex) return { kind: 'page', pageIndex, endPageIndex }
      const currentTextLayer = () =>
        pageElement(pageNumber)?.querySelector<HTMLElement>('.textLayer:not([hidden])')
      let layer = currentTextLayer()
      if (!layer) {
        const listener = new AbortController()
        let timer: number | undefined
        try {
          layer = await raceWithSignal(
            new Promise<HTMLElement | undefined>((resolve) => {
              eventBus.on(
                'textlayerrendered',
                (event: { pageNumber: number }) => {
                  if (event.pageNumber === pageNumber) resolve(currentTextLayer() ?? undefined)
                },
                { signal: listener.signal },
              )
              timer = window.setTimeout(resolve, 2_000)
            }),
            signal,
          )
        } finally {
          window.clearTimeout(timer)
          listener.abort()
        }
      }
      signal.throwIfAborted()
      const view = viewer.getPageView(pageIndex) as PDFPageView | undefined
      if (!layer || !view) return { kind: 'page', pageIndex }
      const rects = pdfQuoteRects(layer, view.viewport, quote)
      if (!rects.length) return { kind: 'page', pageIndex }
      evidence = { pageIndex, rects }
      paintEvidence(pageNumber)
      const mark = view.div.querySelector('.zoteroEvidenceRegion')
      if (mark && viewer.currentPageNumber === pageNumber) {
        const pane = container.getBoundingClientRect()
        const pageTop = view.div.getBoundingClientRect().top
        const markTop = mark.getBoundingClientRect().top
        container.scrollTop += Math.max(pageTop, markTop - pane.height / 3) - pane.top
      }
      return { kind: 'region', pageIndex }
    }
    async function artifactViewport(pageIndex: number, request: AbortSignal) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) return
      const signal = AbortSignal.any([request, lifetime.signal])
      const page = await raceWithSignal(pdf.getPage(pageIndex + 1), signal)
      signal.throwIfAborted()
      // The stored layout convention is verified for upright source pages.
      if (page.rotate === 0) return page.getViewport({ scale: 1 })
    }
    eventBus.on(
      'pagerendered',
      (event: { pageNumber: number }) => {
        paintOverlays(event.pageNumber)
      },
      { signal: lifetime.signal },
    )
    eventBus.on('rotationchanging', repaintOverlays, { signal: lifetime.signal })
    eventBus.on(
      'pagesinit',
      () => {
        const position = preferences?.restore(fingerprint)
        if (position) viewer.pagesRotation = position.rotation
        viewer.currentScaleValue =
          position?.fitMode === 'free'
            ? String(position.zoom)
            : position?.fitMode === 'page'
              ? 'page-fit'
              : 'page-width'
        if (position) {
          goTo(position.pageIndex + 1)
          const page = pageElement(viewer.currentPageNumber)
          if (page) container.scrollTop += page.clientHeight * position.pageOffset
        }
        const reportPosition = () => {
          const pageIndex = viewer.currentPageNumber - 1
          const page = pageElement(pageIndex + 1)
          const offset =
            page && page.clientHeight > 0
              ? (container.getBoundingClientRect().top - page.getBoundingClientRect().top) /
                page.clientHeight
              : 0
          preferences?.onPosition({
            pageIndex,
            pageOffset: Math.min(1, Math.max(0, offset)),
            zoom: viewer.currentScale,
            fitMode:
              viewer.currentScaleValue === 'page-width'
                ? 'width'
                : viewer.currentScaleValue === 'page-fit'
                  ? 'page'
                  : 'free',
            rotation: viewer.pagesRotation as PdfPosition['rotation'],
          })
        }
        eventBus.on('updateviewarea', reportPosition, { signal: lifetime.signal })
        updatePage()
        reportPosition()
        initialize()
      },
      { once: true, signal: lifetime.signal },
    )
    eventBus.on('pagechanging', updatePage, { signal: lifetime.signal })
    linkService.setDocument(pdf)
    linkService.setViewer(viewer)
    viewer.setDocument(pdf)
    if (labels) viewer.setPageLabels(labels)
    await Promise.race([Promise.resolve(viewer.firstPagePromise).then(() => initialized), failed])
    signal.throwIfAborted()

    return {
      goTo,
      pageLabel: (pageIndex: number) => labels?.[pageIndex] || String(pageIndex + 1),
      readExcerpt: (start: number, end: number, excerptSignal: AbortSignal) =>
        readPdfExcerpt(pdf, labels, start, end, AbortSignal.any([excerptSignal, lifetime.signal])),
      capture(region: PdfRect, captureSignal: AbortSignal, sourceTitle?: string) {
        const frames = [...pages.querySelectorAll<HTMLElement>('.page[data-page-number]')]
          .filter((node) => {
            const box = node.getBoundingClientRect()
            return (
              box.left < region.x + region.width &&
              box.right > region.x &&
              box.top < region.y + region.height &&
              box.bottom > region.y
            )
          })
          .map((node) => {
            const pageIndex = Number(node.dataset.pageNumber) - 1
            const view = viewer.getPageView(pageIndex) as PDFPageView | undefined
            if (!view?.pdfPage) throw new Error('A selected PDF page is still loading.')
            const box = node.getBoundingClientRect()
            return {
              pageIndex,
              pageLabel: labels?.[pageIndex] || String(pageIndex + 1),
              rotation: view.viewport.rotation,
              section: outlineAtPage(outline, pageIndex)?.title,
              textLayer: node.querySelector('.textLayer:not([hidden])'),
              frame: {
                x: box.left + node.clientLeft,
                y: box.top + node.clientTop,
                width: node.clientWidth,
                height: node.clientHeight,
              },
            }
          })
        return capturePdfRegion(
          pdf,
          frames,
          region,
          AbortSignal.any([captureSignal, lifetime.signal]),
          sourceTitle,
        )
      },
      setAnnotations: (rows: readonly ZoteroAnnotationRowView[]) => {
        annotations = rows
        repaintOverlays()
      },
      /** Select one persisted annotation in the page overlay. */
      setSelectedAnnotation: (ref?: string) => {
        selectedAnnotation = ref
        repaintOverlays()
      },
      setEvidence: (position?: PdfPageRegion) => {
        evidence = position
        if (position) goTo(position.pageIndex + 1)
        repaintOverlays()
      },
      locateEvidence,
      async artifactPosition({ pageIndex, box }: PdfArtifactRegion, request: AbortSignal) {
        const pageOnly = { pageIndex, rects: [] }
        if (!box || box.some((edge) => !Number.isInteger(edge) || edge < 0 || edge > 1000))
          return pageOnly
        const viewport = await artifactViewport(pageIndex, request)
        if (!viewport) return pageOnly
        const [left, top, right, bottom] = box
        if (left >= right || top >= bottom) return pageOnly
        const [x1, y1] = viewport.convertToPdfPoint(
          (left * viewport.width) / 1000,
          (top * viewport.height) / 1000,
        ) as [number, number]
        const [x2, y2] = viewport.convertToPdfPoint(
          (right * viewport.width) / 1000,
          (bottom * viewport.height) / 1000,
        ) as [number, number]
        return {
          pageIndex,
          rects: [
            {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            },
          ],
        }
      },
      async artifactSelection(
        { pageIndex, rects }: PdfPageRegion,
        request: AbortSignal,
      ): Promise<PdfArtifactRegion | undefined> {
        if (!rects.length) return undefined
        const viewport = await artifactViewport(pageIndex, request)
        if (!viewport) return undefined
        let left = 1000
        let top = 1000
        let right = 0
        let bottom = 0
        for (const { x, y, width, height } of rects) {
          const [x1, y1] = viewport.convertToViewportPoint(x, y) as [number, number]
          const [x2, y2] = viewport.convertToViewportPoint(x + width, y + height) as [
            number,
            number,
          ]
          left = Math.min(left, (1000 * Math.min(x1, x2)) / viewport.width)
          right = Math.max(right, (1000 * Math.max(x1, x2)) / viewport.width)
          top = Math.min(top, (1000 * Math.min(y1, y2)) / viewport.height)
          bottom = Math.max(bottom, (1000 * Math.max(y1, y2)) / viewport.height)
        }
        const box = [
          Math.max(0, left),
          Math.max(0, top),
          Math.min(1000, right),
          Math.min(1000, bottom),
        ] as const
        if (box[0] < box[2] && box[1] < box[3]) return { pageIndex, box }
      },
      getOutline: async () => {
        const items = await outlineReady
        updatePage()
        return items
      },
      goToOutline: async (destination: NonNullable<PdfOutline['destination']>) =>
        await linkService.goToDestination(destination),
      fit: (mode: 'page-width' | 'page-fit') => {
        viewer.currentScaleValue = mode
      },
      zoom,
      rotate: (step: 1 | -1 = 1) => {
        viewer.pagesRotation = (((viewer.pagesRotation + 90 * step) % 360) + 360) % 360
      },
      find: (query: string, backwards: boolean) => {
        eventBus.dispatch('find', {
          source: viewer,
          type: 'again',
          query,
          highlightAll: true,
          findPrevious: backwards,
        })
      },
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
