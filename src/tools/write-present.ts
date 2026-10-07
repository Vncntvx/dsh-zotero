/**
 * Shared presentation for the write tools: the committed-unverified output
 * variant, its render and card titles, the create tools' result meta, and
 * the library-version line every write receipt ends with. One wording per
 * sentence — the tools must not drift on the retry-safety contract they
 * display.
 * @module dsh-zotero/tools/write-present
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { metaRecordOf, renderDeclined } from './present.js'

/**
 * The output-schema variant for the non-retryable committed-unverified
 * outcome every non-idempotent create (note, item, collection) can report.
 * One copy: the retry-safety contract the schema expresses must not drift
 * between tools.
 */
export const COMMITTED_UNVERIFIED_VARIANT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['committed-unverified'], required: true },
    committed: { type: 'boolean', enum: [true], required: true },
    retryable: { type: 'boolean', enum: [false], required: true },
    reason: {
      type: 'string',
      enum: ['saved-state-unverified', 'commit-unknown'],
      required: true,
    },
    ref: { type: 'string' },
    key: { type: 'string' },
    version: { type: 'integer' },
    libraryVersion: { type: 'integer' },
    serverId: { type: 'string', required: true },
  },
} as const

/** The fields the shared committed-unverified render and meta read. */
export interface CommittedUnverifiedLike {
  readonly kind: 'committed-unverified'
  readonly reason: 'saved-state-unverified' | 'commit-unknown'
  readonly ref?: string
  readonly key?: string
  readonly version?: number
}

/**
 * Render the committed-unverified receipt: what Zotero may have done (the
 * past verb differs per create), the identity hint when the response carried
 * one, and the reconciliation instruction — never a retry.
 */
export function renderCommittedUnverified(
  value: CommittedUnverifiedLike,
  objectName: string,
  pastVerb: 'committed' | 'created',
): ContentBlock[] {
  const identity =
    value.key !== undefined
      ? ` (key ${value.key})`
      : value.ref !== undefined
        ? ` (ref ${value.ref})`
        : ''
  const reconciliation =
    value.key !== undefined || value.ref !== undefined
      ? `reconcile the ${objectName} by its key/ref`
      : `reconcile by checking Zotero for the ${objectName} before taking any further action`
  const text =
    value.reason === 'commit-unknown'
      ? `Zotero may have ${pastVerb} the ${objectName}${identity}, but the response did not prove the outcome. Do not retry; ${reconciliation}.`
      : `Zotero ${pastVerb} the ${objectName}${identity}, but its saved state could not be verified. Do not retry; ${reconciliation}.`
  return [{ type: 'text', text }]
}

/**
 * The result-card titles for one create tool: declined, the two
 * committed-unverified reasons, and the applied receipt with its ref.
 */
export function presentCreateResultView(
  noun: string,
  pastVerb: 'committed' | 'created',
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: declinedTitle(noun) }
  }
  if (record.kind === 'committed-unverified') {
    return {
      card: 'generic',
      title:
        record.reason === 'commit-unknown'
          ? `Zotero ${noun} outcome unknown; do not retry`
          : `Zotero ${noun} ${pastVerb} but not verified; do not retry`,
    }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero ${noun} created${ref === '' ? '' : `: ${ref}`}` }
}

/** The presentation meta the create tools project for the Sources panel. */
export function createWritePresentationMeta(
  value:
    | { kind: 'applied'; ref: string; key: string; version: number }
    | CommittedUnverifiedLike
    | { kind: 'declined' },
): JsonValue {
  if (value.kind === 'applied') {
    return { kind: 'applied', ref: value.ref, key: value.key, version: value.version }
  }
  if (value.kind === 'committed-unverified') {
    return {
      kind: 'committed-unverified',
      reason: value.reason,
      ...(value.key === undefined ? {} : { key: value.key }),
    }
  }
  return { kind: 'declined' }
}

/**
 * The presentation meta the two list-update tools (tags, membership)
 * project: the change counts ride the applied arm so the Sources panel can
 * summarize the diff without re-reading the lists.
 */
export function listUpdatePresentationMeta(
  value:
    | {
        kind: 'applied'
        ref: string
        version: number
        added: readonly unknown[]
        removed: readonly unknown[]
      }
    | { kind: 'declined' },
): JsonValue {
  return value.kind === 'applied'
    ? {
        kind: 'applied',
        ref: value.ref,
        version: value.version,
        addedCount: value.added.length,
        removedCount: value.removed.length,
      }
    : { kind: 'declined' }
}

/** The closing line of every write receipt: the library version and its serving instance. */
export function libraryVersionLine(value: { libraryVersion: number; serverId?: string }): string {
  return `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`
}

export const DECLINED_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['declined'], required: true },
  },
} as const

const COMMON_UPDATE_LIST_PROPERTIES = {
  kind: { type: 'string', enum: ['applied'], required: true },
  ref: { type: 'string', required: true },
  version: {
    type: 'integer',
    required: true,
    description: "The item's version after the update (or the read version when unchanged).",
  },
  added: { type: 'array', items: { type: 'string' }, required: true },
  removed: { type: 'array', items: { type: 'string' }, required: true },
  unchanged: { type: 'boolean', required: true },
  libraryVersion: {
    type: 'integer',
    description: 'The library version the write advanced to; absent when unchanged.',
  },
  serverId: { type: 'string' },
} as const

export const UPDATE_ITEM_TAGS_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...COMMON_UPDATE_LIST_PROPERTIES,
        tags: { type: 'array', items: { type: 'string' }, required: true },
      },
    },
  ],
} as const

export const UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...COMMON_UPDATE_LIST_PROPERTIES,
        collections: { type: 'array', items: { type: 'string' }, required: true },
      },
    },
  ],
} as const

export interface UpdateListRenderOptions {
  readonly noun: string
  readonly unchangedTarget: string
  readonly currentLabel: string
}

/** Render the receipt blocks for a tags or collections update tool. */
export function renderUpdateList(
  value:
    | { kind: 'declined' }
    | {
        kind: 'applied'
        ref: string
        version: number
        added: readonly string[]
        removed: readonly string[]
        unchanged: boolean
        items: readonly string[]
        libraryVersion?: number
        serverId?: string
      },
  options: UpdateListRenderOptions,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [
    value.unchanged
      ? `No change: ${value.ref} already carries ${options.unchangedTarget} (version ${value.version}).`
      : `Updated ${options.noun} on ${value.ref} (version ${value.version}); added ${value.added.length === 0 ? '(none)' : value.added.join(', ')}; removed ${value.removed.length === 0 ? '(none)' : value.removed.join(', ')}.`,
  ]
  lines.push(
    `${options.currentLabel}: ${value.items.length === 0 ? '(none)' : value.items.join(', ')}`,
  )
  if (value.libraryVersion !== undefined) {
    lines.push(
      libraryVersionLine({ libraryVersion: value.libraryVersion, serverId: value.serverId }),
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** The declined-arm title every write result card shares. */
function declinedTitle(noun: string): string {
  return `Zotero ${noun}: declined, nothing written`
}

/** The result-card titles for item updates (tags, membership, or item fields). */
export function presentUpdateResultView(
  noun: string,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: declinedTitle(noun) }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero ${noun} updated${ref === '' ? '' : `: ${ref}`}` }
}

/**
 * The result-card titles for the delete tools: the shared declined arm, and
 * the deleted receipt with its ref when the outcome carried one (a library
 * tags delete has no single ref, so its receipt is the plain sentence).
 *
 * The two nouns are the two spellings the cards already use — the declined
 * arm names the operation ("collection delete") and the receipt names the
 * object ("collection"). Passing them separately keeps those pinned titles
 * byte-identical instead of normalizing the wording in a "refactor".
 */
export function presentDeleteResultView(
  declinedNoun: string,
  deletedNoun: string,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: declinedTitle(declinedNoun) }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero ${deletedNoun} deleted${ref === '' ? '' : `: ${ref}`}` }
}
