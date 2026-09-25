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
import { metaRecordOf, renderDeclined } from './present.js'
import { assertNonBlank, invalid, parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js'
import { askPlanApproval, WRITE_PLAN_OUTCOME_DESCRIPTION } from './write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroTagUpdateOutcome, ZoteroTagUpdateRequest } from '../types.js'

const ADD_TAGS_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref to tag.`,
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
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: { type: 'string', required: true },
        version: {
          type: 'integer',
          required: true,
          description: "The item's version after the update.",
        },
        tags: { type: 'array', items: { type: 'string' }, required: true },
        added: { type: 'array', items: { type: 'string' }, required: true },
        unchanged: { type: 'boolean', required: true },
        libraryVersion: {
          type: 'integer',
          description: 'The library version the write advanced to; absent when unchanged.',
        },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type AddTagsOutput = InferValue<typeof ADD_TAGS_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function addTagsPlan(args: AddTagsArgs): string {
  return [
    '**Add tags to a Zotero item**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Item: ${args.ref}`,
    `- Tags to add: ${args.tags.map((tag) => tag.trim()).join(', ')}`,
    'Existing tags on the item are preserved; the union is written under a version precondition.',
  ].join('\n')
}

function buildRequest(args: AddTagsArgs): ZoteroTagUpdateRequest {
  if (args.tags.length === 0) invalid(writeListEmptyMessage('tags'))
  if (args.tags.length > ZOTERO_WRITE_LIST_MAX_ITEMS) {
    invalid(writeListTooLongMessage('tags', ZOTERO_WRITE_LIST_MAX_ITEMS))
  }
  const tags = args.tags.map((tag) => assertNonBlank('tags', tag))
  return { item: parseWritableRef(args.ref, ['item']), tags }
}

export function renderAddTags(_args: AddTagsArgs, value: AddTagsOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [
    value.unchanged
      ? `No change: ${value.ref} already carries every requested tag (version ${value.version}).`
      : `Tagged ${value.ref} (version ${value.version}); added ${value.added.join(', ')}.`,
  ]
  lines.push(`Tags now: ${value.tags.join(', ')}`)
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
        'Add tags to one Zotero item. Tags merge with what the item already carries — existing tags and their types are preserved — and the union is written under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies. When every requested tag is already present nothing is written and unchanged is true. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: ADD_TAGS_PARAMETERS,
      output: {
        schema: ADD_TAGS_OUTPUT_SCHEMA,
        render: renderAddTags,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref,
                version: value.version,
                addedCount: value.added.length,
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
      // timeoutMs is deliberately omitted: the plan-review card waits on user
      // think time, which is not a stuck request.
      async execute(args, exec): Promise<ZoteroTagUpdateOutcome> {
        // No connectivity ask wraps the write: that helper retries, and only
        // idempotent reads may be retried.
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
