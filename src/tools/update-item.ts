/**
 * The `zotero_update_item` tool: update one item's scalar metadata fields.
 * Every field must belong to the closed set and be valid for the item's own
 * type (checked against `itemTypeFields`); the PATCH carries wire names under
 * a version precondition. `creators`, `itemType`, `tags`, and `collections`
 * have their own tools and never enter here.
 * @module dsh-zotero/tools/update-item
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
import { writeListEmptyMessage, writeNonBlankMessage } from '../errors.js'
import { metaRecordOf, renderDeclined } from './present.js'
import { invalid, parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import {
  ZOTERO_UPDATABLE_ITEM_FIELDS,
  type ZoteroUpdateItemOutcome,
  type ZoteroUpdateItemRequest,
  type ZoteroUpdatableItemField,
} from '../types.js'

const UPDATE_ITEM_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref whose metadata changes.`,
  },
  set: {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      date: { type: 'string' },
      url: { type: 'string' },
      doi: { type: 'string' },
      abstractNote: { type: 'string' },
      publicationTitle: { type: 'string' },
      extra: { type: 'string' },
    },
    description:
      'Field updates (at least one): title, date, url, doi, abstractNote, publicationTitle, extra. Each value must be non-blank text and valid for the item type.',
  },
} as const

type UpdateItemArgs = InferArgs<typeof UPDATE_ITEM_PARAMETERS>

const UPDATE_ITEM_OUTPUT_SCHEMA = {
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
        version: { type: 'integer', required: true },
        changed: { type: 'array', items: { type: 'string' }, required: true },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type UpdateItemOutput = InferValue<typeof UPDATE_ITEM_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function updateItemPlan(args: UpdateItemArgs): string {
  const entries = Object.entries((args.set ?? {}) as Record<string, string>)
  return [
    '**Update a Zotero item**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Item: ${args.ref}`,
    ...entries.map(([field, value]) => `- ${field}: ${String(value).trim().slice(0, 200)}`),
    'Each field must be valid for the item type; an invalid field refuses the write before any PATCH.',
  ].join('\n')
}

function buildRequest(args: UpdateItemArgs): ZoteroUpdateItemRequest {
  const set = (args.set ?? {}) as Record<string, unknown>
  const entries = Object.entries(set)
  if (entries.length === 0) invalid(writeListEmptyMessage('set'))
  const updates: Partial<Record<ZoteroUpdatableItemField, string>> = {}
  for (const [field, value] of entries) {
    if (!(ZOTERO_UPDATABLE_ITEM_FIELDS as readonly string[]).includes(field)) {
      invalid(
        `"${field}" is not an updatable field; updatable fields are ${ZOTERO_UPDATABLE_ITEM_FIELDS.join(', ')}.`,
      )
    }
    if (typeof value !== 'string' || value.trim() === '') {
      invalid(writeNonBlankMessage(`set.${field}`))
    }
    updates[field as ZoteroUpdatableItemField] = (value as string).trim()
  }
  return {
    item: parseWritableRef(args.ref, ['item']),
    set: updates,
  }
}

export function renderUpdateItem(_args: UpdateItemArgs, value: UpdateItemOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  return [
    {
      type: 'text',
      text: [
        `Updated ${value.ref} (version ${value.version}); changed ${value.changed.join(', ')}.`,
        `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
      ].join('\n'),
    },
  ]
}

function presentUpdateItemResult(
  _args: UpdateItemArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero item: declined, nothing written' }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero item updated${ref === '' ? '' : `: ${ref}`}` }
}

export function registerUpdateItemTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_update_item',
      description:
        "Update one item's scalar metadata (title, date, url, doi, abstractNote, publicationTitle, extra) under a version precondition. Each field must be valid for the item's type — check zotero_browse kind itemFields first; an invalid field fails as ZOTERO_INVALID_ARGUMENT before any write. Creators, itemType, tags, and collections have their own tools. " +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: UPDATE_ITEM_PARAMETERS,
      output: {
        schema: UPDATE_ITEM_OUTPUT_SCHEMA,
        render: renderUpdateItem,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref,
                version: value.version,
                changedCount: value.changed.length,
              }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero item',
        rawInput: args.ref,
      }),
      presentResult: presentUpdateItemResult,
      async execute(args, exec): Promise<ZoteroUpdateItemOutcome> {
        const request = buildRequest(args)
        return await service.updateItem(request, { exec, plan: updateItemPlan(args) })
      },
    }),
  )
}
