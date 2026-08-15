/**
 * Pure tool-row presenters: the truth ladder from the frozen call block.
 *
 *   state/error            ← block (kind/isError/error.code)
 *   pending title/summary  ← block.callView (generic title/rawInput), then argsRaw
 *   completed title/body   ← block.resultView (generic title), then meta/callView
 *   structured facts       ← block.meta (the tool's presentation projection)
 *   full content fallback  ← block.content, then argsRaw
 *
 * Every function here is deterministic over its inputs — the same log slice
 * renders the same row — and nothing queries Zotero or any registry. Meta is
 * validated defensively: a malformed or absent record degrades to the
 * content text, never crashes the row.
 * @module dsh-zotero/client/presenters
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'

export type ZoteroRowState = 'running' | 'ok' | 'error' | 'stopped'

/** A settled tool result node; running calls never reach meta-dependent views. */
type SettledBlock = ToolResultNode

/** One bounded search row from the search projection. */
export interface SearchRowView {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  readonly itemType: string
}

/** One bounded child preview (note/annotation) from the get projection. */
export interface ChildPreviewView {
  readonly ref: string
  readonly preview: string
  readonly pageLabel?: string
}

/** One evidence passage from the retrieve projection. */
export interface EvidenceItemView {
  readonly source: string
  readonly sourceRef: string
  readonly preview: string
  readonly previewTruncated: boolean
  readonly pageLabel?: string
}

/** The complete row model a Zotero tool card renders. */
export interface ZoteroRowModel {
  readonly state: ZoteroRowState
  readonly title: string
  readonly summary: string
  readonly facts: readonly string[]
  readonly errorSummary: string | null
  /** Full flattened content text when meta is absent and the card needs a body. */
  readonly fallbackText: string | null
}

/** True for plain objects (the validated shape every meta read requires). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a string field off a validated record. */
export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a number field off a validated record. */
export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a boolean field off a validated record. */
export function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

/** The validated presentation-meta object, or null when absent or malformed. */
export function metaOf(block: ToolCallBlock): Record<string, unknown> | null {
  if (!('kind' in block)) return null
  return isRecord(block.meta) ? block.meta : null
}

/** Lifecycle state derived from the frozen block, independent of meta. */
export function rowStateOf(block: ToolCallBlock): ZoteroRowState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/** The pending/completed title: callView intent first, then the fallback. */
export function titleOf(block: ToolCallBlock, fallback: string): string {
  const view = viewOf(block)
  const title = view?.card === 'generic' && view.title !== '' ? view.title : undefined
  return title ?? fallback
}

/** The generic view riding the frame (call view on both running and settled forms). */
function viewOf(block: ToolCallBlock): ToolCallView | null {
  return block.callView ?? null
}

/** The completed title from the result view, when the tool declared one. */
export function resultTitleOf(block: ToolCallBlock): string | undefined {
  if (!('kind' in block)) return undefined
  const view = block.resultView
  if (view?.card === 'generic' && view.title !== undefined && view.title !== '') return view.title
  return undefined
}

/** The salient raw input from the call view (string form only). */
export function rawInputOf(block: ToolCallBlock): string | undefined {
  const view = viewOf(block)
  if (view?.card === 'generic' && typeof view.rawInput === 'string') return view.rawInput
  return undefined
}

/** Flatten settled content blocks to display text (mirrors the harness resultText). */
export function resultTextOf(block: ToolCallBlock): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    if (item.type === 'text') parts.push(item.text)
    else parts.push(JSON.stringify(item as ContentBlock))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/** First line of the flattened result on an error row; null otherwise. */
export function errorSummaryOf(block: ToolCallBlock): string | null {
  const state = rowStateOf(block)
  if (state !== 'error') return null
  const text = resultTextOf(block)
  if (text === null) return null
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** The call arguments parsed from the frozen args string; null when malformed. */
export function argsOf(block: ToolCallBlock): Record<string, unknown> | null {
  const settled = 'kind' in block
  const raw = settled ? (block.call?.argsRaw ?? null) : block.argsRaw
  if (raw === null || raw === '') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The 8-character object key of a zotero:// ref, or null for other strings. */
export function shortKeyOf(value: string): string | null {
  const match =
    /zotero:\/\/user\/0\/(?:item|attachment|annotation|collection|search)\/([A-Z0-9]{8})/.exec(
      value,
    )
  return match?.[1] ?? null
}

/** Display form of a ref or other salient input: the key when parseable. */
export function displayRefOf(rawInput: string | undefined): string {
  if (rawInput === undefined || rawInput === '') return ''
  return shortKeyOf(rawInput) ?? rawInput
}

/** The query argument for search/retrieve pending rows. */
export function queryOf(args: Record<string, unknown>): string {
  const query = args['query']
  return typeof query === 'string' && query !== '' ? query : ''
}

/** The search scope fact for a pending search row. */
export function scopeFactOf(args: Record<string, unknown>): string {
  const mode = args['mode'] === 'everything' ? 'everything' : 'metadata'
  const scope = args['scope']
  if (isRecord(scope)) {
    const kind = scope['kind']
    const name = scope['refOrName']
    if (kind === 'collection' && typeof name === 'string' && name !== '')
      return `collection:${name}`
    if (kind === 'savedSearch' && typeof name === 'string' && name !== '')
      return `savedSearch:${name}`
  }
  return `library:${mode}`
}

/** Bounded search rows from the meta projection; null when malformed. */
export function searchRowsOf(meta: Record<string, unknown>): SearchRowView[] | null {
  const items = meta['items']
  if (!Array.isArray(items)) return null
  const rows: SearchRowView[] = []
  for (const item of items) {
    if (!isRecord(item)) return null
    const ref = stringField(item, 'ref')
    const title = stringField(item, 'title')
    const creatorSummary = stringField(item, 'creatorSummary')
    const itemType = stringField(item, 'itemType')
    if (
      ref === undefined ||
      title === undefined ||
      creatorSummary === undefined ||
      itemType === undefined
    )
      return null
    const year = numberField(item, 'year')
    rows.push({ ref, title, creatorSummary, ...(year === undefined ? {} : { year }), itemType })
  }
  return rows
}

/** The displayed/omitted pair from the search projection. */
export function searchCountsOf(
  meta: Record<string, unknown>,
): { displayed: number; omitted: number } | null {
  const displayed = numberField(meta, 'displayed')
  const omitted = numberField(meta, 'omitted')
  if (displayed === undefined || omitted === undefined) return null
  return { displayed, omitted }
}

/** Bounded child previews from the get projection; null when malformed. */
export function previewsOf(meta: Record<string, unknown>, key: string): ChildPreviewView[] | null {
  const items = meta[key]
  if (!Array.isArray(items)) return null
  const rows: ChildPreviewView[] = []
  for (const item of items) {
    if (!isRecord(item)) return null
    const ref = stringField(item, 'ref')
    const preview = stringField(item, 'preview')
    if (ref === undefined || preview === undefined) return null
    const pageLabel = stringField(item, 'pageLabel')
    rows.push({ ref, preview, ...(pageLabel === undefined ? {} : { pageLabel }) })
  }
  return rows
}

/** Evidence items from the retrieve projection; null when malformed. */
export function evidenceItemsOf(meta: Record<string, unknown>): EvidenceItemView[] | null {
  const items = meta['items']
  if (!Array.isArray(items)) return null
  const rows: EvidenceItemView[] = []
  for (const item of items) {
    if (!isRecord(item)) return null
    const source = stringField(item, 'source')
    const sourceRef = stringField(item, 'sourceRef')
    const preview = stringField(item, 'preview')
    if (source === undefined || sourceRef === undefined || preview === undefined) return null
    const previewTruncated = boolField(item, 'previewTruncated') === true
    const pageLabel = stringField(item, 'pageLabel')
    rows.push({
      source,
      sourceRef,
      preview,
      previewTruncated,
      ...(pageLabel === undefined ? {} : { pageLabel }),
    })
  }
  return rows
}

/** Evidence counts from the retrieve projection; null when malformed. */
export function evidenceCountOf(meta: Record<string, unknown>): number | null {
  return numberField(meta, 'count') ?? null
}

/** The evidence sources list from the retrieve projection. */
export function evidenceSourcesOf(meta: Record<string, unknown>): string[] {
  const sources = meta['sources']
  if (!Array.isArray(sources)) return []
  return sources.filter((source): source is string => typeof source === 'string')
}

/** The truncated flag from the retrieve projection. */
export function evidenceTruncatedOf(meta: Record<string, unknown>): boolean {
  return boolField(meta, 'truncated') === true
}

/** Interpolate the simple {name} placeholders of one locale string. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key]
    return value === undefined ? whole : String(value)
  })
}
