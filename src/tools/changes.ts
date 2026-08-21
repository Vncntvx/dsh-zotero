/**
 * The `zotero_changes` tool: incremental awareness of the local library.
 * Zotero 10+ versions are local transaction versions — any edit, sync, or
 * local write advances them — so a `since` diff answers "what changed in my
 * library" request-driven, without the cloud and without background
 * polling. A call without `since` takes a baseline reading (current version
 * only); the model passes that version back as `since` later.
 * @module dsh-zotero/tools/changes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { boundedPresentationMeta } from '../presentation-meta.js'
import { assertIntInRange } from './validate.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroChangesInclude, ZoteroChangesRequest, SupportedLocalLibrary } from '../types.js'
import { parseLibrary } from './browse.js'

const ALL_INCLUDES: ZoteroChangesInclude[] = [
  'items',
  'collections',
  'savedSearches',
  'fulltext',
  'deleted',
]

const CHANGES_PARAMETERS = {
  library: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['user', 'group'], required: true },
      id: { type: 'integer', required: true },
    },
    description: 'Library to diff; omitted defaults to personal user/0.',
  },
  since: {
    type: 'integer',
    description:
      'The library version to diff from — reuse toVersion from an earlier zotero_changes result. Omit to take a baseline reading (current version, no diffs).',
  },
  include: {
    type: 'array',
    items: { type: 'string', enum: [...ALL_INCLUDES] },
    default: ALL_INCLUDES,
    description:
      'Resource kinds to diff; defaults to all. fulltext lists attachments whose index changed; deleted lists tombstoned keys.',
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

const CHANGES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    library: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', required: true },
        id: { type: 'integer', required: true },
      },
    },
    serverId: { type: 'string' },
    fromVersion: { type: 'integer' },
    toVersion: { type: 'integer' },
    changed: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        items: { type: 'array', items: CHANGED_OBJECT },
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
      },
    },
    truncated: { type: 'boolean' },
  },
} as const

type ChangesOutput = InferValue<typeof CHANGES_OUTPUT_SCHEMA>

function buildRequest(args: ChangesArgs): ZoteroChangesRequest {
  const library = parseLibrary((args as Record<string, unknown>).library)
  const since = args.since
  if (since !== undefined) assertIntInRange('since', since, 0, Number.MAX_SAFE_INTEGER)
  const include = new Set<ZoteroChangesInclude>(
    (args.include as ZoteroChangesInclude[] | undefined) ?? ALL_INCLUDES,
  )
  return {
    ...(library !== undefined ? { library: library as SupportedLocalLibrary } : {}),
    ...(since !== undefined ? { since } : {}),
    include,
  }
}

export function renderChanges(_args: ChangesArgs, value: ChangesOutput): ContentBlock[] {
  const lines = []
  if (value.fromVersion === undefined) {
    lines.push(
      `Baseline reading${value.toVersion === undefined ? '' : `: library is at version ${value.toVersion}`}. Pass it as since on a later call to see what changed.`,
    )
  } else {
    lines.push(`Changes ${value.fromVersion} → ${value.toVersion ?? '?'}`)
  }
  const sections: [string, readonly { key: string; version: number }[] | undefined][] = [
    ['Items', value.changed.items],
    ['Collections', value.changed.collections],
    ['Saved searches', value.changed.savedSearches],
    ['Full-text reindexed', value.changed.fulltextAttachments],
  ]
  for (const [label, entries] of sections) {
    if (entries === undefined) continue
    lines.push(`${label}: ${entries.length}${value.truncated === true ? '+' : ''}`)
    for (const entry of entries.slice(0, 20)) {
      lines.push(`  - ${entry.key} (v${entry.version})`)
    }
    if (entries.length > 20) lines.push(`  … ${entries.length - 20} more`)
  }
  if (value.deleted !== undefined) {
    const deletedSections: [string, readonly string[] | undefined][] = [
      ['Deleted items', value.deleted.items],
      ['Deleted collections', value.deleted.collections],
      ['Deleted saved searches', value.deleted.savedSearches],
    ]
    for (const [label, keys] of deletedSections) {
      if (keys === undefined || keys.length === 0) continue
      lines.push(`${label}: ${keys.length}`)
      for (const key of keys.slice(0, 20)) lines.push(`  - ${key}`)
      if (keys.length > 20) lines.push(`  … ${keys.length - 20} more`)
    }
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerChangesTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_changes',
      description: [
        'See what changed in the Zotero library since a version: new/edited items, collections, saved searches, reindexed full text, and deletions.',
        'Call without since first to take a baseline reading of the current library version, then pass that version back as since later — fully local, no cloud.',
      ].join(' '),
      parameters: CHANGES_PARAMETERS,
      output: {
        schema: CHANGES_OUTPUT_SCHEMA,
        render: renderChanges,
        presentationMeta: (_args, value) => boundedPresentationMeta(value, []),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero changes',
        rawInput: args.since === undefined ? 'baseline' : String(args.since),
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return (await withConnectivityAsk(ctx, exec, () =>
          service.changes(buildRequest(args), exec.signal),
        )) as unknown as ChangesOutput
      },
    }),
  )
}
