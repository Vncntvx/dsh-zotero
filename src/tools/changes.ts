/**
 * The `zotero_changes` tool: incremental awareness of the local library. On
 * the verified build (Zotero 10.0.2-beta.9) versions are local transactions —
 * every object save advances the library counter and stamps the object — so a
 * `since` diff answers "what changed in my library" request-driven, without the
 * cloud and without background polling. The domain decides that per call from
 * the responses (a build that reports no library version is `versionUnavailable`)
 * rather than from a version number, which no response header carries. A call
 * without `since` takes a baseline reading and mints the cursor (version plus
 * the instance and library it belongs to) that later calls pass back.
 * @module dsh-zotero/tools/changes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { asRecord } from '../json.js'
import {
  ALL_CHANGES_INCLUDES,
  DEFAULT_CHANGES_INCLUDES as DEFAULT_INCLUDES,
} from '../local/changes-domain.js'
import { boundedPresentationMeta } from '../presentation-meta.js'
import { metaRecordOf } from './present.js'
import {
  assertIntInRange,
  assertNonEmptyList,
  invalid,
  parseLibrary,
  requireLibrary,
} from './validate.js'
import type {
  ZoteroChangesCursor,
  ZoteroChangesInclude,
  ZoteroChangesRequest,
  ZoteroChangesUnobservableReason,
  SupportedLocalLibrary,
} from '../types.js'
import type { ZoteroService } from '../service.js'

const ALL_INCLUDES = ALL_CHANGES_INCLUDES

/** Host kinds the tool's include enum does not offer; a non-empty union fails the build. */
type MissingInclude = Exclude<ZoteroChangesInclude, (typeof ALL_INCLUDES)[number]>
const _includesComplete: MissingInclude extends never ? true : never = true

/** The kinds a call covers when the model names none. `fulltext` is excluded:
 * its endpoint answers in the full-text index's own version counter, not the
 * library version this tool diffs on, so it cannot be part of the cursor story
 * and is only read when asked for by name. Single-sourced from the domain
 * (`DEFAULT_CHANGES_INCLUDES`) so the contract and the read agree by
 * construction; the enum-completeness pins below guard the rest. */

/** The library shape both the `library` parameter and a cursor's library use. */
const LIBRARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['user', 'group'], required: true },
    id: { type: 'integer', required: true },
  },
} as const

/** The checkpoint the tool hands back, provenance and coverage included. */
const CURSOR_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serverId: { type: 'string', required: true },
    library: { ...LIBRARY_SCHEMA, required: true },
    version: { type: 'integer', required: true },
    include: {
      type: 'array',
      items: { type: 'string', enum: [...ALL_INCLUDES] },
      required: true,
    },
  },
} as const

/** The checkpoint passed into since: include is optional and defaults to call kinds. */
const CURSOR_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serverId: { type: 'string', required: true },
    library: { ...LIBRARY_SCHEMA, required: true },
    version: { type: 'integer', required: true },
    include: {
      type: 'array',
      items: { type: 'string', enum: [...ALL_INCLUDES] },
    },
  },
} as const

const CHANGES_PARAMETERS = {
  library: {
    ...LIBRARY_SCHEMA,
    description: 'Library to diff; omitted defaults to personal user/0.',
  },
  since: {
    ...CURSOR_INPUT_SCHEMA,
    description:
      'The cursor to diff from, passed back verbatim from an earlier zotero_changes result. It carries the instance, the library, the version, and the resource kinds it covers: a bare version number is not accepted, because the same number means an unrelated counter in another database or library. A cursor from another instance is rejected, one for another library is an argument error, and its include set must match this call. Never advance from a result without a cursor: that read did not verify the whole range. Omit to take a baseline reading (current version, no diffs).',
  },
  include: {
    type: 'array',
    items: { type: 'string', enum: [...ALL_INCLUDES] },
    // The schema default must be mutable JSON; the domain's readonly source
    // stays the single authority (buildRequest falls back to it directly).
    default: [...DEFAULT_INCLUDES] as ZoteroChangesInclude[],
    description:
      'Resource kinds to diff; defaults to everything but fulltext. items covers the whole item space as Zotero partitions it — top-level items, child objects (notes, attachments, annotations) and items in the trash — and reports each as its own list, because a child object carries its own version: editing one advances the library without touching any top-level item. deleted lists tombstoned items, collections, saved searches and tag names. fulltext is a separate listing: its endpoint answers in the full-text index\u2019s own version counter, so its rows are not a delta on the library version and it is left out unless named explicitly.',
  },
} as const

type ChangesArgs = InferArgs<typeof CHANGES_PARAMETERS>

const CHANGED_OBJECT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', required: true },
    version: { type: 'integer', required: true },
  },
} as const

/**
 * The ways a kind this call included can contribute nothing, each with the
 * line the model reads. The reasons are kept apart because the remedy differs:
 * a missing endpoint is permanent, a range older than the build's history is
 * fixed by re-baselining, and an unreadable answer is fixed by running the
 * call again. The schema's enum is derived from these keys, so a new reason
 * cannot reach the wire unrendered.
 */
export const UNOBSERVABLE_NOT_SERVED_MESSAGE =
  'Not served by this Zotero build (not observable here, removals included)'
export const UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE =
  'Older than the change history this build keeps (take a fresh baseline to track it from here)'
export const UNOBSERVABLE_UNREADABLE_MESSAGE =
  'The answer did not carry the documented shape, so this call could not read it (re-run)'

const UNOBSERVABLE_HEADLINES = [
  ['not-served', UNOBSERVABLE_NOT_SERVED_MESSAGE],
  ['range-not-covered', UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE],
  ['unreadable', UNOBSERVABLE_UNREADABLE_MESSAGE],
] as const satisfies readonly (readonly [ZoteroChangesUnobservableReason, string])[]

/** DTO reasons this tool never renders; a non-empty union fails the build. */
type UnrenderedReason = Exclude<
  ZoteroChangesUnobservableReason,
  (typeof UNOBSERVABLE_HEADLINES)[number][0]
>
const _reasonsRendered: UnrenderedReason extends never ? true : never = true

/** The reasons the wire schema admits, in render order. */
const UNOBSERVABLE_REASONS: readonly ZoteroChangesUnobservableReason[] = UNOBSERVABLE_HEADLINES.map(
  ([reason]) => reason,
)

const UNOBSERVABLE_ENTRY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...ALL_INCLUDES], required: true },
    reason: { type: 'string', enum: [...UNOBSERVABLE_REASONS], required: true },
  },
} as const

const CHANGES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    library: LIBRARY_SCHEMA,
    serverId: { type: 'string' },
    fromVersion: { type: 'integer' },
    cursor: CURSOR_OUTPUT_SCHEMA,
    libraryChanged: { type: 'boolean' },
    versionUnavailable: { type: 'boolean' },
    changed: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        items: { type: 'array', items: CHANGED_OBJECT },
        childItems: { type: 'array', items: CHANGED_OBJECT },
        trashedItems: { type: 'array', items: CHANGED_OBJECT },
        collections: { type: 'array', items: CHANGED_OBJECT },
        savedSearches: { type: 'array', items: CHANGED_OBJECT },
        fulltextAttachments: { type: 'array', items: CHANGED_OBJECT },
      },
    },
    deleted: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', required: true, items: { type: 'string' } },
        collections: { type: 'array', required: true, items: { type: 'string' } },
        savedSearches: { type: 'array', required: true, items: { type: 'string' } },
        tags: { type: 'array', required: true, items: { type: 'string' } },
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'integer' },
        childItems: { type: 'integer' },
        trashedItems: { type: 'integer' },
        collections: { type: 'integer' },
        savedSearches: { type: 'integer' },
        fulltextAttachments: { type: 'integer' },
        deletedItems: { type: 'integer' },
        deletedCollections: { type: 'integer' },
        deletedSavedSearches: { type: 'integer' },
        deletedTags: { type: 'integer' },
        deletedOther: { type: 'integer' },
      },
    },
    unobservable: { type: 'array', items: UNOBSERVABLE_ENTRY },
    truncated: { type: 'boolean' },
  },
} as const

type ChangesOutput = InferValue<typeof CHANGES_OUTPUT_SCHEMA>

/** The model-facing message for an explicit empty include list. */
export const CHANGES_INCLUDE_EMPTY_MESSAGE =
  'include must list at least one resource kind when provided'

/** The note that full-text rows are a listing, not a delta on the library version. */
export const FULLTEXT_COUNTER_NOTE =
  'index versions are a counter of their own, so these rows are a listing, not this version\u2019s change set'

/**
 * Turn the schema-validated cursor argument into the domain value. The schema
 * owns the shape; what it cannot express is checked here — a blank instance
 * id, a version outside a counter's range, or a library this plugin does not
 * serve would otherwise pass through as an unpinned cursor.
 */
function parseCursor(
  value: ChangesArgs['since'],
  callInclude?: readonly ZoteroChangesInclude[],
): ZoteroChangesCursor | undefined {
  if (value === undefined) return undefined
  const serverId = value.serverId.trim()
  if (serverId === '') {
    invalid('since.serverId must be the instance id the cursor came from')
  }
  assertIntInRange('since.version', value.version, 0, Number.MAX_SAFE_INTEGER)
  const include = value.include ?? callInclude ?? DEFAULT_INCLUDES
  if (!Array.isArray(include) || include.length === 0 || new Set(include).size !== include.length) {
    invalid('since.include must list the resource kinds covered by the cursor')
  }
  return {
    serverId,
    library: requireLibrary(value.library),
    version: value.version,
    include: [...include],
  }
}

function buildRequest(args: ChangesArgs): ZoteroChangesRequest {
  const library = parseLibrary(args.library)
  if (args.include !== undefined) {
    assertNonEmptyList(args.include as readonly unknown[], CHANGES_INCLUDE_EMPTY_MESSAGE)
  }
  const since = parseCursor(args.since, args.include)
  const include = new Set<ZoteroChangesInclude>(args.include ?? since?.include ?? DEFAULT_INCLUDES)
  return {
    ...(library !== undefined ? { library: library as SupportedLocalLibrary } : {}),
    ...(since !== undefined ? { since } : {}),
    include,
  }
}

/**
 * The baseline and diff messages the model reads: the three baseline outcomes
 * (a cursor, a version without an instance, and no version at all) and the
 * three ways a diff withholds its cursor.
 */
export function baselineCursorMessage(version: number, serverId: string): string {
  return `Baseline reading: library is at version ${version} on instance ${serverId}. ${BASELINE_CURSOR_REUSE}`
}

/** The instruction a cursor baseline closes with. */
export const BASELINE_CURSOR_REUSE =
  'Pass that cursor back as since on a later call to see what changed.'

export const BASELINE_NO_VERSION_MESSAGE =
  'Baseline reading: this Zotero build reports no library version, so there is no cursor to diff from — incremental changes cannot be read here.'
export const BASELINE_NO_INSTANCE_MESSAGE =
  'Baseline reading: the library is at a version, but the answering build named no instance to pin a cursor to, so there is nothing to pass back.'

export const CHANGES_NOT_ADVANCED_LIBRARY_MOVED =
  'version not advanced: the library changed while this call was reading — re-run for a settled cursor.'
export const CHANGES_NOT_ADVANCED_NO_VERSION =
  'version not advanced: this Zotero build reported no library version for this read, so the diff cannot be pinned to one.'
export const CHANGES_NOT_ADVANCED_UNVERIFIED =
  'version not advanced: the read did not verify the whole range — do not reuse a version from this call.'
export const CHANGES_NOT_ADVANCED_FULLTEXT =
  'version not advanced: fulltext uses an independent index counter, so this mixed listing has no library cursor; run a library-only diff when you need a resumable cursor.'

/** The positive statement an observed, empty tombstone read renders. */
export const CHANGES_NO_DELETIONS_MESSAGE = 'Deletions: none in this range.'

/** The note that tombstoned kinds outside this tool's reports were counted too. */
export function otherDeletedMessage(count: number): string {
  return `Other deleted objects: ${count} (kinds this tool does not report).`
}

export function renderChanges(args: ChangesArgs, value: ChangesOutput): ContentBlock[] {
  const lines = []
  const cursor = value.cursor
  if (value.fromVersion === undefined) {
    if (cursor !== undefined) {
      lines.push(baselineCursorMessage(cursor.version, cursor.serverId))
    } else if (value.versionUnavailable === true) {
      lines.push(BASELINE_NO_VERSION_MESSAGE)
    } else {
      lines.push(BASELINE_NO_INSTANCE_MESSAGE)
    }
  } else if (cursor !== undefined) {
    lines.push(`Changes ${value.fromVersion} → ${cursor.version}`)
  } else if (value.libraryChanged === true) {
    lines.push(`Changes ${value.fromVersion} → ${CHANGES_NOT_ADVANCED_LIBRARY_MOVED}`)
  } else if (value.versionUnavailable === true) {
    lines.push(`Changes ${value.fromVersion} → ${CHANGES_NOT_ADVANCED_NO_VERSION}`)
  } else if (args.include?.includes('fulltext') === true) {
    lines.push(`Changes ${value.fromVersion} → ${CHANGES_NOT_ADVANCED_FULLTEXT}`)
  } else {
    lines.push(`Changes ${value.fromVersion} → ${CHANGES_NOT_ADVANCED_UNVERIFIED}`)
  }
  const totals = value.totals
  const sections: [
    string,
    readonly { key: string; version: number }[] | undefined,
    number | undefined,
    string | undefined,
  ][] = [
    ['Items (top-level)', value.changed.items, totals?.items, undefined],
    [
      'Child objects (notes, attachments, annotations)',
      value.changed.childItems,
      totals?.childItems,
      undefined,
    ],
    ['Items in the trash', value.changed.trashedItems, totals?.trashedItems, undefined],
    ['Collections', value.changed.collections, totals?.collections, undefined],
    ['Saved searches', value.changed.savedSearches, totals?.savedSearches, undefined],
    [
      'Full-text reindexed',
      value.changed.fulltextAttachments,
      totals?.fulltextAttachments,
      FULLTEXT_COUNTER_NOTE,
    ],
  ]
  for (const [label, entries, total, note] of sections) {
    if (entries === undefined) continue
    const count = total ?? entries.length
    lines.push(
      `${label}: ${count} changed${count > entries.length ? ` — ${entries.length} newest listed, raise maxChangesResults for the rest` : ''}${note === undefined ? '' : ` — ${note}`}`,
    )
    // Everything the read returned is printed. The listing is already bounded
    // by `maxChangesResults`, and cutting it a second time here left keys the
    // model could count but never read, with no way to ask for them.
    for (const entry of entries) {
      lines.push(`  - ${entry.key} (v${entry.version})`)
    }
  }
  if (value.deleted !== undefined) {
    const deletedSections: [string, readonly string[] | undefined, number | undefined][] = [
      ['Deleted items', value.deleted.items, totals?.deletedItems],
      ['Deleted collections', value.deleted.collections, totals?.deletedCollections],
      ['Deleted saved searches', value.deleted.savedSearches, totals?.deletedSavedSearches],
      ['Deleted tags', value.deleted.tags, totals?.deletedTags],
    ]
    // The tombstone read answered, so "nothing was removed" is a finding, not
    // a gap: it is stated rather than left to the absence of a listing.
    const removed = deletedSections.reduce(
      (sum, [, keys, total]) => sum + (total ?? keys?.length ?? 0),
      0,
    )
    if (removed === 0) {
      lines.push(CHANGES_NO_DELETIONS_MESSAGE)
    }
    for (const [label, keys, total] of deletedSections) {
      if (keys === undefined || keys.length === 0) continue
      const count = total ?? keys.length
      lines.push(
        `${label}: ${count}${count > keys.length ? ` — ${keys.length} listed, raise maxChangesResults for the rest` : ''}`,
      )
      for (const key of keys) lines.push(`  - ${key}`)
    }
    const other = totals?.deletedOther ?? 0
    if (other > 0) {
      lines.push(otherDeletedMessage(other))
    }
  }
  for (const [reason, headline] of UNOBSERVABLE_HEADLINES) {
    const kinds = (value.unobservable ?? [])
      .filter((entry) => entry.reason === reason)
      .map((entry) => entry.kind)
    if (kinds.length > 0) lines.push(`${headline} ${kinds.join(', ')}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The completed changes card: changed/deleted counts, or the baseline
 * version when the call took a baseline reading. `meta` is absent on nested
 * code dispatch or malformed replay records, and a failed call keeps the raw
 * error content — both fall back to the generic card.
 */
function presentChangesResult(_args: ChangesArgs, result: ToolResult): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  const changed = asRecord(record.changed)
  const deleted = asRecord(record.deleted)
  if (changed === undefined && deleted === undefined) {
    // Baseline reading, or an over-budget diff whose detail rows the byte
    // budget dropped (detailOmitted): never invent counts.
    const cursor = asRecord(record.cursor)
    const version = cursor?.version
    if (typeof version !== 'number') return undefined
    const fromVersion = record.fromVersion
    if (typeof fromVersion !== 'number') {
      return { card: 'generic', title: `Zotero changes: baseline at version ${version}` }
    }
    return { card: 'generic', title: `Zotero changes: ${fromVersion} → ${version}` }
  }
  // The listings are capped digests; `totals` carries the true counts, so the
  // card reports what changed, not what fit. Only a record without totals (a
  // replay, or malformed meta) falls back to counting the rows it has.
  const totals = asRecord(record.totals)
  const counted = totals === undefined ? undefined : sumNumbers(totals)
  return {
    card: 'generic',
    title: `Zotero changes: ${counted ?? countArrayEntries(changed) + countArrayEntries(deleted)} changed or deleted`,
  }
}

/** The sum of one record's numeric values (absent fields count zero). */
function sumNumbers(record: Record<string, unknown>): number {
  let sum = 0
  for (const value of Object.values(record)) {
    if (typeof value === 'number') sum += value
  }
  return sum
}

/** The total entries across one changed/deleted section's arrays (a missing section counts zero). */
function countArrayEntries(section: Record<string, unknown> | undefined): number {
  let count = 0
  for (const entries of Object.values(section ?? {})) {
    if (Array.isArray(entries)) count += entries.length
  }
  return count
}

export function registerChangesTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_changes',
      description: [
        'See what changed in the Zotero library since a version: new/edited items (top-level items, the notes/attachments/annotations under them, and trashed items, each listed apart), collections, saved searches, reindexed full text, and deletions.',
        'Call without since first to take a baseline reading, then pass the cursor it returns back as since — fully local, no cloud.',
        'Listings are capped digests; totals reports the true counts behind them. A returned cursor always accounts for every change in the range it reports, so it is safe to pass back as since; a result without one is not. The cursor is pinned to the instance and library it came from, and a cursor from another database is refused instead of diffed against this one.',
        'unobservable names every kind this call could not cover, with the reason: a build that does not serve it, a range older than the history the build keeps, or an answer it could not read. Never read an absent listing as "nothing changed" before checking unobservable; deleted is present exactly when removals were actually observed. versionUnavailable means the build reports no library version at all, so no diff can be taken from it.',
      ].join(' '),
      parameters: CHANGES_PARAMETERS,
      output: {
        schema: CHANGES_OUTPUT_SCHEMA,
        render: renderChanges,
        presentationMeta: (_args, value) => boundedPresentationMeta(value, ['changed', 'deleted']),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero changes',
        rawInput: args.since === undefined ? 'baseline' : String(args.since.version),
      }),
      presentResult: presentChangesResult,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await withConnectivityAsk(ctx, service.recovery, exec, () =>
          service.changes(buildRequest(args), exec.signal),
        )
      },
    }),
  )
}
