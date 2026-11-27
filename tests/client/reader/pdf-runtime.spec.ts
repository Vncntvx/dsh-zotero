// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import {
  bytes,
  host,
  lifetime,
  pdf,
  revoke,
  sawPage,
  terminate,
  worker,
} from './support/pdf-runtime.ts'
import { mountPdf, type PdfSelection } from '../../../src/client/reader/pdf-runtime.ts'
import { deferred } from '../../helpers/sync.ts'
import { PasswordResponses } from 'pdfjs-dist'

it('fingerprints the PDF bytes independently of the embedded file ID', async () => {
  vi.stubGlobal('crypto', webcrypto)
  await mountPdf(host, bytes, lifetime.signal, sawPage)
  expect(sawPage.mock.lastCall?.[0].fingerprint).toBe(
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

it('leaves the canvas selection renderer off so the shadow page keeps a native highlight', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  expect(pdf.viewerOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ enableSelectionRendering: false }),
  )
  await controls.dispose()
})

it('restores and reports the physical page, printed label, section, scale, and rotation', async () => {
  const onPosition = vi.fn()
  vi.stubGlobal('crypto', {})
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, {
    restore: () => ({ pageIndex: 1, pageOffset: 0.25, fitMode: 'free', zoom: 1, rotation: 90 }),
    onPosition,
  })
  expect(host.shadowRoot?.querySelector('.pdfViewer')?.parentElement?.scrollTop).toBe(25)
  const outline = await controls.getOutline()
  expect(outline).toEqual([
    { id: '0', title: 'Opening', destination: [0, { name: 'Fit' }], pageIndex: 0, children: [] },
    {
      id: '1',
      title: 'Methods',
      destination: 'method',
      pageIndex: 1,
      children: [
        { id: '1.0', title: 'Results', destination: [{ num: 7 }], pageIndex: 1, children: [] },
      ],
    },
    { id: '2', title: 'Unresolved', destination: 'broken', pageIndex: undefined, children: [] },
  ])
  expect(sawPage).toHaveBeenLastCalledWith({
    page: 2,
    count: 2,
    fingerprint: 'pdfjs:fixture-copy',
    label: '1',
    sectionId: '1.0',
    sectionTitle: 'Results',
  })

  await controls.goToOutline('method')
  expect(pdf.destination).toHaveBeenCalledExactlyOnceWith('method')
  controls.fit('page-fit')
  controls.goTo(1)
  expect(onPosition).toHaveBeenLastCalledWith({
    pageIndex: 0,
    pageOffset: 0.1,
    zoom: 1,
    fitMode: 'page',
    rotation: 90,
  })
  controls.goTo(3)
  expect(sawPage.mock.lastCall?.[0].page).toBe(1)
  controls.find('outcome', true)
  expect(pdf.feed).toHaveBeenLastCalledWith(
    'find',
    expect.objectContaining({
      query: 'outcome',
      findPrevious: true,
      highlightAll: true,
    }),
  )
  await controls.dispose()
})

it('keeps overlays clipped to page bounds and reapplies the selected underline after rotation', async () => {
  const onAnnotationPick = vi.fn()
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, undefined, {
    onAnnotationPick,
  })
  const rects = [
    { x: -8, y: 30, width: 20, height: 10 },
    { x: -20, y: -20, width: 1, height: 1 },
  ]
  controls.setAnnotations([
    { ref: 'highlight', type: 'highlight', text: 'Highlight', position: { pageIndex: 0, rects } },
    { ref: 'underline', type: 'underline', text: 'Underline', position: { pageIndex: 0, rects } },
    { ref: 'image', type: 'image', text: '', position: { pageIndex: 0, rects } },
  ])
  controls.setSelectedAnnotation('underline')
  const root = host.shadowRoot!
  expect(root.querySelectorAll('.zoteroAnnotations span')).toHaveLength(2)
  let underline = root.querySelector<HTMLElement>('.zoteroAnnotationSelected')
  expect(underline?.style.width).toBe('7.5%')
  expect(underline?.style.borderBottom).toContain('2px')
  for (const mark of root.querySelectorAll<HTMLElement>('.zoteroAnnotations span'))
    mark.getBoundingClientRect = () => new DOMRect(0, 60, 12, 10)
  root
    .querySelector('.textLayer')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 6, clientY: 64 }))
  expect(onAnnotationPick).toHaveBeenCalledExactlyOnceWith(['highlight', 'underline'])
  controls.rotate()
  underline = root.querySelector<HTMLElement>('.zoteroAnnotationSelected')
  expect(underline?.style.borderLeft).toContain('2px')
  controls.rotate()
  expect(root.querySelector<HTMLElement>('.zoteroAnnotationSelected')?.style.borderTop).toContain(
    '2px',
  )
  controls.rotate()
  expect(root.querySelector<HTMLElement>('.zoteroAnnotationSelected')?.style.borderRight).toContain(
    '2px',
  )

  controls.setEvidence({ pageIndex: 1, rects })
  expect(sawPage.mock.lastCall?.[0].page).toBe(2)
  expect(root.querySelectorAll('.zoteroEvidence span')).toHaveLength(1)
  controls.setEvidence(undefined)
  expect(root.querySelector('.zoteroEvidence')).toBeNull()
  await controls.dispose()
})

it('rebuilds Zotero annotation overlays after PDF.js renders a page again', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  controls.setAnnotations([
    {
      ref: 'highlight',
      type: 'highlight',
      text: 'Highlight',
      position: { pageIndex: 0, rects: [{ x: 16, y: 40, width: 32, height: 20 }] },
    },
  ])
  const root = host.shadowRoot!
  expect(root.querySelectorAll('.zoteroAnnotations span')).toHaveLength(1)

  root.querySelector('.zoteroAnnotations')?.remove()
  pdf.bus!.dispatch('pagerendered', { pageNumber: 1 })

  expect(root.querySelectorAll('.zoteroAnnotations span')).toHaveLength(1)
  await controls.dispose()
})

it('uses Ctrl and Cmd wheel origins while regular wheel events leave PDF scale alone', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const focusedSurface = host.shadowRoot?.querySelector('[tabindex="0"]')
  expect(focusedSurface).toBeTruthy()
  focusedSurface?.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
  expect(pdf.scale).not.toHaveBeenCalled()
  const pinch = new WheelEvent('wheel', {
    metaKey: true,
    deltaY: -1000,
    clientX: 40,
    clientY: 50,
    cancelable: true,
  })
  focusedSurface?.dispatchEvent(pinch)
  expect(pinch.defaultPrevented).toBe(true)
  expect(pdf.scale).toHaveBeenLastCalledWith({ scaleFactor: Math.exp(0.35), origin: [40, 50] })
  focusedSurface?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
  expect(sawPage.mock.lastCall?.[0].page).toBe(2)
  focusedSurface?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
  expect(sawPage.mock.lastCall?.[0].page).toBe(1)
  await controls.dispose()
})

it('reports cross-page geometry and refuses creation if a selected page loses its text layer', async () => {
  const report = vi.fn<(selection?: PdfSelection) => void>()
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, undefined, {
    onSelection: report,
  })
  const layers = host.shadowRoot!.querySelectorAll('.textLayer')
  const start = layers[0].firstChild!
  const end = layers[1].firstChild!
  const range = document.createRange()
  range.setStart(start, 5)
  range.setEnd(end, 4)
  vi.spyOn(document, 'getSelection').mockReturnValue({
    // Some engines retarget both endpoints to the same shadow host.
    isCollapsed: true,
    rangeCount: 1,
    anchorNode: host,
    getComposedRanges: () => [range],
  } as unknown as Selection)
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() =>
    Object.defineProperty(createRange(), 'getClientRects', {
      value: () => [new DOMRect(12, 20, 40, 8)],
    }),
  )

  document.dispatchEvent(new Event('selectionchange'))
  expect(report).toHaveBeenLastCalledWith({
    canAnnotate: true,
    nearBottom: false,
    text: 'for page 1\nText',
    pages: [
      {
        pageIndex: 0,
        pageLabel: 'iv',
        textOffset: 5,
        top: 20,
        text: 'for page 1',
        rects: [{ x: 12, y: 72, width: 40, height: 8 }],
      },
      {
        pageIndex: 1,
        pageLabel: '1',
        textOffset: 0,
        top: 20,
        text: 'Text',
        rects: [{ x: 12, y: 72, width: 40, height: 8 }],
      },
    ],
  })

  layers[0].parentElement?.removeAttribute('data-loaded')
  document.dispatchEvent(new Event('selectionchange'))
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ canAnnotate: false }))
  range.collapse(false)
  document.dispatchEvent(new Event('selectionchange'))
  expect(report).toHaveBeenLastCalledWith(undefined)
  await controls.dispose()
  report.mockClear()
  document.dispatchEvent(new Event('selectionchange'))
  expect(report).not.toHaveBeenCalled()
})

it('cancels an in-flight load and releases its loading task, worker bridge, and URL', async () => {
  const pending = deferred<never>()
  pdf.load.mockReturnValue({ destroy: pdf.destroy, promise: pending.promise })
  const mounting = mountPdf(host, bytes, lifetime.signal, sawPage)
  lifetime.abort(new Error('Reader closed'))

  await expect(mounting).rejects.toThrow('Reader closed')
  expect(pdf.destroy).toHaveBeenCalledTimes(1)
  expect(pdf.destroyBridge).toHaveBeenCalledTimes(1)
  expect(terminate).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pdf-test')
  expect(host.shadowRoot?.childElementCount).toBe(0)
})

it('can quote the start of a large selection without splitting a supplementary character', async () => {
  const onSelection = vi.fn<(selection?: PdfSelection) => void>()
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, undefined, { onSelection })
  const layer = host.shadowRoot!.querySelector('.textLayer')!
  const prefix = 'a'.repeat(15_999)
  layer.textContent = `${prefix}😀b`
  const makeRange = document.createRange.bind(document)
  const selected = makeRange()
  selected.selectNodeContents(layer.firstChild!)
  vi.spyOn(document, 'getSelection').mockReturnValue({
    rangeCount: 1,
    anchorNode: host,
    getComposedRanges: () => [selected],
  } as unknown as Selection)
  vi.spyOn(document, 'createRange').mockImplementation(() =>
    Object.defineProperty(makeRange(), 'getClientRects', {
      value: () => [new DOMRect(12, 20, 40, 8)],
    }),
  )
  document.dispatchEvent(new Event('selectionchange'))
  expect(onSelection.mock.lastCall?.[0]).toMatchObject({
    text: prefix,
    textTruncated: true,
    canAnnotate: false,
    pages: [{ pageIndex: 0, text: prefix }],
  })
  await controls.dispose()
})

it('surfaces worker load failure and disposes the failed viewer', async () => {
  const pending = deferred<never>()
  pdf.load.mockReturnValue({ destroy: pdf.destroy, promise: pending.promise })
  const mounting = mountPdf(host, bytes, lifetime.signal, sawPage)
  worker.dispatchEvent(new Event('messageerror'))

  await expect(mounting).rejects.toThrow('PDF.js worker failed')
  expect(terminate).toHaveBeenCalledTimes(1)
  expect(host.shadowRoot?.childElementCount).toBe(0)
})

it('accepts one password per PDF.js challenge and ignores any submission after the tab closes', async () => {
  const pending = deferred<never>()
  const task: {
    destroy: typeof pdf.destroy
    promise: Promise<never>
    onPassword?: (update: (password: string) => void, reason: number) => void
  } = { destroy: pdf.destroy, promise: pending.promise }
  pdf.load.mockReturnValueOnce(task)
  const onPassword = vi.fn<NonNullable<NonNullable<Parameters<typeof mountPdf>[5]>['onPassword']>>()
  const mounting = mountPdf(host, bytes, lifetime.signal, sawPage, undefined, { onPassword })
  const update = vi.fn()
  task.onPassword!(update, PasswordResponses.NEED_PASSWORD)
  const first = onPassword.mock.lastCall![0]
  expect(first.incorrect).toBe(false)
  first.submit('first attempt')
  first.submit('duplicate')
  expect(update).toHaveBeenCalledExactlyOnceWith('first attempt')

  const updateRetry = vi.fn()
  task.onPassword!(updateRetry, PasswordResponses.INCORRECT_PASSWORD)
  const retry = onPassword.mock.lastCall![0]
  expect(retry.incorrect).toBe(true)
  lifetime.abort(new Error('Reader closed'))
  retry.submit('stale password')
  task.onPassword!(updateRetry, PasswordResponses.NEED_PASSWORD)
  await expect(mounting).rejects.toThrow('Reader closed')
  expect(updateRetry).not.toHaveBeenCalled()
  expect(onPassword).toHaveBeenCalledTimes(2)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pdf-test')
})

it('still reads physical pages when the digest and outline are unavailable', async () => {
  const digest = vi.fn().mockRejectedValue(new DOMException('Digest refused'))
  vi.stubGlobal('crypto', { subtle: { digest } })
  const documentRef = {
    ...(await pdf.load().promise),
    getPageLabels: vi.fn().mockResolvedValue(null),
    getOutline: vi.fn().mockRejectedValue(new Error('Invalid outline')),
  }
  pdf.load.mockReturnValueOnce({ destroy: pdf.destroy, promise: Promise.resolve(documentRef) })
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  await expect(controls.getOutline()).rejects.toThrow('Invalid outline')
  controls.goTo(2)
  expect(sawPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2, count: 2, fingerprint: 'pdfjs:fixture-copy' }),
  )
  expect(controls.pageLabel(1)).toBe('2')
  await controls.dispose()
})

it('treats a successful outline response with no bookmarks as an empty outline', async () => {
  const documentRef = { ...(await pdf.load().promise), getOutline: async () => null }
  pdf.load.mockReturnValueOnce({ destroy: pdf.destroy, promise: Promise.resolve(documentRef) })
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)

  await expect(controls.getOutline()).resolves.toEqual([])
  controls.goTo(2)
  expect(sawPage.mock.lastCall?.[0]).toMatchObject({ page: 2, label: '1' })
  expect(sawPage.mock.lastCall?.[0]).not.toHaveProperty('sectionId')
  await controls.dispose()
})

it('keeps malformed bookmark destinations out of the current section and bounds nesting', async () => {
  const nested = (level: number): unknown[] =>
    level > 24 ? [] : [{ title: `Level ${level}`, dest: null, items: nested(level + 1) }]
  const documentRef = {
    ...(await pdf.load().promise),
    getOutline: async () => [
      { title: 'Introduction', dest: [0] },
      { title: 'Unset target', dest: 'missing' },
      { title: 'Invalid page', dest: [-1] },
      ...nested(1),
    ],
    getDestination: async () => null,
  }
  pdf.load.mockReturnValueOnce({ destroy: pdf.destroy, promise: Promise.resolve(documentRef) })
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const [intro, missing, invalid, nestedOutline] = await controls.getOutline()
  expect([intro?.pageIndex, missing?.pageIndex, invalid?.pageIndex]).toEqual([
    0,
    undefined,
    undefined,
  ])
  const levels = []
  for (let node = nestedOutline; node; node = node.children[0]) levels.push(node.title)
  expect(levels).toHaveLength(20)
  controls.goTo(2)
  expect(sawPage.mock.lastCall?.[0].sectionTitle).toBe('Introduction')
  await controls.dispose()
})
