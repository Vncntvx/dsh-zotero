/**
 * Pure block readers shared by the Sources panel.
 * Extracts call state, presentation facts, and tool arguments from frozen blocks.
 * @module dsh-zotero/sources/presenters
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ArgsView, ToolBlockLike } from './block-types.js'
import type { EvidenceItem, EvidenceField, EvidenceMatchKind } from '../evidence-item.js'
import { isEvidenceMatchKind, isEvidenceSource } from '../evidence-item.js'
import { boolField, isRecord, stringField } from '../json.js'
import { REF_IN_TEXT_PATTERN } from '../ref-grammar.js'

export type ZoteroRowState = 'running' | 'ok' | 'error' | 'stopped'

/**
 * True when a call block carries its settled result.
 *
 * The harness does export its own `isSettledTool` from
 * `@deepseek-ai/dsh-client-ui-chat/client`, but this module is also loaded by
 * the host half, which must not load a client entry; the local mirror keeps the
 * check type-only. It is still a mirror: re-check the upstream predicate on
 * every pin upgrade (`docs/development.md`, the pin checklist).
 */
export function isSettledTool(
  block: ToolBlockLike,
): block is Extract<ToolBlockLike, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * True while a call is running, in either `preparing` (arguments still
 * streaming, no parsed args) or `start` (dispatched, awaiting result). Cards
 * use this to select their in-progress copy; checking `phase === 'start'` alone
 * shows a preparing call the settled fallback.
 */
export function isToolRunning(block: ToolBlockLike): boolean {
  return !isSettledTool(block)
}

/** The wire name of one tool call block (settled and running forms). */
export function callNameOf(block: ToolBlockLike): string | null {
  return isSettledTool(block) ? (block.call?.name ?? null) : block.name
}

/** The validated presentation-meta object, or null when absent or malformed. */
export function metaOf(block: ToolBlockLike): Record<string, unknown> | null {
  if (!isSettledTool(block)) return null
  return isRecord(block.meta) ? block.meta : null
}

/** Lifecycle state derived from the frozen block, independent of meta. */
export function rowStateOf(block: ToolBlockLike): ZoteroRowState {
  if (!isSettledTool(block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/**
 * Flatten settled content blocks to display text. The harness's `resultText`
 * (`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`) is not
 * exported from its package's `./client` entry, so a mirror is the only option;
 * the semantics are copied exactly: text blocks verbatim, other block shapes as
 * pretty JSON, empty content on a failed call falling back to the structured
 * error's `name: code` line, otherwise the empty string. Running blocks return
 * null (the harness helper only accepts settled nodes); callers normalize with
 * `?? ''`. Re-check it on every pin upgrade (`docs/development.md`).
 */
/**
 * The first text block of a settled result: the artifact bytes a card copies
 * or downloads, kept apart from any block the render appends after it.
 * Running blocks return null.
 */
export function resultFirstTextOf(block: ToolBlockLike): string | null {
  if (!isSettledTool(block)) return null
  for (const item of block.content) {
    if (item.type === 'text') return item.text
  }
  return ''
}

export function resultTextOf(block: ToolBlockLike): string | null {
  if (!isSettledTool(block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    if (item.type === 'text') parts.push(item.text)
    else parts.push(JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  if (parts.length === 0) return ''
  return parts.join('\n')
}

/** Single-line error summary derived from settled error content, or null when not errored. */
export function errorSummaryOf(block: ToolBlockLike, rawText?: string | null): string | null {
  if (rowStateOf(block) !== 'error') return null
  const text = rawText !== undefined ? rawText : resultTextOf(block)
  return text ? text.split('\n')[0]?.trim() || null : null
}

/**
 * The block's argument view, materialized by the harness on every call head
 * and result (`ToolCallHead.args` / `ToolResultNode.args`).
 * @param block - call block to read.
 * @returns the block's argument view.
 */
export function argsViewOf(block: ToolBlockLike): ArgsView {
  return block.args
}

/** A string argument, including the streaming prefix while it is still open. */
export function textArg(view: ArgsView, key: string): string | undefined {
  return view.text(key)
}

/** A non-string argument; undefined while that field is still open or absent. */
export function valueArg(view: ArgsView, key: string): JsonValue | undefined {
  return view.value(key)
}

/** String entries of an array argument; empty when absent, incomplete, or not an array. */
export function listArg(view: ArgsView, key: string): string[] {
  const value = valueArg(view, key)
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** A non-negative finite numeric argument, or `fallback` when absent or unusable. */
export function numberArg(view: ArgsView, key: string, fallback = 0): number {
  const value = valueArg(view, key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** A boolean argument: true only for a completed JSON `true`. */
export function boolArg(view: ArgsView, key: string): boolean {
  return valueArg(view, key) === true
}

/** A plain-object argument, or null when absent, incomplete, or not an object. */
export function recordArg(view: ArgsView, key: string): Record<string, unknown> | null {
  const value = valueArg(view, key)
  return isRecord(value) ? value : null
}

/** The 8-character object key of a zotero:// ref, or null for other strings. */
export function shortKeyOf(value: string): string | null {
  return REF_IN_TEXT_PATTERN.exec(value)?.groups?.key ?? null
}

/** Evidence items from the retrieve projection; null when malformed. */
export function evidenceItemsOf(meta: Record<string, unknown>): EvidenceItem[] | null {
  const items = meta['items']
  if (!Array.isArray(items)) return null
  const rows: EvidenceItem[] = []
  for (const item of items) {
    if (!isRecord(item)) return null
    const source = stringField(item, 'source')
    const sourceRef = stringField(item, 'sourceRef')
    const preview = stringField(item, 'preview')
    if (source === undefined || sourceRef === undefined || preview === undefined) return null
    // The source must be the wire's own vocabulary: an unchecked cast would
    // let an unknown string through to the labels, which would misreport the
    // passage's provenance instead of rejecting the malformed meta.
    if (!isEvidenceSource(source)) return null
    const previewTruncated = boolField(item, 'previewTruncated') === true
    const pageLabel = stringField(item, 'pageLabel')
    const attachmentRef = stringField(item, 'attachmentRef')
    const matchKind = matchKindOf(item['matchKind'])
    const matchedFields = matchedFieldsOf(item['matchedFields'])
    const fulltextFacts = source === 'fulltext' ? fulltextFactsOf(item) : {}
    if (fulltextFacts === null) return null
    rows.push({
      source,
      sourceRef,
      preview,
      previewTruncated,
      ...fulltextFacts,
      ...(pageLabel === undefined ? {} : { pageLabel }),
      ...(attachmentRef === undefined ? {} : { attachmentRef }),
      ...(matchKind === undefined ? {} : { matchKind }),
      ...(matchedFields === undefined ? {} : { matchedFields }),
    })
  }
  return rows
}

/** Decode optional fulltext facts without accepting partial or conflicting provenance. */
function fulltextFactsOf(
  item: Record<string, unknown>,
): Pick<EvidenceItem, 'textFormat' | 'artifact' | 'start' | 'end'> | null {
  const textFormat = item['textFormat']
  if (textFormat !== undefined && textFormat !== 'markdown' && textFormat !== 'text') return null
  const artifact = artifactOf(item['artifact'])
  if (item['artifact'] !== undefined && (artifact === undefined || textFormat !== 'markdown')) {
    return null
  }
  const start = item['start']
  const end = item['end']
  if (
    (start !== undefined || end !== undefined) &&
    (typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start)
  ) {
    return null
  }
  return {
    ...(textFormat === undefined ? {} : { textFormat }),
    ...(artifact === undefined ? {} : { artifact }),
    ...(typeof start === 'number' && typeof end === 'number' ? { start, end } : {}),
  }
}

/** Every artifact identity field is needed to attribute a replayed passage. */
function artifactOf(value: unknown): EvidenceItem['artifact'] {
  if (!isRecord(value)) return undefined
  const { parser, mode, artifactId, fingerprint, sourceId, generation } = value
  if (
    parser !== 'mineru' ||
    (mode !== 'free' && mode !== 'pro') ||
    typeof artifactId !== 'string' ||
    artifactId.length === 0 ||
    typeof fingerprint !== 'string' ||
    fingerprint.length === 0 ||
    typeof sourceId !== 'string' ||
    sourceId.length === 0 ||
    typeof generation !== 'string' ||
    generation.length === 0
  ) {
    return undefined
  }
  return { parser, mode, artifactId, fingerprint, sourceId, generation }
}

/**
 * The recorded match kind, or `undefined` when the record names no kind the
 * wire defines. Records written before this field existed have no kind, so the
 * badge is absent; inventing `lexical` would assert shared wording that the
 * record does not establish.
 */
function matchKindOf(value: unknown): EvidenceMatchKind | undefined {
  if (typeof value !== 'string') return undefined
  return isEvidenceMatchKind(value) ? value : undefined
}

/**
 * The two-field names a passage reports, keeping only the wire's own
 * vocabulary. Anything else (an unknown name, a non-array) reads as absent,
 * which is the single-field case the badge does not need to distinguish.
 */
function matchedFieldsOf(value: unknown): readonly EvidenceField[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fields = value.filter(
    (entry): entry is EvidenceField => entry === 'text' || entry === 'comment',
  )
  return fields.length === 0 ? undefined : fields
}

/** Join a metadata line's non-empty parts with the middot separator. */
export function joinNonEmpty(...parts: Array<string | number | undefined>): string {
  return parts.filter((part) => part !== undefined && part !== '').join(' · ')
}

/**
 * Format a Date or timestamp as `HH:MM:SS` (default) or `HH:MM`.
 * Shared across diagnostics, sources tab, and export artifacts.
 */
export function formatTime(dateOrMs: Date | number, includeSeconds = true): string {
  const date = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  if (!includeSeconds) {
    return `${hours}:${minutes}`
  }
  return `${hours}:${minutes}:${pad(date.getSeconds())}`
}
