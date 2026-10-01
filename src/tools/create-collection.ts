/**
 * The `zotero_create_collection` tool: create a collection, optionally under a
 * parent. A sibling that already carries the name refuses the write before any
 * POST. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/create-collection
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
  COMMITTED_UNVERIFIED_VARIANT,
  createWritePresentationMeta,
  libraryVersionLine,
  presentCreateResultView,
  renderCommittedUnverified,
} from './write-present.js'
import {
  assertNonBlank,
  invalid,
  parseWritableRef,
  WRITE_COLLECTION_REF_ARG_HINT,
} from './validate.js'
import {
  WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
  WRITE_PLAN_OUTCOME_DESCRIPTION,
} from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroCreateCollectionOutcome, ZoteroCreateCollectionRequest } from '../types.js'

const CREATE_COLLECTION_PARAMETERS = {
  name: {
    type: 'string',
    required: true,
    description:
      'The new collection name (non-blank). A sibling with the same name refuses the write.',
  },
  parent: {
    type: 'string',
    description: `The parent collection: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact name. Omit for a top-level collection.`,
  },
} as const

type CreateCollectionArgs = InferArgs<typeof CREATE_COLLECTION_PARAMETERS>

const CREATE_COLLECTION_OUTPUT_SCHEMA = {
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
        key: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        name: { type: 'string', required: true },
        parentRef: { type: 'string' },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
    COMMITTED_UNVERIFIED_VARIANT,
  ],
} as const

type CreateCollectionOutput = InferValue<typeof CREATE_COLLECTION_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function createCollectionPlan(args: CreateCollectionArgs): string {
  return [
    '**Create a Zotero collection**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Name: ${args.name.trim()}`,
    `- Parent: ${args.parent === undefined ? '(top level)' : args.parent.trim()}`,
    'A sibling collection with the same name refuses the write; the created collection carries the returned ref.',
  ].join('\n')
}

function buildRequest(args: CreateCollectionArgs): ZoteroCreateCollectionRequest {
  const name = assertNonBlank('name', args.name)
  let parent: string | undefined
  if (args.parent !== undefined) {
    parent = assertNonBlank('parent', args.parent)
    if (isRefString(parent)) parseWritableRef(parent, ['collection'])
  }
  return {
    name,
    ...(parent !== undefined ? { parent } : {}),
  }
}

export function renderCreateCollection(
  _args: CreateCollectionArgs,
  value: CreateCollectionOutput,
): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  if (value.kind === 'committed-unverified') {
    return renderCommittedUnverified(value, 'collection', 'created')
  }
  const lines = [`Created collection ${value.ref} (version ${value.version}): ${value.name}.`]
  if (value.parentRef !== undefined) lines.push(`Parent: ${value.parentRef}`)
  lines.push(libraryVersionLine(value))
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentCreateCollectionResult(
  _args: CreateCollectionArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentCreateResultView('collection', 'created', result)
}

export function registerCreateCollectionTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_create_collection',
      description:
        'Create a collection in the Zotero personal library, optionally under a parent (ref or exact name). A sibling collection that already carries the name refuses the write before any POST, so work with the existing ref instead. Zotero itself may show its authorization dialog on first use. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION +
        WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
      parameters: CREATE_COLLECTION_PARAMETERS,
      output: {
        schema: CREATE_COLLECTION_OUTPUT_SCHEMA,
        render: renderCreateCollection,
        presentationMeta: (_args, value): JsonValue => createWritePresentationMeta(value),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Create Zotero collection',
        rawInput: args.name,
      }),
      presentResult: presentCreateCollectionResult,
      async execute(args, exec): Promise<ZoteroCreateCollectionOutcome> {
        const request = buildRequest(args)
        return await service.createCollection(request, { exec, plan: createCollectionPlan(args) })
      },
    }),
  )
}
