// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bytes, host, lifetime, pdf, sawPage } from './support/pdf-runtime.ts'
import { mountPdf } from '../../../src/client/reader/pdf-runtime.ts'
import { deferred } from '../../helpers/sync.ts'

it('waits for the matched page to render before painting precise quote geometry', async () => {
  const ready = deferred<void>()
  const controls = await mountPdf(host, bytes, lifetime.signal, ({ page }) => {
    if (page === 2) ready.resolve()
  })
  const layer = host.shadowRoot!.querySelector<HTMLElement>('[data-page-number="2"] .textLayer')!
  layer.hidden = true
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() =>
    Object.defineProperty(createRange(), 'getClientRects', {
      value: () => [new DOMRect(12, 20, 40, 8)],
    }),
  )
  const locating = controls.locateEvidence(
    { sourceType: 'bm25', quote: 'for page 2' },
    lifetime.signal,
  )
  await ready.promise
  pdf.bus!.dispatch('textlayerrendered', { pageNumber: 1 })
  expect(host.shadowRoot!.querySelector('.zoteroEvidenceRegion')).toBeNull()
  layer.hidden = false
  pdf.bus!.dispatch('textlayerrendered', { pageNumber: 2 })
  await expect(locating).resolves.toEqual({ kind: 'region', pageIndex: 1 })
  const mark = layer.parentElement!.querySelector<HTMLElement>('.zoteroEvidenceRegion')!
  expect(mark.style.left).toBe('7.5%')
  expect(mark.style.top).toBe('20%')
  expect(mark.style.width).toBe('25%')
})

it('keeps ambiguous passages and cross-page passages from receiving a misleading box', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  await expect(
    controls.locateEvidence({ sourceType: 'bm25', quote: 'Text for page' }, lifetime.signal),
  ).resolves.toEqual({ kind: 'ambiguous', pages: [0, 1] })
  await expect(
    controls.locateEvidence({ sourceType: 'bm25', quote: 'page 1 Text for' }, lifetime.signal),
  ).resolves.toEqual({ kind: 'page', pageIndex: 0, endPageIndex: 1 })
  await expect(
    controls.locateEvidence({ sourceType: 'bm25', quote: 'absent excerpt' }, lifetime.signal),
  ).resolves.toEqual({ kind: 'missing' })
  expect(host.shadowRoot!.querySelector('.zoteroEvidenceRegion')).toBeNull()
})

it('converts a verified parser region back and forth in the upright source page space', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  controls.rotate()
  const region = { pageIndex: 1, box: [100, 200, 500, 600] as const }
  const position = await controls.artifactPosition(region, lifetime.signal)
  expect(position).toEqual({
    pageIndex: 1,
    rects: [{ x: 16, y: 40, width: 64, height: 40 }],
  })
  await expect(controls.artifactSelection(position, lifetime.signal)).resolves.toEqual(region)
  await expect(controls.readExcerpt(2, 2, lifetime.signal)).resolves.toMatchObject({
    text: 'Text for page 2',
    pages: [{ pageIndex: 1, pageLabel: '1', textRange: { start: 0, end: 15 } }],
  })
})

it.each([
  { pageIndex: 9, box: [100, 200, 500, 600] as const },
  { pageIndex: 0, box: [500, 200, 100, 600] as const },
  { pageIndex: 0, box: [100, 200, 500, 1001] as const },
  { pageIndex: 0 },
])('keeps invalid parser geometry at page level for %j', async (region) => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  await expect(controls.artifactPosition(region, lifetime.signal)).resolves.toEqual({
    pageIndex: region.pageIndex,
    rects: [],
  })
})

it('rejects parser geometry from an intrinsically rotated source page', async () => {
  pdf.page.mockResolvedValue({ rotate: 90 })
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const region = { pageIndex: 0, box: [100, 200, 500, 600] as const }
  await expect(controls.artifactPosition(region, lifetime.signal)).resolves.toEqual({
    pageIndex: 0,
    rects: [],
  })
  await expect(
    controls.artifactSelection(
      {
        pageIndex: 0,
        rects: [{ x: 16, y: 40, width: 64, height: 40 }],
      },
      lifetime.signal,
    ),
  ).resolves.toBeUndefined()
})

it('shares no false parser region for empty or fully off-page PDF geometry', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  await expect(
    controls.artifactSelection({ pageIndex: 0, rects: [] }, lifetime.signal),
  ).resolves.toBeUndefined()
  await expect(
    controls.artifactSelection(
      { pageIndex: 0, rects: [{ x: 170, y: 20, width: 10, height: 10 }] },
      lifetime.signal,
    ),
  ).resolves.toBeUndefined()
})

it('opens a verified physical page when the text layer returns no usable geometry', async () => {
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage)
  const makeRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() =>
    Object.defineProperty(makeRange(), 'getClientRects', { value: () => [] }),
  )

  await expect(
    controls.locateEvidence({ sourceType: 'semantic', quote: 'for page 2' }, lifetime.signal),
  ).resolves.toEqual({ kind: 'page', pageIndex: 1 })
  expect(sawPage.mock.lastCall?.[0].page).toBe(2)
  expect(host.shadowRoot?.querySelector('.zoteroEvidenceRegion')).toBeNull()
})
