/**
 * The `zotero_add_to_collection` tool: add one Zotero item to a collection,
 * by ref or by name. The domain validates the collection on execute (after
 * plan approval if writeConfirm is enabled), then runs read-merge-write under
 * a version precondition; an already-member item writes nothing and reports
 * added: false. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/add-to-collection
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
import { metaRecordOf, renderDeclined } from './present.js'
import { isRefString } from '../refs.js'
import {
  assertNonBlank,
  parseWritableRef,
  WRITE_COLLECTION_REF_ARG_HINT,
  WRITE_REF_ARG_HINT,
} from './validate.js'
import { askPlanApproval, WRITE_PLAN_OUTCOME_DESCRIPTION } from './write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroCollectionAddOutcome, ZoteroCollectionAddRequest } from '../types.js'

const ADD_TO_COLLECTION_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref to add.`,
  },
  collection: {
    type: 'string',
    required: true,
    description: `The collection to add the item to: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact collection name (zotero_browse lists them). An unknown name fails before any write.`,
  },
} as const

type AddToCollectionArgs = InferArgs<typeof ADD_TO_COLLECTION_PARAMETERS>

const ADD_TO_COLLECTION_OUTPUT_SCHEMA = {
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
        collections: { type: 'array', items: { type: 'string' }, required: true },
        added: {
          type: 'boolean',
          required: true,
          description: 'True when the item was newly added; false when it was already a member.',
        },
        libraryVersion: {
          type: 'integer',
          description: 'The library version the write advanced to; absent when already a member.',
        },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type AddToCollectionOutput = InferValue<typeof ADD_TO_COLLECTION_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function addToCollectionPlan(args: AddToCollectionArgs): string {
  return [
    '**Add a Zotero item to a collection**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Item: ${args.ref}`,
    `- Collection: ${args.collection.trim()}`,
    "The item's existing collections are preserved; the union is written under a version precondition.",
  ].join('\n')
}

function buildRequest(args: AddToCollectionArgs): ZoteroCollectionAddRequest {
  const collection = assertNonBlank('collection', args.collection)
  if (isRefString(collection)) parseWritableRef(collection, ['collection'])
  return { item: parseWritableRef(args.ref, ['item']), collection }
}

export function renderAddToCollection(
  _args: AddToCollectionArgs,
  value: AddToCollectionOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [
    value.added
      ? `Added ${value.ref} to the collection (version ${value.version}).`
      : `${value.ref} was already a member; nothing was written (version ${value.version}).`,
  ]
  lines.push(`Collections now: ${value.collections.join(', ')}`)
  if (value.libraryVersion !== undefined) {
    lines.push(
      `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentAddToCollectionResult(
  _args: AddToCollectionArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero collection add: declined, nothing written' }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero collection membership${ref === '' ? '' : `: ${ref}`}` }
}

export function registerAddToCollectionTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_add_to_collection',
      description:
        "Add one Zotero item to a collection, by collection ref or exact name. Membership merges with the item's existing collections under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies; an already-member item returns added: false and writes nothing. An unknown collection name fails when executed before any item write. " +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: ADD_TO_COLLECTION_PARAMETERS,
      output: {
        schema: ADD_TO_COLLECTION_OUTPUT_SCHEMA,
        render: renderAddToCollection,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref,
                version: value.version,
                added: value.added,
              }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Add item to Zotero collection',
        rawInput: args.collection,
      }),
      presentResult: presentAddToCollectionResult,
      // timeoutMs is deliberately omitted: the plan-review card waits on user
      // think time, which is not a stuck request.
      async execute(args, exec): Promise<ZoteroCollectionAddOutcome> {
        // No connectivity ask wraps the write: that helper retries, and only
        // idempotent reads may be retried.
        const request = buildRequest(args)
        if (service.config.writeConfirm) {
          const approved = await askPlanApproval(ctx, exec, addToCollectionPlan(args))
          if (!approved) return { kind: 'declined' } as const
        }
        return await service.addToCollection(request, exec.signal)
      },
    }),
  )
}
