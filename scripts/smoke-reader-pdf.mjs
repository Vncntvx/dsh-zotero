/// <reference lib="dom" />
/// <reference path="../src/client/reader/pdf-assets.d.ts" />
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, firefox, webkit } from 'playwright'

function fixturePdf() {
  const pages = [
    'BT /F1 20 Tf 28 76 Td (Research Reader) Tj 0 -26 Td (Cropped passage) Tj ET',
    'BT /F1 20 Tf 18 176 Td (Methods and findings) Tj ET',
  ]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R /PageLabels 12 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /CropBox [20 20 300 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 330] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map((value) => `<< /Length ${value.length} >>\nstream\n${value}\nendstream`),
    '<< /Type /Outlines /First 9 0 R /Last 11 0 R /Count 2 >>',
    '<< /Title (Methods) /Parent 8 0 R /Dest [4 0 R /Fit] /First 10 0 R /Last 10 0 R /Count 1 /Next 11 0 R >>',
    '<< /Title (Findings) /Parent 9 0 R /Dest [4 0 R /Fit] >>',
    '<< /Title (Introduction) /Parent 8 0 R /Dest [3 0 R /Fit] /Prev 9 0 R >>',
    '<< /Nums [0 << /S /r >> 1 << /S /D >>] >>',
  ]
  return serializePdf(objects)
}

/** @param {readonly string[]} objects */
function serializePdf(objects) {
  let pdf = '%PDF-1.7\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return String(offset).padStart(10, '0')
  })
  return (
    pdf +
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${offset} 00000 n \n`).join('') +
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`
  )
}

function paperFixture() {
  const stream = [
    'BT /F1 20 Tf 54 734 Td (Research layout fixture) Tj ET',
    'BT /F1 10 Tf 54 712 Td (Synthetic study of two reading conditions) Tj ET',
    '0.65 G 54 695 m 558 695 l S',
    'BT /F1 14 Tf 54 666 Td (Methods) Tj ET',
    'BT /F1 11 Tf 54 646 Td (Left-column cohort) Tj 0 -16 Td (Twenty-four examples were assigned) Tj 0 -16 Td (equally to groups A and B.) Tj ET',
    'BT /F1 13 Tf 78 574 Td (E = m c^2) Tj ET',
    'BT /F1 10 Tf 54 528 Td (Table 1. Examples per condition) Tj ET',
    '0.55 G 54 515 m 286 515 l 54 490 m 286 490 l 54 443 m 286 443 l S',
    'BT /F1 11 Tf 60 499 Td (Condition) Tj 0 -24 Td (Group A) Tj 0 -22 Td (Group B) Tj ET',
    'BT /F1 11 Tf 232 499 Td (Count) Tj 0 -24 Td (12) Tj 0 -22 Td (12) Tj ET',
    'BT /F1 14 Tf 326 666 Td (Findings) Tj ET',
    'BT /F1 11 Tf 326 646 Td (Right-column outcome) Tj 0 -16 Td (Group B completed more examples) Tj 0 -16 Td (during the observation window.) Tj ET',
    '0 G 346 449 m 346 577 l 346 449 m 550 449 l S',
    'q 0.18 0.36 0.70 rg 377 450 40 45 re f 465 450 40 90 re f Q',
    'BT /F1 10 Tf 381 434 Td (Group A) Tj 88 0 Td (Group B) Tj ET',
    'BT /F1 10 Tf 344 408 Td (Figure 1. Completed examples) Tj ET',
    'BT /F1 10 Tf 54 378 Td (Shared result) Tj ET',
    'BT /F1 10 Tf 326 378 Td (Shared result) Tj ET',
  ].join('\n')
  return serializePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ])
}

/** @param {import('playwright').Page} page */
async function verifyPaperLayout(page) {
  const paper = await page.evaluate(async (file) => {
    const runtime =
      /** @type {Window & { readerRuntime?: typeof import('../src/client/reader/pdf-runtime.ts') }} */ (
        window
      ).readerRuntime
    const host = document.querySelector('#reader')
    if (!(host instanceof HTMLElement) || !runtime) throw new Error('Missing PDF runtime')
    const signal = AbortSignal.timeout(10_000)
    const reader = await runtime.mountPdf(host, new TextEncoder().encode(file), signal, () => {})
    try {
      const excerpt = await reader.readExcerpt(1, 1, signal)
      const match = await reader.locateEvidence(
        { quote: 'Right-column outcome', sourceType: 'bm25' },
        signal,
      )
      const renderedPage = host.shadowRoot?.querySelector('.page')
      const mark = renderedPage?.querySelector('.zoteroEvidenceRegion')
      if (match.kind !== 'region' || !mark || !renderedPage)
        throw new Error('The right column did not resolve to a rendered evidence region')
      const bounds = renderedPage.getBoundingClientRect()
      const capture = await reader.capture(
        {
          x: bounds.left + (346 / 612) * bounds.width,
          y: bounds.top + (215 / 792) * bounds.height,
          width: (204 / 612) * bounds.width,
          height: (128 / 792) * bounds.height,
        },
        signal,
      )
      const bitmap = await createImageBitmap(capture.png)
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
      if (!context) throw new Error('Missing chart pixels')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, capture.width, capture.height)
      const bluePixels = data.reduce(
        (count, red, i) => count + Number(i % 4 === 0 && red < 85 && data[i + 2] > 150),
        0,
      )
      const markLeft = (mark.getBoundingClientRect().left - bounds.left) / bounds.width
      reader.setEvidence()
      const repeated = await reader.locateEvidence(
        { quote: 'Shared result', sourceType: 'bm25' },
        signal,
      )
      return {
        text: excerpt.text,
        markLeft,
        bluePixels,
        repeated,
        highlightedRepeated: Boolean(renderedPage.querySelector('.zoteroEvidenceRegion')),
      }
    } finally {
      await reader.dispose()
    }
  }, paperFixture())
  assert.match(
    paper.text,
    /Left-column cohort[\s\S]*E = m c\^2[\s\S]*Table 1\. Examples per condition[\s\S]*Right-column outcome/,
  )
  assert.ok(Math.abs(paper.markLeft - 326 / 612) < 0.015)
  assert.ok(paper.bluePixels > 500, 'The region capture preserves the chart bars')
  assert.deepEqual(paper.repeated, { kind: 'ambiguous', pages: [0] })
  assert.equal(paper.highlightedRepeated, false)
}

function scanFixture() {
  const pageCount = 320
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const size = index % 2 === 0 ? '612 792' : '792 612'
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size}] /Resources << /XObject << /Scan 3 0 R >> >> /Contents 4 0 R >>`
  })
  // A grayscale raster with 32 bands of ten evenly spaced strokes. All pages
  // share the source image, as in a scanned reference with no OCR text layer.
  const image = ('ff'.repeat(2048 * 48) + '55'.repeat(2048 * 16)).repeat(32) + '>'
  const stream = 'q 580 0 0 580 16 16 cm /Scan Do Q'
  return serializePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, i) => `${i + 5} 0 R`).join(' ')}] >>`,
    `<< /Type /XObject /Subtype /Image /Width 2048 /Height 2048 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...pages,
  ])
}

/** @param {import('playwright').Page} page */
async function verifyTextCapture(page) {
  const { outputFiles } = await build({
    entryPoints: [
      fileURLToPath(new URL('../src/client/reader/excerpt-region.ts', import.meta.url)),
    ],
    bundle: true,
    write: false,
    globalName: 'readerExcerpt',
    format: 'iife',
  })
  await page.setContent(`<div id="excerpt" style="display:flow-root;width:360px;background:white;color:#171717">
    <h2>Research Methods</h2>
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="padding:5px;background:#eee"><strong>Study finding</strong></td>
      <td style="width:130px">Candidate data</td>
    </tr></table></div>`)
  await page.addScriptTag({ content: outputFiles[0].text })
  const colors = await page.evaluate(async () => {
    const { readerExcerpt } =
      /** @type {Window & { readerExcerpt?: { excerptRegion(root: HTMLElement, range: Range): { src: string, width: number, height: number } | undefined } }} */ (
        window
      )
    const root = document.querySelector('#excerpt')
    const selected = root?.querySelector('strong')
    if (!(root instanceof HTMLElement) || !selected) throw new Error('Excerpt fixture is missing')
    const range = document.createRange()
    range.selectNodeContents(selected)
    const region = readerExcerpt?.excerptRegion(root, range)
    if (!region) throw new Error('Excerpt region is missing')
    const image = new Image()
    image.src = region.src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = region.width
    canvas.height = region.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = { ink: 0, cell: 0 }
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] !== 255) continue
      if (pixels[index] < 100) colors.ink++
      if (pixels[index] === 238) colors.cell++
    }
    return colors
  })
  assert.ok(colors.ink > 20 && colors.cell > 100, 'The crop retains the table background and text')
}

const engines = { chromium, firefox, webkit }
const engine = process.env.READER_PDF_BROWSER ?? 'chromium'
if (engine !== 'chromium' && engine !== 'firefox' && engine !== 'webkit')
  throw new Error(`Unsupported Reader PDF browser: ${engine}`)
const firefoxDataRoot =
  engine === 'firefox' ? await mkdtemp(join(tmpdir(), 'dsh-reader-firefox-')) : undefined
if (firefoxDataRoot) {
  await Promise.all([
    mkdir(join(firefoxDataRoot, 'app-data'), { recursive: true }),
    mkdir(join(firefoxDataRoot, 'local-app-data'), { recursive: true }),
  ])
}
let browser
try {
  browser = await engines[engine].launch({
    executablePath: engine === 'chromium' ? process.env.CHROME_EXECUTABLE : undefined,
    ...(firefoxDataRoot
      ? {
          env: {
            ...process.env,
            MOZ_APP_DATA: join(firefoxDataRoot, 'app-data'),
            MOZ_LOCAL_APP_DATA: join(firefoxDataRoot, 'local-app-data'),
          },
        }
      : {}),
  })
} catch (error) {
  if (firefoxDataRoot) await rm(firefoxDataRoot, { recursive: true, force: true })
  throw error
}
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 540 } })
  const pageErrors = /** @type {Error[]} */ ([])
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.route('https://reader.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="reader" style="position:absolute;inset:20px"></div>',
    }),
  )
  await page.goto('https://reader.test/')
  await page.addScriptTag({
    content: `
    window.__ModuleLoader__ = { load({ factory }) { window.readerRuntime = factory() } };
    window.readerAbort = new AbortController();
    window.readerViews = [];
  `,
  })
  await page.addScriptTag({
    path: process.argv[2] ?? fileURLToPath(new URL('../lib/client.reader-pdf.js', import.meta.url)),
  })
  // Keep the fixture globals local to the actual browser evaluation.
  const status = await page.evaluate(async (pdf) => {
    const fixture =
      /** @type {Window & { readerRuntime?: typeof import('../src/client/reader/pdf-runtime.ts'), readerAbort?: AbortController, readerViews?: import('../src/client/reader/pdf-runtime.ts').PdfView[], readerControls?: Awaited<ReturnType<typeof import('../src/client/reader/pdf-runtime.ts').mountPdf>>, readerSelection?: import('../src/client/reader/pdf-runtime.ts').PdfSelection, pickedAnnotations?: readonly string[] }} */ (
        window
      )
    const host = document.querySelector('#reader')
    if (
      !(host instanceof HTMLElement) ||
      !fixture.readerRuntime ||
      !fixture.readerAbort ||
      !fixture.readerViews
    )
      throw new Error('Invalid browser fixture')
    fixture.readerControls = await fixture.readerRuntime.mountPdf(
      host,
      new TextEncoder().encode(pdf),
      fixture.readerAbort.signal,
      (view) => fixture.readerViews?.push(view),
      undefined,
      {
        onSelection(selection) {
          fixture.readerSelection = selection
        },
        onAnnotationPick(refs) {
          fixture.pickedAnnotations = refs
        },
      },
    )
    return fixture.readerViews.at(-1)
  }, fixturePdf())
  assert.equal(status?.count, 2)
  assert.equal(status?.page, 1)
  assert.equal(status?.label, 'i')
  await page.locator('.page[data-page-number="1"] canvas').waitFor()
  await page.locator('.textLayer').getByText('Research Reader').waitFor()
  const outlineTitle = await page.evaluate(async () => {
    const fixture =
      /** @type {Window & { readerViews?: import('../src/client/reader/pdf-runtime.ts').PdfView[], readerControls?: Awaited<ReturnType<typeof import('../src/client/reader/pdf-runtime.ts').mountPdf>>, pickedAnnotations?: readonly string[] }} */ (
        window
      )
    const reader = fixture.readerControls
    if (!reader) throw new Error('Missing PDF controls')
    reader.setAnnotations([
      {
        ref: 'zotero://user/0/annotation/ANNO0001',
        type: 'highlight',
        text: 'Research Reader',
        comment: 'Compare this with the findings',
        position: { pageIndex: 0, rects: [{ x: 26, y: 75, width: 160, height: 24 }] },
      },
      {
        ref: 'zotero://user/0/annotation/ANNO0002',
        type: 'underline',
        text: 'Research',
        position: { pageIndex: 0, rects: [{ x: 26, y: 75, width: 100, height: 24 }] },
      },
    ])
    const mark = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.zoteroAnnotations span')
    if (!(mark instanceof HTMLElement) || mark.getBoundingClientRect().width <= 0)
      throw new Error('Missing Zotero annotation overlay')
    if (getComputedStyle(mark).pointerEvents !== 'none')
      throw new Error('The overlay intercepts text selection')
    const comment = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.zoteroAnnotationComment')
    if (
      !(comment instanceof HTMLElement) ||
      comment.getBoundingClientRect().width <= 0 ||
      getComputedStyle(comment).pointerEvents !== 'none'
    )
      throw new Error('Missing non-interactive annotation comment badge')
    const croppedPage = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.page[data-page-number="1"]')
    if (!(croppedPage instanceof HTMLElement)) throw new Error('Missing CropBox page')
    const annotationBounds = mark.getBoundingClientRect()
    const textLayer = croppedPage.querySelector('.textLayer')
    textLayer?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: annotationBounds.left + 5,
        clientY: annotationBounds.top + 5,
      }),
    )
    if (
      fixture.pickedAnnotations?.join(',') !==
      'zotero://user/0/annotation/ANNO0001,zotero://user/0/annotation/ANNO0002'
    )
      throw new Error('The overlaid text click did not locate both annotations')
    const croppedPageBounds = croppedPage.getBoundingClientRect()
    /** @param {number} actual @param {number} expected */
    const closeTo = (actual, expected) => Math.abs(actual - expected) < 0.03
    if (
      !closeTo(annotationBounds.width / croppedPageBounds.width, 160 / 280) ||
      !closeTo(annotationBounds.height / croppedPageBounds.height, 24 / 140)
    )
      throw new Error('The annotation overlay does not match CropBox page coordinates')
    reader.setSelectedAnnotation('zotero://user/0/annotation/ANNO0001')
    const selectedMark = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.zoteroAnnotationSelected')
    if (!(selectedMark instanceof HTMLElement) || !getComputedStyle(selectedMark).outline)
      throw new Error('Selecting an annotation did not outline its PDF geometry')
    reader.setSelectedAnnotation(undefined)
    if (document.querySelector('#reader')?.shadowRoot?.querySelector('.zoteroAnnotationSelected'))
      throw new Error('The selected annotation outline was not cleared')
    reader.setEvidence({
      pageIndex: 0,
      rects: [{ x: 26, y: 75, width: 160, height: 24 }],
    })
    const evidence = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.zoteroEvidenceRegion')
    if (!(evidence instanceof HTMLElement) || evidence.getBoundingClientRect().width <= 0)
      throw new Error('Missing temporary evidence region')
    const page = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.page[data-page-number="1"]')
    if (!(page instanceof HTMLElement)) throw new Error('Missing first PDF page')
    const pageBounds = page.getBoundingClientRect()
    const evidenceBounds = evidence.getBoundingClientRect()
    if (
      !closeTo(evidenceBounds.width / pageBounds.width, 160 / 280) ||
      !closeTo(evidenceBounds.height / pageBounds.height, 24 / 140)
    )
      throw new Error('The temporary evidence region does not match PDF page coordinates')
    if (getComputedStyle(evidence).pointerEvents !== 'none')
      throw new Error('The temporary evidence overlay intercepts text selection')
    reader.rotate()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const rotatedEvidence = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.zoteroEvidenceRegion')
    const rotatedPage = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.page[data-page-number="1"]')
    if (!(rotatedEvidence instanceof HTMLElement) || !(rotatedPage instanceof HTMLElement))
      throw new Error('The temporary evidence region disappeared after rotation')
    const rotatedPageBounds = rotatedPage.getBoundingClientRect()
    const rotatedEvidenceBounds = rotatedEvidence.getBoundingClientRect()
    if (
      !closeTo(rotatedEvidenceBounds.width / rotatedPageBounds.width, 24 / 140) ||
      !closeTo(rotatedEvidenceBounds.height / rotatedPageBounds.height, 160 / 280)
    )
      throw new Error('The temporary evidence region did not follow the rotated page viewport')
    reader.goTo(2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (fixture.readerViews?.at(-1)?.page !== 2)
      throw new Error('Page navigation failed while evidence remained active')
    const viewerPages = document.querySelector('#reader')?.shadowRoot?.querySelector('.pdfViewer')
    const surface = viewerPages instanceof HTMLElement ? viewerPages.parentElement : null
    if (!surface) throw new Error('Missing keyboard focus surface')
    surface.focus()
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (fixture.readerViews?.at(-1)?.page !== 1)
      throw new Error('Page-up keyboard navigation failed')
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (fixture.readerViews?.at(-1)?.page !== 2)
      throw new Error('Page-down keyboard navigation failed')
    reader.setEvidence(undefined)
    if (document.querySelector('#reader')?.shadowRoot?.querySelector('.zoteroEvidence'))
      throw new Error('The temporary evidence region was not cleared')
    const match = await reader.locateEvidence(
      { quote: 'Cropped passage', sourceType: 'semantic' },
      new AbortController().signal,
    )
    if (match.kind !== 'region' || match.pageIndex !== 0 || fixture.readerViews?.at(-1)?.page !== 1)
      throw new Error(`Retrieved text did not locate a unique PDF region: ${JSON.stringify(match)}`)
    const matchedPage = document
      .querySelector('#reader')
      ?.shadowRoot?.querySelector('.page[data-page-number="1"]')
    const text = [...(matchedPage?.querySelectorAll('.textLayer span') ?? [])].find(
      (span) => span.textContent === 'Cropped passage',
    )
    const quoteMark = matchedPage?.querySelector('.zoteroEvidenceRegion')
    if (!text || !quoteMark) throw new Error('Missing rendered quote or matching evidence mark')
    const range = document.createRange()
    range.selectNodeContents(text)
    const glyphs = range.getBoundingClientRect()
    const paint = quoteMark.getBoundingClientRect()
    if (
      ['left', 'top', 'width', 'height'].some((key) => {
        const edge = /** @type {'left' | 'top' | 'width' | 'height'} */ (key)
        return Math.abs(glyphs[edge] - paint[edge]) > 2
      })
    )
      throw new Error('Retrieved-text evidence did not cover the PDF glyphs')
    reader.setEvidence(undefined)
    const nextMatch = await reader.locateEvidence(
      { quote: 'Methods and findings', sourceType: 'bm25' },
      new AbortController().signal,
    )
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (
      nextMatch.kind !== 'region' ||
      nextMatch.pageIndex !== 1 ||
      fixture.readerViews?.at(-1)?.page !== 2
    )
      throw new Error('Centering the evidence changed the current page to its neighbor')
    reader.setEvidence(undefined)
    const item = (await reader.getOutline())[0]
    if (!item?.destination || item.pageIndex !== 1)
      throw new Error('Missing resolved outline destination')
    await reader.goToOutline(item.destination)
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (fixture.readerViews?.at(-1)?.sectionId !== item.children[0]?.id)
      throw new Error('Current outline section did not follow the active page')
    reader.zoom(0.4)
    reader.goTo(1)
    return item.title
  })
  assert.equal(outlineTitle, 'Methods')
  await page.setViewportSize({ width: 800, height: 1000 })
  await page.locator('.page[data-page-number="1"][data-loaded] canvas').waitFor()
  await page.locator('.page[data-page-number="2"] canvas').waitFor()
  const firstLayer = page.locator('.page[data-page-number="1"][data-loaded] .textLayer')
  const lastLayer = page.locator('.page[data-page-number="2"][data-loaded] .textLayer')
  await firstLayer.getByText('Cropped passage').waitFor()
  await lastLayer.getByText('Methods and findings').waitFor()
  const selected = await page.evaluate(() => {
    const fixture =
      /** @type {Window & { readerSelection?: import('../src/client/reader/pdf-runtime.ts').PdfSelection }} */ (
        window
      )
    const shadow = document.querySelector('#reader')?.shadowRoot
    const first = shadow?.querySelector(
      '.page[data-page-number="1"] .textLayer span[role="presentation"]',
    )?.firstChild
    const last = shadow?.querySelector(
      '.page[data-page-number="2"] .textLayer span[role="presentation"]',
    )?.firstChild
    const selection = document.getSelection()
    if (!(first instanceof Text) || !(last instanceof Text) || !selection)
      throw new Error('Missing searchable PDF text nodes')
    selection.setBaseAndExtent(last, 7, first, 9)
    document.dispatchEvent(new Event('selectionchange'))
    if (!selection.toString().includes('Reader'))
      throw new Error('Browser selection lost the first page')
    if (!fixture.readerSelection) {
      const describe = (/** @type {Selection | null | undefined} */ current) => ({
        collapsed: current?.isCollapsed,
        count: current?.rangeCount,
        anchorInReader: current?.anchorNode && shadow?.contains(current.anchorNode),
        composedInReader: current
          ?.getComposedRanges?.({ shadowRoots: shadow ? [shadow] : [] })
          .map((range) => [
            shadow?.contains(range.startContainer),
            shadow?.contains(range.endContainer),
          ]),
      })
      const local =
        /** @type {(ShadowRoot & { getSelection?: () => Selection | null }) | undefined} */ (shadow)
      throw new Error(
        `Reader omitted the browser selection: ${JSON.stringify({
          document: describe(selection),
          shadow: describe(local?.getSelection?.()),
        })}`,
      )
    }
    return fixture.readerSelection
  })
  assert.equal(selected?.canAnnotate, true, JSON.stringify(selected))
  assert.deepEqual(
    selected?.pages.map(({ pageIndex, text, pageLabel, textOffset }) => ({
      pageIndex,
      text,
      pageLabel,
      textOffset,
    })),
    [
      { pageIndex: 0, text: 'Reader\nCropped passage', pageLabel: 'i', textOffset: 9 },
      { pageIndex: 1, text: 'Methods', pageLabel: '1', textOffset: 0 },
    ],
  )
  assert.equal(selected?.pages[0]?.rects.length, 2)
  assert.equal(selected?.pages[1]?.rects.length, 1)
  const firstRect = selected?.pages[0]?.rects[0]
  assert.ok(firstRect && firstRect.x > 100 && firstRect.y > 60 && firstRect.y < 95)
  // The canvas renderer reads the document selection, which retargets to the
  // shadow host: it paints nothing while its class hides the native highlight.
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('#reader')
          ?.shadowRoot?.querySelector('.textLayer')
          ?.classList.contains('selectionRendering') ?? false,
    ),
    false,
    'canvas selection rendering is on, so the browser selection would be invisible',
  )
  await page.locator('.textLayer').getByText('Methods and findings').waitFor()
  const capture = await page.evaluate(async () => {
    const fixture =
      /** @type {Window & { readerControls?: Awaited<ReturnType<typeof import('../src/client/reader/pdf-runtime.ts').mountPdf>> }} */ (
        window
      )
    const root = document.querySelector('#reader')?.shadowRoot
    const first = root?.querySelector('.page[data-page-number="1"]')?.getBoundingClientRect()
    const last = root?.querySelector('.page[data-page-number="2"]')?.getBoundingClientRect()
    if (!first || !last || !fixture.readerControls) throw new Error('Missing capture pages')
    const x = Math.min(first.left, last.left)
    const { png, width, height, regions, text, textIncomplete } =
      await fixture.readerControls.capture(
        {
          x,
          y: first.top,
          width: Math.max(first.right, last.right) - x,
          height: last.bottom - first.top,
        },
        new AbortController().signal,
      )
    const bitmap = await createImageBitmap(png)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing capture pixels')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const seam = Math.round((height * first.height) / (first.height + last.height))
    const firstInk = context
      .getImageData(0, 0, width, seam)
      .data.some((value, index) => index % 4 === 0 && value < 100)
    const lastInk = context
      .getImageData(0, seam, width, height - seam)
      .data.some((value, index) => index % 4 === 0 && value < 100)
    const firstWord = root?.querySelector('.page[data-page-number="1"] .textLayer span')?.firstChild
    if (!(firstWord instanceof Text)) throw new Error('Missing capture text run')
    const range = document.createRange()
    range.setStart(firstWord, 0)
    range.setEnd(firstWord, 'Research'.length)
    const wordBox = range.getBoundingClientRect()
    const partial = await fixture.readerControls.capture(wordBox, new AbortController().signal)
    return {
      width,
      height,
      regions,
      firstInk,
      lastInk,
      text,
      textIncomplete,
      partial: partial.text,
    }
  })
  assert.ok(capture.firstInk && capture.lastInk)
  assert.ok(capture.width * capture.height <= 4_000_000)
  assert.deepEqual(
    capture.regions.map(({ pageIndex, pageLabel, section }) => [pageIndex, pageLabel, section]),
    [
      [0, 'i', 'Introduction'],
      [1, '1', 'Findings'],
    ],
  )
  assert.equal(capture.text, 'Research Reader\nCropped passage\n\nMethods and findings')
  assert.equal(capture.textIncomplete, false)
  assert.equal(capture.partial, 'Research')
  assert.ok(Math.abs((capture.regions[0]?.rects[0]?.width ?? 0) - 280) < 1)
  await page.evaluate(() => {
    const fixture = /** @type {Window & { readerAbort?: AbortController }} */ (window)
    fixture.readerAbort?.abort()
  })
  await page.locator('.pdfViewer').waitFor({ state: 'detached' })
  assert.deepEqual(pageErrors, [])
  for (let attempt = 0; attempt < 20 && page.workers().length > 0; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(page.workers().length, 0)
  const encryptedFile = await readFile(
    new URL('../tests/fixtures/reader-locked.pdf', import.meta.url),
  )
  const passwordPrompts = await page.evaluate(
    async (file) => {
      const fixture =
        /** @type {Window & { readerRuntime?: typeof import('../src/client/reader/pdf-runtime.ts') }} */ (
          window
        )
      const host = document.querySelector('#reader')
      if (!(host instanceof HTMLElement) || !fixture.readerRuntime)
        throw new Error('Missing reader')
      const prompts = /** @type {boolean[]} */ ([])
      const controls = await fixture.readerRuntime.mountPdf(
        host,
        Uint8Array.from(file),
        AbortSignal.timeout(10_000),
        () => {},
        undefined,
        {
          onPassword({ incorrect, submit }) {
            prompts.push(incorrect)
            submit(incorrect ? 'reader-fixture' : 'wrong-password')
            submit('obsolete-password-request')
          },
        },
      )
      await controls.dispose()
      return prompts
    },
    [...encryptedFile],
  )
  assert.deepEqual(passwordPrompts, [false, true])
  if (process.env.READER_PDF_BENCHMARK === '1') {
    const rejectsBroken = await page.evaluate(async () => {
      const runtime =
        /** @type {Window & { readerRuntime?: typeof import('../src/client/reader/pdf-runtime.ts') }} */ (
          window
        ).readerRuntime
      const host = document.querySelector('#reader')
      if (!(host instanceof HTMLElement) || !runtime) throw new Error('Missing reader')
      try {
        const controls = await runtime.mountPdf(
          host,
          new TextEncoder().encode('%PDF-1.7\ntruncated'),
          AbortSignal.timeout(10_000),
          () => {},
        )
        await controls.dispose()
        return false
      } catch {
        return host.shadowRoot?.querySelector('.pdfViewer') === null
      }
    })
    assert.equal(rejectsBroken, true)
    const scan = scanFixture()
    const measurements = await page.evaluate(
      async ({ scan, article }) => {
        const runtime =
          /** @type {Window & { readerRuntime?: typeof import('../src/client/reader/pdf-runtime.ts') }} */ (
            window
          ).readerRuntime
        if (!runtime) throw new Error('Missing reader')
        const pane = (/** @type {string} */ side) => {
          const node = document.createElement('div')
          node.style.cssText = `position:absolute;inset:0 ${side === 'left' ? '50%' : '0'} 0 ${side === 'left' ? '0' : '50%'}`
          document.body.append(node)
          return node
        }
        const scanPane = pane('left')
        const articlePane = pane('right')
        const hosts = [scanPane, articlePane]
        const text = new TextEncoder()
        const controller = new AbortController()
        const start = performance.now()
        let longestTask = 0
        const observer = new PerformanceObserver((list) => {
          for (const task of list.getEntries()) longestTask = Math.max(longestTask, task.duration)
        })
        observer.observe({ type: 'longtask' })
        const canvasOf = async (/** @type {HTMLElement} */ node, /** @type {number} */ page) => {
          const deadline = performance.now() + 15_000
          while (performance.now() < deadline) {
            const canvas = node.shadowRoot?.querySelector(
              `.page[data-page-number="${page}"][data-loaded] canvas`,
            )
            if (canvas instanceof HTMLCanvasElement && canvas.width > 0) return performance.now()
            await new Promise((resolve) => requestAnimationFrame(resolve))
          }
          throw new Error(`No scan canvas for page ${page}`)
        }
        try {
          const [scanControls, scanCanvas, articleCanvas, articleControls] = await Promise.all([
            runtime.mountPdf(scanPane, text.encode(scan), controller.signal, () => {}),
            canvasOf(scanPane, 1),
            canvasOf(articlePane, 1),
            runtime.mountPdf(articlePane, text.encode(article), controller.signal, () => {}),
          ])
          if (scanPane.shadowRoot?.querySelector('.textLayer span'))
            throw new Error('Raster scan unexpectedly has a text layer')
          const annotationStart = performance.now()
          articleControls.setAnnotations(
            Array.from({ length: 1_000 }, (_, index) => ({
              ref: `zotero://user/0/annotation/${index.toString().padStart(8, '0')}`,
              type: index % 2 === 0 ? 'highlight' : 'underline',
              text: 'Synthetic bench annotation',
              position: {
                pageIndex: index < 500 ? 0 : 1,
                rects: [{ x: 28 + (index % 20) * 4, y: 34 + (index % 51), width: 5, height: 4 }],
              },
            })),
          )
          const annotationRenderMs = performance.now() - annotationStart
          const countMarks = (/** @type {number} */ page) =>
            articlePane.shadowRoot?.querySelectorAll(
              `.page[data-page-number="${page}"] .zoteroAnnotations [data-annotation]`,
            ).length ?? 0
          const firstPageMarks = countMarks(1)
          articleControls.goTo(2)
          await canvasOf(articlePane, 2)
          const secondPageMarks = countMarks(2)
          const jump = performance.now()
          scanControls.goTo(320)
          const lastCanvas = await canvasOf(scanPane, 320)
          const retained = hosts.map(
            (node) => node.shadowRoot?.querySelectorAll('.page canvas').length ?? 0,
          )
          return {
            scanFirstCanvasMs: Math.round(scanCanvas - start),
            articleFirstCanvasMs: Math.round(articleCanvas - start),
            scanLastPageCanvasMs: Math.round(lastCanvas - jump),
            longestMainThreadTaskMs: Math.round(longestTask),
            retainedCanvases: retained,
            annotationRenderMs: Math.round(annotationRenderMs),
            annotationMarksByPage: [firstPageMarks, secondPageMarks],
          }
        } finally {
          controller.abort()
          for (const node of hosts) node.remove()
          observer.disconnect()
        }
      },
      { scan, article: fixturePdf() },
    )
    assert.ok((measurements.retainedCanvases[0] ?? Infinity) < 30)
    assert.deepEqual(measurements.annotationMarksByPage, [500, 500])
    for (let attempt = 0; attempt < 25 && page.workers().length > 0; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(page.workers().length, 0)
    console.log('Reader PDF concurrent raster and text benchmark', {
      browser: browser.version(),
      scanBytes: scan.length,
      ...measurements,
      remainingWorkers: page.workers().length,
    })
  }
  await verifyPaperLayout(page)
  await verifyTextCapture(page)
  assert.deepEqual(pageErrors, [])
  process.stdout.write(`Reader PDF browser smoke passed (${engine} ${browser.version()})\n`)
} finally {
  try {
    await browser.close()
  } finally {
    if (firefoxDataRoot) await rm(firefoxDataRoot, { recursive: true, force: true })
  }
}
