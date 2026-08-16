/**
 * Card-sized presentation projections for the five Zotero tools. Each
 * projector is a pure function of the canonical tool output (plus, for
 * export, the requested ref count) and feeds `output.presentationMeta`, so
 * the projected facts persist into the `tool/result` event's `meta` and
 * reach the browser as `block.meta` — the dedicated Zotero web view renders
 * from them. A single UTF-8 byte budget bounds the whole projection;
 * over-budget projections drop their detail field and set `detailOmitted`
 * instead of inventing per-field truncation policy — the complete data stays
 * in the canonical result and the trajectory Inspect.
 * @module dsh-zotero/presentation-meta
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { ZoteroEvidenceSource } from './types.js'

/** UTF-8 byte budget for one tool's presentation meta. */
export const MAX_PRESENTATION_META_BYTES = 8192

/** Logical caps applied inside each projector before the byte budget. */
export const MAX_PRESENTATION_SEARCH_ROWS = 20
/** Row-bytes allowance inside the search projection (kept well under the total budget). */
export const MAX_PRESENTATION_SEARCH_ROWS_BYTES = 6144
export const MAX_PRESENTATION_SEARCH_TITLE_CHARS = 120
export const MAX_PRESENTATION_SEARCH_CREATOR_CHARS = 60
export const MAX_PRESENTATION_PREVIEW_CHARS = 200
export const MAX_PRESENTATION_GET_TITLE_CHARS = 200
export const MAX_PRESENTATION_GET_CREATORS_CHARS = 120
export const MAX_PRESENTATION_GET_VENUE_CHARS = 200
export const MAX_PRESENTATION_PREVIEW_RECORDS = 2
export const MAX_PRESENTATION_EVIDENCE_CHARS = 400
export const MAX_PRESENTATION_EVIDENCE_PASSAGES = 4

/** The search projection's row shape (subset of the tool output record). */
export interface SearchRowInput {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  readonly itemType: string
}

/** The canonical search output the projector reads. */
export interface SearchProjectionInput {
  readonly items: readonly SearchRowInput[]
  readonly total: number
  readonly returned: number
  readonly nextOffset?: number
  /** Canonical-record fields the projection ignores (accepted for shape compatibility). */
  readonly scope?: unknown
  readonly offset?: number
}

/** One compact search row: the card's list unit with its copyable ref. */
export interface ZoteroSearchPresentationRow {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  readonly itemType: string
}

export interface ZoteroSearchPresentationMeta {
  readonly returned: number
  readonly total: number
  readonly nextOffset: number | null
  readonly displayed: number
  readonly omitted: number
  readonly items: ZoteroSearchPresentationRow[]
}

/** One bounded child preview: personal note/annotation, kept distinct from item metadata. */
export interface ZoteroChildPreview {
  readonly ref: string
  readonly preview: string
  readonly pageLabel?: string
}

export interface ZoteroChildCount {
  readonly total: number
  readonly returned: number
}

/** The canonical get output the projector reads (subset of the tool output record). */
export interface GetProjectionInput {
  readonly title: string
  readonly creators: readonly string[]
  readonly year?: number
  readonly venue?: string
  readonly notes?: {
    readonly total: number
    readonly returned: number
    readonly items: readonly {
      readonly ref: string
      readonly text: string
      readonly truncated?: boolean
      readonly parentRef?: string
    }[]
  }
  readonly annotations?: {
    readonly total: number
    readonly returned: number
    readonly items: readonly {
      readonly ref: string
      readonly text: string
      readonly pageLabel?: string
      readonly type?: string
      readonly comment?: string
      readonly color?: string
    }[]
  }
  readonly attachments?: {
    readonly total: number
    readonly returned: number
    readonly items?: unknown
  }
  readonly bestAttachment?: {
    readonly contentType: string
    readonly ref?: string
    readonly title?: string
  }
  /** Canonical-record fields the projection ignores (accepted for shape compatibility). */
  readonly ref?: string
  readonly itemType?: string
  readonly date?: string
  readonly abstract?: string
  readonly abstractTruncated?: boolean
  readonly tags?: unknown
  readonly collections?: unknown
  readonly children?: unknown
}

export interface ZoteroGetPresentationMeta {
  readonly title: string
  readonly creators: string
  readonly year?: number
  readonly venue?: string
  /** The item's own type, so the corpus can keep notes out of the target rule. */
  readonly itemType?: string
  readonly notes?: ZoteroChildCount
  readonly annotations?: ZoteroChildCount
  readonly attachments?: ZoteroChildCount
  readonly bestAttachmentContentType?: string
  readonly notesPreview: ZoteroChildPreview[]
  readonly annotationsPreview: ZoteroChildPreview[]
}

/** One ranked evidence passage with its provenance and source kind. */
export interface ZoteroEvidencePresentationItem {
  readonly source: ZoteroEvidenceSource
  readonly sourceRef: string
  readonly preview: string
  readonly previewTruncated: boolean
  readonly pageLabel?: string
}

export interface ZoteroRetrievePresentationMeta {
  readonly count: number
  readonly sources: ZoteroEvidenceSource[]
  readonly truncated: boolean
  readonly sourcesSkipped: ZoteroEvidenceSource[]
  readonly items: ZoteroEvidencePresentationItem[]
}

/** The retrieval facts the projection reads (the schema-inferred output satisfies this). */
export interface RetrieveProjectionInput {
  readonly evidence: ReadonlyArray<{
    readonly source: string
    readonly sourceRef: string
    readonly text: string
    readonly pageLabel?: string
    readonly chunkIndex?: number
    readonly chunkCount?: number
    readonly comment?: string
  }>
  readonly truncated: boolean
  readonly sourcesSkipped: readonly string[]
}

export interface ZoteroAttachmentPresentationMeta {
  readonly kind: 'file' | 'url'
  readonly title: string
  readonly contentType: string
  readonly path?: string
  readonly url?: string
}

export interface ZoteroExportPresentationMeta {
  readonly format: string
  readonly requested: number
  /** Actual exported citation count (citation arm only; text formats carry no per-item count). */
  readonly count?: number
  readonly style?: string
  readonly locale?: string
}

/** The canonical attachment output the projector reads (discriminated on `kind`). */
export type AttachmentProjectionInput =
  | {
      readonly kind: 'file'
      readonly title: string
      readonly contentType: string
      readonly path: string
      readonly ref?: string
    }
  | {
      readonly kind: 'url'
      readonly title: string
      readonly contentType: string
      readonly url: string
      readonly ref?: string
    }

/** Cut text at a character cap for a card preview. */
function truncateChars(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(0, cap)
}

/** Distinct sources in first-seen order. */
function sourcesOf(evidence: ReadonlyArray<{ readonly source: string }>): ZoteroEvidenceSource[] {
  const seen = new Set<string>()
  const sources: ZoteroEvidenceSource[] = []
  for (const entry of evidence) {
    if (!seen.has(entry.source)) {
      seen.add(entry.source)
      // The output schema pins the source vocabulary; the projection reuses it.
      sources.push(entry.source as ZoteroEvidenceSource)
    }
  }
  return sources
}

/**
 * Project one search result into card-sized facts. Rows are bounded by both
 * a logical cap and a row-bytes allowance, so a normal page projects whole
 * (no arbitrary 6-row cut) while a heavy page still fits the shared budget
 * without ever tripping the detail-dropping overflow.
 * @param value - the canonical search result.
 * @returns the bounded projection.
 */
export function projectSearchMeta(value: SearchProjectionInput): ZoteroSearchPresentationMeta {
  const items: ZoteroSearchPresentationRow[] = []
  let bytes = 0
  for (const item of value.items) {
    if (items.length >= MAX_PRESENTATION_SEARCH_ROWS) break
    const row: ZoteroSearchPresentationRow = {
      ref: item.ref,
      title: truncateChars(item.title, MAX_PRESENTATION_SEARCH_TITLE_CHARS),
      creatorSummary: truncateChars(item.creatorSummary, MAX_PRESENTATION_SEARCH_CREATOR_CHARS),
      ...(item.year === undefined ? {} : { year: item.year }),
      itemType: item.itemType,
    }
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8')
    // The first row always fits; later rows stop once the allowance is spent.
    if (items.length > 0 && bytes + rowBytes > MAX_PRESENTATION_SEARCH_ROWS_BYTES) break
    items.push(row)
    bytes += rowBytes
  }
  const displayed = items.length
  return {
    returned: value.returned,
    total: value.total,
    nextOffset: value.nextOffset ?? null,
    displayed,
    omitted: value.returned - displayed,
    items,
  }
}

/** One child collection into bounded previews. */
function childPreviews(
  items: ReadonlyArray<{ readonly ref: string; readonly text: string }>,
): ZoteroChildPreview[] {
  return items.slice(0, MAX_PRESENTATION_PREVIEW_RECORDS).map((item) => ({
    ref: item.ref,
    preview: truncateChars(item.text, MAX_PRESENTATION_PREVIEW_CHARS),
  }))
}

/**
 * Project one item detail into card-sized facts: the header line, child
 * counts, and (when requested) bounded note/annotation previews kept apart
 * from the item's own metadata.
 * @param value - the canonical item detail.
 * @returns the bounded projection.
 */
export function projectGetMeta(value: GetProjectionInput): ZoteroGetPresentationMeta {
  return {
    title: truncateChars(value.title, MAX_PRESENTATION_GET_TITLE_CHARS),
    creators: truncateChars(value.creators.join('; '), MAX_PRESENTATION_GET_CREATORS_CHARS),
    ...(value.year === undefined ? {} : { year: value.year }),
    ...(value.itemType === undefined ? {} : { itemType: value.itemType }),
    ...(value.venue === undefined
      ? {}
      : { venue: truncateChars(value.venue, MAX_PRESENTATION_GET_VENUE_CHARS) }),
    ...(value.notes === undefined
      ? {}
      : { notes: { total: value.notes.total, returned: value.notes.returned } }),
    ...(value.annotations === undefined
      ? {}
      : { annotations: { total: value.annotations.total, returned: value.annotations.returned } }),
    ...(value.attachments === undefined
      ? {}
      : { attachments: { total: value.attachments.total, returned: value.attachments.returned } }),
    ...(value.bestAttachment === undefined
      ? {}
      : { bestAttachmentContentType: value.bestAttachment.contentType }),
    notesPreview: value.notes === undefined ? [] : childPreviews(value.notes.items),
    annotationsPreview:
      value.annotations === undefined
        ? []
        : value.annotations.items.slice(0, MAX_PRESENTATION_PREVIEW_RECORDS).map((annotation) => ({
            ref: annotation.ref,
            preview: truncateChars(annotation.text, MAX_PRESENTATION_PREVIEW_CHARS),
            ...(annotation.pageLabel === undefined ? {} : { pageLabel: annotation.pageLabel }),
          })),
  }
}

/**
 * Project one retrieval result into card-sized evidence facts. Fulltext
 * passages never carry page locators — the projection copies what the
 * canonical record owns and nothing more.
 * @param value - the canonical retrieval result.
 * @returns the bounded projection.
 */
export function projectRetrieveMeta(
  value: RetrieveProjectionInput,
): ZoteroRetrievePresentationMeta {
  const items = value.evidence.slice(0, MAX_PRESENTATION_EVIDENCE_PASSAGES).map((entry) => {
    const preview = truncateChars(entry.text, MAX_PRESENTATION_EVIDENCE_CHARS)
    return {
      source: entry.source as ZoteroEvidenceSource,
      sourceRef: entry.sourceRef,
      preview,
      previewTruncated: entry.text.length > preview.length,
      ...(entry.pageLabel === undefined ? {} : { pageLabel: entry.pageLabel }),
    }
  })
  return {
    count: value.evidence.length,
    sources: sourcesOf(value.evidence),
    truncated: value.truncated,
    sourcesSkipped: [...value.sourcesSkipped] as ZoteroEvidenceSource[],
    items,
  }
}

/**
 * Project one attachment location into card-sized facts; the full path or
 * URL stays the copyable canonical value.
 * @param value - the canonical attachment location.
 * @returns the bounded projection.
 */
export function projectAttachmentMeta(
  value: AttachmentProjectionInput,
): ZoteroAttachmentPresentationMeta {
  const title = truncateChars(value.title, MAX_PRESENTATION_GET_TITLE_CHARS)
  if (value.kind === 'file') {
    return { kind: value.kind, title, contentType: value.contentType, path: value.path }
  }
  return { kind: value.kind, title, contentType: value.contentType, url: value.url }
}

/**
 * Project one export result into card-sized facts. The citation arm counts
 * the actually exported citations; the text formats are opaque joined text,
 * so they report the requested ref count instead of inventing an item count.
 * @param requested - the requested ref count from the call arguments.
 * @param value - the canonical export result.
 * @returns the bounded projection.
 */
export function projectExportMeta(
  requested: number,
  value: {
    readonly format: string
    readonly style?: string
    readonly locale?: string
    readonly citations?: readonly { readonly ref: string; readonly text: string }[]
    readonly text?: string
  },
): ZoteroExportPresentationMeta {
  const base = {
    format: value.format,
    requested,
    ...(value.style === undefined
      ? {}
      : { style: truncateChars(value.style, MAX_PRESENTATION_GET_TITLE_CHARS) }),
    ...(value.locale === undefined
      ? {}
      : { locale: truncateChars(value.locale, MAX_PRESENTATION_GET_TITLE_CHARS) }),
  }
  if (value.format === 'citation') {
    return { ...base, count: value.citations?.length ?? 0 }
  }
  return base
}

/** The UTF-8 byte size of one JSON projection. */
export function presentationMetaBytes(meta: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(meta), 'utf8')
}

/**
 * Enforce the shared byte budget. A projection that fits returns unchanged;
 * an over-budget one drops its detail keys (keeping the summary facts) and
 * records `detailOmitted` — no per-field truncation is invented here, the
 * complete data stays in the canonical result.
 * @param meta - one projector's output.
 * @param detailKeys - the keys holding per-item detail rows or long values.
 * @returns the bounded projection.
 */
export function boundedPresentationMeta(meta: unknown, detailKeys: readonly string[]): JsonValue {
  // Every projector produces a plain object; non-object inputs (defensive
  // arm) pass through untouched.
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return meta as JsonValue
  const record = meta as Record<string, unknown>
  if (presentationMetaBytes(record) <= MAX_PRESENTATION_META_BYTES) return meta as JsonValue
  const reduced: Record<string, unknown> = { detailOmitted: true }
  for (const [key, value] of Object.entries(record)) {
    if (!detailKeys.includes(key)) reduced[key] = value
  }
  return reduced as unknown as JsonValue
}
