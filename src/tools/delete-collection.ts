/**
 * The `zotero_delete_collection` tool: delete a collection by ref or exact
 * name. The plan card carries the blast radius first (item and subcollection
 * counts read before approval); the delete itself carries the library version
 * of its preceding read, so a concurrent write fails it. Entries keep their
 * items; child collections go with the parent.
 * @module dsh-zotero/tools/delete-collection
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
import { isRefString } from '../refs.js'
import { renderDeclined } from './present.js'
import {
  DECLINED_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentDeleteResultView,
} from './write-present.js'
import { assertNonBlank, parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroDeleteCollectionOutcome, ZoteroDeleteCollectionRequest } from '../types.js'

const DELETE_COLLECTION_PARAMETERS = {
  collection: {
    type: 'string',
    required: true,
    description: `The collection to delete: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact name (zotero_browse lists them). Items keep their library membership; child collections are deleted with the parent.`,
  },
} as const

type DeleteCollectionArgs = InferArgs<typeof DELETE_COLLECTION_PARAMETERS>

const DELETE_COLLECTION_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['deleted'], required: true },
        ref: { type: 'string', required: true },
        key: { type: 'string', required: true },
        deleted: { type: 'boolean', enum: [true], required: true },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
  ],
} as const

type DeleteCollectionOutput = InferValue<typeof DELETE_COLLECTION_OUTPUT_SCHEMA>

function formatCount(value: number | undefined): string {
  return value === undefined ? 'unknown' : String(value)
}

/** The deterministic plan markdown the approval card renders, with the previewed radius. */
export function deleteCollectionPlan(
  args: DeleteCollectionArgs,
  preview: { itemTotal?: number; childTotal?: number } = {},
): string {
  return [
    '**Delete a Zotero collection**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Collection: ${args.collection.trim()}`,
    `- Items in this collection: ${formatCount(preview.itemTotal)} (they stay in the library, membership only)`,
    `- Child collections: ${formatCount(preview.childTotal)} (they are deleted with the parent)`,
    'This deletes the collection structure and cannot be undone; the delete carries a version precondition, so a concurrent change fails it.',
  ].join('\n')
}

function buildRequest(args: DeleteCollectionArgs): ZoteroDeleteCollectionRequest {
  const collection = assertNonBlank('collection', args.collection)
  if (isRefString(collection)) parseWritableRef(collection, ['collection'])
  return { collection }
}

/**
 * Read the blast radius before the plan card: the item count via the
 * collection search scope and the child-collection count via the collections
 * browse. The count is best-effort: an unresolvable name leaves it unknown and the
 * domain reports the miss after approval.
 */
async function fetchItemPreview(
  service: ZoteroService,
  refOrName: string,
  signal: AbortSignal | undefined,
): Promise<{ total?: number; ref?: string }> {
  try {
    const searched = await service.search(
      {
        mode: 'metadata',
        scope: { kind: 'collection', refOrName },
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
        limit: 1,
      },
      signal,
    )
    return {
      total: searched.total,
      ref: searched.scope.kind === 'collection' ? searched.scope.ref : undefined,
    }
  } catch {
    return {}
  }
}

async function fetchChildPreview(
  service: ZoteroService,
  parentRef: string,
  signal: AbortSignal | undefined,
): Promise<number | undefined> {
  try {
    const browsed = await service.browse(
      { kind: 'collections', parentRef, offset: 0, limit: 1 },
      signal,
    )
    return browsed.total
  } catch {
    return undefined
  }
}

async function previewDeleteCollection(
  service: ZoteroService,
  collection: string,
  signal: AbortSignal | undefined,
): Promise<{ itemTotal?: number; childTotal?: number }> {
  const target = collection.trim()
  const directRef = isRefString(target) ? target : undefined
  let itemTotal: number | undefined
  let childTotal: number | undefined

  if (directRef !== undefined) {
    const [itemRes, childRes] = await Promise.all([
      fetchItemPreview(service, directRef, signal),
      fetchChildPreview(service, directRef, signal),
    ])
    itemTotal = itemRes.total
    childTotal = childRes
  } else {
    const itemRes = await fetchItemPreview(service, target, signal)
    itemTotal = itemRes.total
    if (itemRes.ref !== undefined) {
      childTotal = await fetchChildPreview(service, itemRes.ref, signal)
    }
  }
  return {
    ...(itemTotal !== undefined ? { itemTotal } : {}),
    ...(childTotal !== undefined ? { childTotal } : {}),
  }
}

export function renderDeleteCollection(
  _args: DeleteCollectionArgs,
  value: DeleteCollectionOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  return [
    {
      type: 'text',
      text: [`Deleted collection ${value.ref}.`, libraryVersionLine(value)].join('\n'),
    },
  ]
}

function presentDeleteCollectionResult(
  _args: DeleteCollectionArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentDeleteResultView('collection delete', 'collection', result)
}

export function registerDeleteCollectionTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_delete_collection',
      description:
        'Delete a collection in the Zotero personal library, by ref or exact name. Items in the collection stay in the library (membership only); child collections are deleted with the parent and the structure cannot be restored. The plan card states the item and child-collection counts first. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION,
      parameters: DELETE_COLLECTION_PARAMETERS,
      output: {
        schema: DELETE_COLLECTION_OUTPUT_SCHEMA,
        render: renderDeleteCollection,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'deleted'
            ? { kind: 'deleted', ref: value.ref, key: value.key }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Delete Zotero collection',
        rawInput: args.collection,
      }),
      presentResult: presentDeleteCollectionResult,
      async execute(args, exec): Promise<ZoteroDeleteCollectionOutcome> {
        const request = buildRequest(args)
        const preview = await previewDeleteCollection(service, request.collection, exec.signal)
        return await service.deleteCollection(request, {
          exec,
          plan: deleteCollectionPlan(args, preview),
        })
      },
    }),
  )
}
