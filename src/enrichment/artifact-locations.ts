import {
  ZOTERO_ARTIFACT_LOCATION_LABEL_CHARS,
  ZOTERO_ARTIFACT_LOCATION_LIMIT,
  ZOTERO_ARTIFACT_REGION_TEXT_CHARS,
  type ZoteroArtifactLocationView,
  type ZoteroArtifactRegionTextView,
  type ZoteroArtifactTextRegion,
} from '../contract.js'

export const ARTIFACT_LOCATION_FILE_BYTES = 256 * 1024
// Reading, decoding and parsing the bounded JSON may coexist with the frame.
export const ARTIFACT_LOCATION_READ_BYTES = 16 * ARTIFACT_LOCATION_FILE_BYTES

function boxOf(value: unknown): ZoteroArtifactLocationView['box'] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((edge) => Number.isInteger(edge) && edge >= 0 && edge <= 1000)
  )
    return undefined
  const [left, top, right, bottom] = value
  if (left < right && top < bottom) return [left, top, right, bottom]
  return undefined
}

function labelOf(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : undefined
  if (!text) return undefined
  const end = ZOTERO_ARTIFACT_LOCATION_LABEL_CHARS
  const boundary = text.charCodeAt(end - 1)
  return text.slice(0, boundary >= 0xd800 && boundary <= 0xdbff ? end - 1 : end)
}

/** Only whole cached text blocks contained by the capture can be quoted. */
export function artifactRegionTextOf(
  rows: unknown,
  regions: readonly ZoteroArtifactTextRegion[],
  pageCount?: number,
): ZoteroArtifactRegionTextView | undefined {
  if (!Array.isArray(rows)) return undefined
  const pages = new Map(regions.map((region) => [region.pageIndex, region.box]))
  const passages = new Map<number, string[]>()
  let incomplete = false
  for (const row of rows) {
    if (!row || (row.type !== 'text' && row.type !== 'heading') || typeof row.text !== 'string')
      continue
    const { page_idx: pageIndex } = row
    const region = pages.get(pageIndex)
    if (!region || pageIndex >= (pageCount ?? Infinity) || !row.text.trim()) continue
    const box = boxOf(row.bbox)
    if (!box) {
      incomplete = true
      continue
    }
    const [left, top, right, bottom] = region
    const [x1, y1, x2, y2] = box
    if (x2 <= left || x1 >= right || y2 <= top || y1 >= bottom) continue
    if (x1 < left || x2 > right || y1 < top || y2 > bottom) {
      incomplete = true
      continue
    }
    const text = passages.get(pageIndex) ?? []
    text.push(row.text.trim())
    passages.set(pageIndex, text)
  }
  const joined = [...pages.keys()]
    .sort((a, b) => a - b)
    .flatMap((pageIndex) => passages.get(pageIndex) ?? [])
    .join('\n\n')
  if (!joined) return undefined
  const limit = ZOTERO_ARTIFACT_REGION_TEXT_CHARS
  const text = joined.slice(0, (joined.codePointAt(limit - 1) ?? 0) > 0xffff ? limit - 1 : limit)
  return { text, incomplete: incomplete || passages.size < pages.size || joined.length > limit }
}

/** Flat MinerU content lists use zero-based pages. Other formats lack this coordinate contract. */
export function artifactLocationsOf(
  rows: unknown,
  pageCount?: number,
): readonly ZoteroArtifactLocationView[] | undefined {
  // Return the complete list or use the Markdown fallback. A truncated index
  // could make a repeated region look unique.
  if (!Array.isArray(rows) || rows.length > ZOTERO_ARTIFACT_LOCATION_LIMIT) return undefined
  const locations: ZoteroArtifactLocationView[] = []
  for (const row of rows) {
    if (
      row === null ||
      typeof row !== 'object' ||
      !Number.isSafeInteger(row.page_idx) ||
      row.page_idx < 0 ||
      row.page_idx >= (pageCount ?? 2 ** 31 - 1)
    )
      continue
    const { type, text_level, page_idx: pageIndex } = row
    const kind =
      type === 'text' && Number.isInteger(text_level) && text_level > 0 ? 'heading' : type
    if (
      kind !== 'text' &&
      kind !== 'heading' &&
      kind !== 'image' &&
      kind !== 'chart' &&
      kind !== 'table' &&
      kind !== 'equation'
    )
      continue
    const caption = row[`${type}_caption`]
    const label = labelOf(
      Array.isArray(caption) ? caption.find((value) => typeof value === 'string') : row.text,
    )
    const box = boxOf(row.bbox)
    locations.push({ kind, pageIndex, ...(box && { box }), ...(label && { label }) })
  }
  return locations.length ? locations : undefined
}
