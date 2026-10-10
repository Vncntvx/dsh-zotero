/**
 * Pure block readers shared by the Sources panel: the truth ladder from the
 * frozen call block. State comes from the block structure (kind/isError/
 * error.code); facts come from the tool's presentation projection via the
 * defensive field readers; args come from the harness's own lazy argument
 * view (`block.args`). Every function here is deterministic over its inputs
 * (the same log slice renders the same panel), and nothing queries Zotero or
 * any registry. Meta is validated defensively: a malformed or absent record
 * degrades to nothing, never crashes the view.
 * @module dsh-zotero/client/presenters
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolArgs, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EvidenceItem, EvidenceField } from '../evidence-item.ts'
import { isEvidenceSource } from '../evidence-item.ts'
import { boolField, isRecord, stringField } from '../json.ts'
import { REF_IN_TEXT_PATTERN } from '../ref-grammar.ts'

// Field readers live in json.ts (CLIENT_SAFE). Re-exported here so toolview
// modules that already import block readers keep one import site.
export { boolField, isRecord, numberField, stringField } from '../json.ts'

export type ZoteroRowState = 'running' | 'ok' | 'error' | 'stopped'

/**
 * True when a call block carries its settled result. Local mirror of the
 * harness's `isSettledTool`
 * (`packages/client/ui-chat/src/client/contract/chat-nodes.ts`): that helper
 * lives in a client entry whose runtime bundle requires the loader
 * environment, so this shared module keeps its harness imports type-only and
 * carries the one-line predicate locally instead of value-importing it.
 */
export function isSettledTool(
  block: ToolCallBlock,
): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * True while a call is still running, in either of the two running phases:
 * `preparing` (arguments still streaming, so the card has no parsed args yet)
 * and `start` (dispatched, awaiting its result). Cards use this to pick their
 * in-progress copy; testing `phase === 'start'` alone would show a preparing
 * call the settled fallback instead.
 */
export function isToolRunning(block: ToolCallBlock): boolean {
  return !isSettledTool(block)
}

/** The wire name of one tool call block (settled and running forms). */
export function callNameOf(block: ToolCallBlock): string | null {
  return isSettledTool(block) ? (block.call?.name ?? null) : block.name
}

/** The validated presentation-meta object, or null when absent or malformed. */
export function metaOf(block: ToolCallBlock): Record<string, unknown> | null {
  if (!isSettledTool(block)) return null
  return isRecord(block.meta) ? block.meta : null
}

/** Lifecycle state derived from the frozen block, independent of meta. */
export function rowStateOf(block: ToolCallBlock): ZoteroRowState {
  if (!isSettledTool(block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/**
 * Flatten settled content blocks to display text. Settled semantics match the
 * harness `resultText`
 * (`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`)
 * exactly: text blocks verbatim, other block shapes as pretty JSON, empty
 * content on a failed call falling back to the structured error's
 * `name: code` line, otherwise the empty string. Running blocks return null
 * (the harness helper only accepts settled nodes); callers normalize with
 * `?? ''`.
 */
export function resultTextOf(block: ToolCallBlock): string | null {
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
export function errorSummaryOf(block: ToolCallBlock, rawText?: string | null): string | null {
  if (rowStateOf(block) !== 'error') return null
  const text = rawText !== undefined ? rawText : resultTextOf(block)
  return text ? text.split('\n')[0]?.trim() || null : null
}

/**
 * The harness's per-stage lazy argument view. Every block (preparing, start,
 * and result) carries one (`packages/client/ui-conversation/src/client/
 * contract/records.ts`: `ToolCallHead.args`, `ToolResultNode.args`), and a
 * preparing view grows in place, so readers see fields as they stream instead
 * of only after the call is dispatched.
 * @param block - the call block to read.
 * @returns the argument view; empty (never absent) when the call carries none.
 */
export function argsViewOf(block: ToolCallBlock): ToolArgs {
  return block.args
}

/** A string argument, including the streaming prefix while it is still open. */
export function textArg(view: ToolArgs, key: string): string | undefined {
  return view.text(key)
}

/** A non-string argument; undefined while that field is still open or absent. */
export function valueArg(view: ToolArgs, key: string): JsonValue | undefined {
  return view.value(key)
}

/** String entries of an array argument; empty when absent, incomplete, or not an array. */
export function listArg(view: ToolArgs, key: string): string[] {
  const value = valueArg(view, key)
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** A non-negative finite numeric argument, or `fallback` when absent or unusable. */
export function numberArg(view: ToolArgs, key: string, fallback = 0): number {
  const value = valueArg(view, key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** A boolean argument: true only for a completed JSON `true`. */
export function boolArg(view: ToolArgs, key: string): boolean {
  return valueArg(view, key) === true
}

/** A plain-object argument, or null when absent, incomplete, or not an object. */
export function recordArg(view: ToolArgs, key: string): Record<string, unknown> | null {
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
    const matchedFields = matchedFieldsOf(item['matchedFields'])
    rows.push({
      source,
      sourceRef,
      preview,
      previewTruncated,
      ...(pageLabel === undefined ? {} : { pageLabel }),
      ...(attachmentRef === undefined ? {} : { attachmentRef }),
      ...(matchedFields === undefined ? {} : { matchedFields }),
    })
  }
  return rows
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
