import type { ZoteroArtifactLocationView, ZoteroArtifactMetadataView } from '../../contract.ts'
import type { PdfArtifactRegion } from '../../reader/evidence.ts'
import type { ParsedPassage } from '../parsed-tab.ts'

export function findParsedRegion(
  locations: readonly ZoteroArtifactLocationView[],
  target: PdfArtifactRegion,
) {
  if (!target.box) return undefined
  const [left, top, right, bottom] = target.box
  if (left >= right || top >= bottom) return undefined
  const area = (right - left) * (bottom - top)
  if (!Number.isFinite(area) || area <= 0) return undefined
  let match: number | undefined
  for (const [index, location] of locations.entries()) {
    if (location.pageIndex !== target.pageIndex || !location.box) continue
    const [x1, y1, x2, y2] = location.box
    const overlap =
      Math.max(0, Math.min(right, x2) - Math.max(left, x1)) *
      Math.max(0, Math.min(bottom, y2) - Math.max(top, y1))
    if (overlap < 0.8 * Math.min(area, (x2 - x1) * (y2 - y1))) continue
    if (match !== undefined) return undefined
    match = index
  }
  return match
}

export function findParsedPassage(
  body: HTMLElement,
  metadata: ZoteroArtifactMetadataView,
  passage: ParsedPassage,
) {
  if (passage.fingerprint !== metadata.fingerprint || passage.attachmentRef !== metadata.sourceRef)
    return { status: 'parsedPassageChanged' } as const
  if (typeof passage.quote !== 'string' || passage.quote.length > 2_000)
    return { status: 'parsedPassageMissing' } as const
  const quote = passage.quote.replace(/\s+/gu, ' ').trim()
  const selector = 'p, li, h1, h2, h3, h4, h5, h6, pre, th, td'
  let block: Element | undefined
  if (quote) {
    for (const candidate of body.querySelectorAll(selector)) {
      if (candidate.querySelector(selector)) continue
      const text = (candidate.textContent ?? '').replace(/\s+/gu, ' ').trim()
      const first = text.indexOf(quote)
      if (first < 0) continue
      if (block || text.includes(quote, first + 1))
        return { status: 'parsedPassageAmbiguous' } as const
      block = candidate
    }
  }
  return block
    ? ({ status: 'parsedPassageFound', block } as const)
    : ({ status: 'parsedPassageMissing' } as const)
}
