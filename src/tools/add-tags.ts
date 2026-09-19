/**
 * The `zotero_add_tags` tool: add tags to one Zotero item. The domain runs
 * read-merge-write under a version precondition, preserving the tags and tag
 * types the item already carries; an all-already-present call writes nothing
 * and reports unchanged. The plan-review approval runs before Zotero is
 * contacted.
 * @module dsh-zotero/tools/add-tags
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
import { ZOTERO_WRITE_LIST_MAX_ITEMS } from '../constants.js'
import { writeListEmptyMessage, writeListTooLongMessage } from '../errors.js'
import { metaRecordOf } from './present.js'
import { invalid, parseSupportedRef, REF_ARG_HINT } from './validate.js'
import { askPlanApproval } from './write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroTagUpdateRequest } from '../types.js'

const ADD_TAGS_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${REF_ARG_HINT} ref to tag.`,
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description:
      "Tags to add. They merge with the item's existing tags — what is already there stays, including its colored/automatic types; duplicates collapse.",
  },
} as const

type AddTagsArgs = InferArgs<typeof ADD_TAGS_PARAMETERS>

const ADD_TAGS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['applied', 'declined'], required: true },
    ref: { type: 'string' },
    version: { type: 'integer', description: "The item's version after the update." },
    tags: { type: 'array', items: { type: 'string' } },
    added: { type: 'array', items: { type: 'string' } },
    unchanged: { type: 'boolean' },
    libraryVersion: { type: 'integer' },
    serverId: { type: 'string' },
  },
} as const

type AddTagsOutput = InferValue<typeof ADD_TAGS_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function addTagsPlan(args: AddTagsArgs): string {
  return [
    '**Add tags to a Zotero item**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Item: ${args.ref}`,
    `- Tags to add: ${args.tags.join(', ')}`,
    'Existing tags on the item are preserved; the union is written under a version precondition.',
  ].join('\n')
}

function buildRequest(args: AddTagsArgs): ZoteroTagUpdateRequest {
  if (args.tags.length === 0) invalid(writeListEmptyMessage('tags'))
  if (args.tags.length > ZOTERO_WRITE_LIST_MAX_ITEMS) {
    invalid(writeListTooLongMessage('tags', ZOTERO_WRITE_LIST_MAX_ITEMS))
  }
  return { item: parseSupportedRef(args.ref, ['item']), tags: args.tags }
}

export function renderAddTags(_args: AddTagsArgs, value: AddTagsOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return [
      {
        type: 'text',
        text: 'Declined: the user answered the plan without approving. Nothing was written.',
      },
    ]
  }
  const unchanged = value.unchanged === true
  const lines = [
    unchanged
      ? `No change: ${value.ref ?? ''} already carries every requested tag (version ${value.version ?? 0}).`
      : `Tagged ${value.ref ?? ''} (version ${value.version ?? 0}); added ${(value.added ?? []).join(', ')}.`,
  ]
  lines.push(`Tags now: ${(value.tags ?? []).join(', ')}`)
  if (value.libraryVersion !== undefined) {
    lines.push(
      `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentAddTagsResult(_args: AddTagsArgs, result: ToolResult): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero tags: declined, nothing written' }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero tags updated${ref === '' ? '' : `: ${ref}`}` }
}

export function registerAddTagsTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_add_tags',
      description:
        'Add tags to one Zotero item. Tags merge with what the item already carries — existing tags and their types are preserved — and the union is written under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies. When every requested tag is already present nothing is written and unchanged is true. When writeConfirm is on (the default) the write first shows a plan the user approves; kind "declined" means the user answered the plan without approving and nothing was written — do not retry unasked.',
      parameters: ADD_TAGS_PARAMETERS,
      output: {
        schema: ADD_TAGS_OUTPUT_SCHEMA,
        render: renderAddTags,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref ?? '',
                version: value.version ?? 0,
                addedCount: (value.added ?? []).length,
              }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Add Zotero tags',
        rawInput: args.tags.join(', '),
      }),
      presentResult: presentAddTagsResult,
      async execute(args, exec) {
        const request = buildRequest(args)
        if (service.config.writeConfirm) {
          const approved = await askPlanApproval(ctx, exec, addTagsPlan(args))
          if (!approved) return { kind: 'declined' } as const
        }
        return await service.updateTags(request, exec.signal)
      },
    }),
  )
}
