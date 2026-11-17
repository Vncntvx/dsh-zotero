import { assertWritePayload } from '../write-bounds.js'
/**
 * The `zotero_delete_library_tags` tool: delete tags library-wide. Names are
 * idempotent (unknown names are silently ignored); the delete carries the
 * library version of its preceding read, so a concurrent write fails it.
 * Irreversible. The plan card pages the whole tag listing first, so every
 * requested name is either proven with its item count or proven absent.
 * @module dsh-zotero/tools/delete-library-tags
 */

import type { Context } from '@deepseek-ai/cordis'
import { planValue } from '../write-plan.js'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { defineZoteroTool as defineTool } from '../define-tool.js'
import type { ResolvedConfig } from '../config.js'
import { invalidArgs, writeListEmptyMessage } from '../errors.js'
import { runPreview } from './degradable.js'
import { renderDeclined } from './present.js'
import {
  DECLINED_OUTPUT_SCHEMA,
  COMMITTED_UNVERIFIED_VARIANT,
  libraryVersionLine,
  presentDeleteResultView,
  renderCommittedUnverified,
  unverifiedPresentationMeta,
} from '../write-present.js'
import { assertWriteList } from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroDeleteLibraryTagsOutcome, ZoteroDeleteLibraryTagsRequest } from '../types.js'

const DELETE_LIBRARY_TAGS_PARAMETERS = {
  tags: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description:
      'Tag names to delete library-wide (1..writeListMaxItems). Names the listing proves absent are reported as no-ops; the delete is irreversible.',
  },
} as const

type DeleteLibraryTagsArgs = InferArgs<typeof DELETE_LIBRARY_TAGS_PARAMETERS>

const DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    COMMITTED_UNVERIFIED_VARIANT,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['deleted'], required: true },
        deletedTags: { type: 'array', items: { type: 'string' }, required: true },
        absentTags: { type: 'array', items: { type: 'string' } },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type DeleteLibraryTagsOutput = InferValue<typeof DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA>

/** The per-tag proven facts the plan card renders. */
interface TagPreview {
  /** Item counts; a seen-but-uncounted tag maps to `undefined`, unproven names are omitted. */
  counts?: ReadonlyMap<string, number | undefined>
  /** Requested names whose complete filtered listing proves absence. */
  absent?: readonly string[]
}

/**
 * The deterministic plan markdown the approval card renders. A tag is shown
 * with its item count when the listing proved one, as `unknown items` when
 * the listing carried the tag without a count, and, only after the whole
 * listing has been scanned, as a proven no-op under "Unmatched names".
 */
export function deleteLibraryTagsPlan(
  args: DeleteLibraryTagsArgs,
  preview: TagPreview = {},
): string {
  const tags = (args.tags ?? []).map((tag) => tag.trim())
  const lines = [
    '**Delete Zotero tags library-wide**',
    WRITE_PLAN_LIBRARY_LINE,
    '- Scope: every item carrying these tags (irreversible; every item carrying them loses them)',
  ]
  for (const tag of tags) {
    const count = preview.counts?.get(tag)
    const absent = preview.absent?.includes(tag) === true
    lines.push(
      `- "${planValue(tag)}": ${absent ? 'proven absent (no-op)' : count === undefined ? 'unknown items' : `${count} items`}`,
    )
  }
  if (preview.absent !== undefined && preview.absent.length > 0) {
    lines.push(
      `- Unmatched names (proven no-ops: the listing carries no such tag): ${preview.absent.map(planValue).join(', ')}`,
    )
  }
  lines.push(
    'This removes the tags from every item that carries them and cannot be undone; the delete carries a library-version precondition, so a concurrent change fails it.',
  )
  return lines.join('\n')
}

function buildRequest(
  args: DeleteLibraryTagsArgs,
  config: ResolvedConfig,
): ZoteroDeleteLibraryTagsRequest {
  if (args.tags.length === 0) invalidArgs(writeListEmptyMessage('tags'))
  const tags = assertWriteList('tags', args.tags, config.writeListMaxItems)
  return { tags }
}

/** The tag row shape the tags listing serves. */
interface TagRow {
  tag: string
  count?: number
}

/**
 * Query each exact name through Zotero's prefix listing, including child items.
 * Two pages bound each name's preview I/O. Exhausting that filtered listing
 * proves absence; hitting the page budget leaves the count unknown. Transport,
 * protocol and cancellation failures retain runPreview's explicit outcomes.
 */
export async function previewLibraryTags(
  service: ZoteroService,
  tags: readonly string[],
  signal: AbortSignal | undefined,
): Promise<TagPreview> {
  return await runPreview<TagPreview>(signal, {}, async () => {
    const wanted = new Set(tags)
    const counts = new Map<string, number | undefined>()
    const absent: string[] = []
    for (const tag of tags) {
      let offset = 0
      let pages = 0
      for (;;) {
        const browsed = await service.browse(
          {
            kind: 'tags',
            scope: { kind: 'library' },
            itemLevel: 'all',
            offset,
            limit: service.config.maxBrowseResults,
            q: tag,
            match: 'startsWith',
          },
          signal,
        )
        for (const item of browsed.items) {
          const row = item as TagRow
          if (typeof row.tag === 'string' && wanted.has(row.tag) && !counts.has(row.tag)) {
            counts.set(row.tag, typeof row.count === 'number' ? row.count : undefined)
          }
        }
        const next = browsed.nextOffset
        pages += 1
        if (next === undefined && !counts.has(tag)) absent.push(tag)
        if (next === undefined || counts.has(tag) || pages >= 2) break
        offset = next
      }
    }
    return {
      counts,
      ...(absent.length > 0 ? { absent } : {}),
    }
  })
}

export function renderDeleteLibraryTags(
  _args: DeleteLibraryTagsArgs,
  value: DeleteLibraryTagsOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined(value)
  }
  if (value.kind === 'committed-unverified')
    return renderCommittedUnverified(value, 'library tags', 'committed')
  return [
    {
      type: 'text',
      text: [
        `Deleted ${value.deletedTags.length} tags library-wide: ${value.deletedTags.join(', ')}.`,
        ...(value.absentTags === undefined || value.absentTags.length === 0
          ? []
          : [`Proven absent (no-op): ${value.absentTags.join(', ')}.`]),
        libraryVersionLine(value),
      ].join('\n'),
    },
  ]
}

function presentDeleteLibraryTagsResult(
  _args: DeleteLibraryTagsArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentDeleteResultView('tags delete', 'library tags', result)
}

export function registerDeleteLibraryTagsTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_delete_library_tags',
      description:
        'Delete tags library-wide in the Zotero personal library (irreversible: every item carrying them loses them). Unknown names are silently ignored. The plan card states each tag\u2019s item count first. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: DELETE_LIBRARY_TAGS_PARAMETERS,
      output: {
        schema: DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA,
        render: renderDeleteLibraryTags,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'deleted'
            ? { kind: 'deleted', deletedCount: value.deletedTags.length }
            : value.kind === 'committed-unverified'
              ? unverifiedPresentationMeta(value)
              : { ...value },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'delete',
        title: 'Delete Zotero library tags',
        rawInput: args.tags.join(', '),
      }),
      presentResult: presentDeleteLibraryTagsResult,
      async execute(args, exec): Promise<ZoteroDeleteLibraryTagsOutcome> {
        assertWritePayload(args, service.config.writeFieldMaxChars)
        const request = buildRequest(args, service.config)
        const preview = await previewLibraryTags(service, request.tags, exec.signal)
        const outcome = await service.deleteLibraryTags(request, {
          exec,
          plan: deleteLibraryTagsPlan(args, preview),
          risk: 'irreversible-delete',
        })
        return outcome
      },
    }),
  )
}
