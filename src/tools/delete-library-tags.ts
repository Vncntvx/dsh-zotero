/**
 * The `zotero_delete_library_tags` tool: delete tags library-wide. Names are
 * idempotent (unknown names are silently ignored); the delete carries the
 * library version of its preceding read, so a concurrent write fails it.
 * Irreversible — the plan card states every tag's item count first.
 * @module dsh-zotero/tools/delete-library-tags
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { writeListEmptyMessage, writeListTooLongMessage } from '../errors.js'
import { metaRecordOf, renderDeclined } from './present.js'
import { assertWriteList, invalid } from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroDeleteLibraryTagsOutcome, ZoteroDeleteLibraryTagsRequest } from '../types.js'
import type { ZoteroTagInfo } from '../types.js'

const DELETE_LIBRARY_TAGS_PARAMETERS = {
  tags: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description:
      'Tag names to delete library-wide (1..writeListMaxItems). Unknown names are ignored; the delete is irreversible.',
  },
} as const

type DeleteLibraryTagsArgs = InferArgs<typeof DELETE_LIBRARY_TAGS_PARAMETERS>

const DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['declined'], required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['deleted'], required: true },
        deletedTags: { type: 'array', items: { type: 'string' }, required: true },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type DeleteLibraryTagsOutput = InferValue<typeof DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders, with per-tag counts. */
export function deleteLibraryTagsPlan(
  args: DeleteLibraryTagsArgs,
  preview: { counts?: ReadonlyMap<string, number>; unknown?: readonly string[] } = {},
): string {
  const tags = (args.tags ?? []).map((tag) => tag.trim())
  const lines = [
    '**Delete Zotero tags library-wide**',
    '- Library: zotero://user/0 (the local personal library)',
    '- Scope: every item carrying these tags (irreversible, all libraries of names are removed)',
  ]
  for (const tag of tags) {
    const count = preview.counts?.get(tag)
    lines.push(`- "${tag}": ${count === undefined ? 'unknown items' : `${count} items`}`)
  }
  if (preview.unknown !== undefined && preview.unknown.length > 0) {
    lines.push(`- Unmatched names (treated as no-ops): ${preview.unknown.join(', ')}`)
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
  if (args.tags.length === 0) invalid(writeListEmptyMessage('tags'))
  if (args.tags.length > config.writeListMaxItems) {
    invalid(writeListTooLongMessage('tags', config.writeListMaxItems))
  }
  const tags = assertWriteList('tags', args.tags, config.writeListMaxItems)
  return { tags }
}

/**
 * Count the requested tags before the plan card via the library tags
 * listing. Best-effort — a listing that cannot be read leaves counts unknown
 * and the delete still carries its version precondition.
 */
async function previewLibraryTags(
  service: ZoteroService,
  tags: readonly string[],
): Promise<{ counts?: Map<string, number>; unknown?: string[] }> {
  try {
    const browsed = await service.browse(
      {
        kind: 'tags',
        scope: { kind: 'library' },
        offset: 0,
        limit: service.config.maxBrowseResults,
      },
      undefined,
    )
    const counts = new Map<string, number>()
    for (const item of browsed.items) {
      const row = item as ZoteroTagInfo
      if (typeof row.tag === 'string') counts.set(row.tag, row.count ?? 0)
    }
    const unknown = tags.filter((tag) => !counts.has(tag))
    return {
      counts,
      ...(unknown.length > 0 ? { unknown } : {}),
    }
  } catch {
    return {}
  }
}

export function renderDeleteLibraryTags(
  _args: DeleteLibraryTagsArgs,
  value: DeleteLibraryTagsOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  return [
    {
      type: 'text',
      text: [
        `Deleted ${value.deletedTags.length} tags library-wide: ${value.deletedTags.join(', ')}.`,
        `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
      ].join('\n'),
    },
  ]
}

function presentDeleteLibraryTagsResult(
  _args: DeleteLibraryTagsArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero tags delete: declined, nothing written' }
  }
  return { card: 'generic', title: 'Zotero library tags deleted' }
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
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Delete Zotero library tags',
        rawInput: args.tags.join(', '),
      }),
      presentResult: presentDeleteLibraryTagsResult,
      async execute(args, exec): Promise<ZoteroDeleteLibraryTagsOutcome> {
        const request = buildRequest(args, service.config)
        const preview = await previewLibraryTags(service, request.tags)
        return await service.deleteLibraryTags(request, {
          exec,
          plan: deleteLibraryTagsPlan(args, preview),
        })
      },
    }),
  )
}
