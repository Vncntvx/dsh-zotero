/**
 * Pure block readers shared by the Sources panel: the truth ladder from the
 * frozen call block. State comes from the block structure (kind/isError/
 * error.code); facts come from the tool's presentation projection via the
 * defensive field readers; args come from the frozen args string. Every
 * function here is deterministic over its inputs — the same log slice
 * renders the same panel — and nothing queries Zotero or any registry. Meta
 * is validated defensively: a malformed or absent record degrades to
 * nothing, never crashes the view.
 * @module dsh-zotero/client/presenters
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

export type ZoteroRowState = 'running' | 'ok' | 'error' | 'stopped'

/** One evidence passage from the retrieve projection. */
export interface EvidenceItemView {
  readonly source: string
  readonly sourceRef: string
  readonly preview: string
  readonly previewTruncated: boolean
  readonly pageLabel?: string
  /** The annotation passage's parent attachment ref (its own PDF's deep-link key). */
  readonly attachmentRef?: string
}

/** True for plain objects (the validated shape every meta read requires). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The wire name of one tool call block (settled and running forms). */
export function callNameOf(block: ToolCallBlock): string | null {
  return 'kind' in block ? (block.call?.name ?? null) : block.name
}

/** Stable order key: settled blocks by seq, in-flight calls after them by time. */
export function orderKeyOf(block: ToolCallBlock): number {
  return 'kind' in block ? block.seq : 1_000_000_000 + block.time
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
    const attachmentRef = stringField(item, 'attachmentRef')
    rows.push({
      source,
      sourceRef,
      preview,
      previewTruncated,
      ...(pageLabel === undefined ? {} : { pageLabel }),
      ...(attachmentRef === undefined ? {} : { attachmentRef }),
    })
  }
  return rows
}

/** Interpolate the simple {name} placeholders of one locale string. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key]
    return value === undefined ? whole : String(value)
  })
}

/** Join a metadata line's non-empty parts with the middot separator. */
export function joinNonEmpty(...parts: Array<string | number | undefined>): string {
  return parts.filter((part) => part !== undefined && part !== '').join(' · ')
}
