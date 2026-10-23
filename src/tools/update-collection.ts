import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderDeclined } from './present.js'
import {
  DECLINED_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentUpdateResultView,
} from './write-present.js'
import { parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js'
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroUpdateCollectionOutcome, ZoteroUpdateCollectionRequest } from '../types.js'

const PARAMETERS = {
  collection: {
    type: 'string',
    required: true,
    description: `A ${WRITE_COLLECTION_REF_ARG_HINT} ref.`,
  },
  name: { type: 'string' },
  parent: {
    type: 'string',
    description: 'A collection ref; omit to preserve the current parent.',
  },
} as const
type Args = InferArgs<typeof PARAMETERS>
const OUTPUT = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        name: { type: 'string' },
        parentRef: { type: 'string' },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
  ],
} as const
type Output = InferValue<typeof OUTPUT>
export function updateCollectionPlan(args: Args): string {
  return [
    '**Update a Zotero collection**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Collection: ${args.collection}`,
    ...(args.name === undefined ? [] : [`- Name: ${args.name}`]),
    ...(args.parent === undefined ? [] : [`- Parent: ${args.parent}`]),
    'The collection is patched under its current object version.',
  ].join('\n')
}
export function renderUpdateCollection(_args: Args, value: Output): ContentBlock[] {
  if (value.kind === 'declined') return renderDeclined()
  return [
    {
      type: 'text',
      text: [
        `Updated collection ${value.ref} (version ${value.version}).`,
        libraryVersionLine(value),
      ].join('\n'),
    },
  ]
}
/** Replayable projection: the applied collection identity, or the declined fact. */
function presentUpdateCollectionMeta(_args: Args, value: Output): JsonValue {
  if (value.kind === 'declined') return { kind: 'declined' }
  return {
    kind: 'applied',
    ref: value.ref,
    version: value.version,
    ...(value.parentRef === undefined ? {} : { parentRef: value.parentRef }),
  }
}

function presentUpdateCollectionResult(
  _args: Args,
  result: ToolResult,
): ToolResultView | undefined {
  return presentUpdateResultView('collection', result)
}

export function registerUpdateCollectionTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_update_collection',
      description: `Rename or reparent a Zotero collection under its object version. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
      parameters: PARAMETERS,
      output: {
        schema: OUTPUT,
        render: renderUpdateCollection,
        presentationMeta: presentUpdateCollectionMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero collection',
        rawInput: args.collection,
      }),
      presentResult: presentUpdateCollectionResult,
      async execute(args, exec): Promise<ZoteroUpdateCollectionOutcome> {
        const request: ZoteroUpdateCollectionRequest = {
          collection: parseWritableRef(args.collection, ['collection']),
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.parent === undefined
            ? {}
            : { parent: parseWritableRef(args.parent, ['collection']) }),
        }
        return await service.updateCollection(request, { exec, plan: updateCollectionPlan(args) })
      },
    }),
  )
}
