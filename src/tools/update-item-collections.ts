/**
 * The `zotero_update_item_collections` tool: update one item's collection
 * membership with add and remove settling in a single read-merge-write.
 * Collections are named by ref or exact name; unknown or ambiguous names fail
 * before any write. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/update-item-collections
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
import { WRITE_LIST_SELECTION_MESSAGE, writeListTooLongMessage } from '../errors.js'
import { isRefString } from '../refs.js'
import { metaRecordOf, renderDeclined } from './present.js'
import {
  assertWriteList,
  invalid,
  parseWritableRef,
  WRITE_COLLECTION_REF_ARG_HINT,
  WRITE_REF_ARG_HINT,
} from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type {
  ZoteroUpdateItemCollectionsOutcome,
  ZoteroUpdateItemCollectionsRequest,
} from '../types.js'

const UPDATE_ITEM_COLLECTIONS_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref whose membership changes.`,
  },
  add: {
    type: 'array',
    items: { type: 'string' },
    description: `Collections to join: ${WRITE_COLLECTION_REF_ARG_HINT} refs or exact names (zotero_browse lists them).`,
  },
  remove: {
    type: 'array',
    items: { type: 'string' },
    description: `Collections to leave: ${WRITE_COLLECTION_REF_ARG_HINT} refs or exact names.`,
  },
} as const

type UpdateItemCollectionsArgs = InferArgs<typeof UPDATE_ITEM_COLLECTIONS_PARAMETERS>

const UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA = {
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
          description: "The item's version after the update (or the read version when unchanged).",
        },
        collections: { type: 'array', items: { type: 'string' }, required: true },
        added: { type: 'array', items: { type: 'string' }, required: true },
        removed: { type: 'array', items: { type: 'string' }, required: true },
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

type UpdateItemCollectionsOutput = InferValue<typeof UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function updateItemCollectionsPlan(args: UpdateItemCollectionsArgs): string {
  const add = args.add ?? []
  const remove = args.remove ?? []
  return [
    '**Update a Zotero item\u2019s collections**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Item: ${args.ref}`,
    `- Collections to add: ${add.length === 0 ? '(none)' : add.map((c) => c.trim()).join(', ')}`,
    `- Collections to remove: ${remove.length === 0 ? '(none)' : remove.map((c) => c.trim()).join(', ')}`,
    "The item's other collections are preserved; the merged list is written under a version precondition. Names resolve before any write.",
  ].join('\n')
}

function buildRequest(
  args: UpdateItemCollectionsArgs,
  config: ResolvedConfig,
): ZoteroUpdateItemCollectionsRequest {
  const add =
    args.add === undefined ? [] : assertWriteList('add', args.add, config.writeListMaxItems)
  const remove =
    args.remove === undefined
      ? []
      : assertWriteList('remove', args.remove, config.writeListMaxItems)
  if (add.length + remove.length === 0) invalid(WRITE_LIST_SELECTION_MESSAGE)
  if (add.length + remove.length > config.writeListMaxItems) {
    invalid(writeListTooLongMessage('add and remove', config.writeListMaxItems))
  }
  for (const collection of [...add, ...remove]) {
    if (isRefString(collection)) parseWritableRef(collection, ['collection'])
  }
  return {
    item: parseWritableRef(args.ref, ['item']),
    ...(add.length > 0 ? { add } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  }
}

export function renderUpdateItemCollections(
  _args: UpdateItemCollectionsArgs,
  value: UpdateItemCollectionsOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [
    value.unchanged
      ? `No change: ${value.ref} already carries the requested membership (version ${value.version}).`
      : `Updated collections on ${value.ref} (version ${value.version}); added ${value.added.length === 0 ? '(none)' : value.added.join(', ')}; removed ${value.removed.length === 0 ? '(none)' : value.removed.join(', ')}.`,
  ]
  lines.push(
    `Collections now: ${value.collections.length === 0 ? '(none)' : value.collections.join(', ')}`,
  )
  if (value.libraryVersion !== undefined) {
    lines.push(
      `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentUpdateItemCollectionsResult(
  _args: UpdateItemCollectionsArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero membership: declined, nothing written' }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero membership updated${ref === '' ? '' : `: ${ref}`}` }
}

export function registerUpdateItemCollectionsTool(
  ctx: Context,
  service: ZoteroService,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_update_item_collections',
      description:
        "Update one item's collection membership: add and remove settle in a single read-merge-write under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies. Collections are refs or exact names; an unknown name fails before any write. When the merged membership equals the saved one nothing is written and unchanged is true. " +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: UPDATE_ITEM_COLLECTIONS_PARAMETERS,
      output: {
        schema: UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA,
        render: renderUpdateItemCollections,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref,
                version: value.version,
                addedCount: value.added.length,
                removedCount: value.removed.length,
              }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero item collections',
        rawInput: [...(args.add ?? []), ...(args.remove ?? [])].join(', '),
      }),
      presentResult: presentUpdateItemCollectionsResult,
      async execute(args, exec): Promise<ZoteroUpdateItemCollectionsOutcome> {
        const request = buildRequest(args, service.config)
        return await service.updateItemCollections(request, {
          exec,
          plan: updateItemCollectionsPlan(args),
        })
      },
    }),
  )
}
