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
import { metaRecordOf, renderDeclined } from './present.js'
import { DECLINED_OUTPUT_SCHEMA } from './write-present.js'
import { parseWritableRef, assertWriteList, WRITE_REF_ARG_HINT } from './validate.js'
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroRestoreItemsOutcome, ZoteroRestoreItemsRequest } from '../types.js'

const PARAMETERS = {
  refs: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: `Trashed ${WRITE_REF_ARG_HINT} refs to restore.`,
  },
} as const
type Args = InferArgs<typeof PARAMETERS>

/** One restored item: the closed shape `ZoteroRestoreItemResult` carries. */
const RESTORED_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    restored: { type: 'boolean', enum: [true], required: true },
    version: { type: 'integer', required: true },
    libraryVersion: { type: 'integer', required: true },
    serverId: { type: 'string' },
  },
} as const

/** One failed item: the closed shape `ZoteroBatchOperationFailure` carries. */
const FAILED_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['create', 'update', 'delete'], required: true },
    ref: { type: 'string' },
    index: { type: 'integer' },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    completedRefs: { type: 'array', items: { type: 'string' } },
  },
} as const

const OUTPUT = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['restored'], required: true },
        restored: { type: 'array', required: true, items: RESTORED_ITEM },
        failed: { type: 'array', required: true, items: FAILED_ITEM },
        serverId: { type: 'string' },
      },
    },
  ],
} as const
type Output = InferValue<typeof OUTPUT>

export function restoreItemsPlan(args: Args): string {
  return [
    '**Restore Zotero Trash items**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Items: ${args.refs.join(', ')}`,
    'Each item is restored with deleted=0 under its own version precondition; failures are reported per ref.',
  ].join('\n')
}

export function renderRestoreItems(_args: Args, value: Output): ContentBlock[] {
  if (value.kind === 'declined') return renderDeclined()
  return [
    {
      type: 'text',
      text: `Restored ${value.restored.length} item(s); ${value.failed.length} failed.`,
    },
  ]
}

/** Replayable projection: the per-arm counts, so the card can state them without the rows. */
function presentRestoreItemsMeta(_args: Args, value: Output): JsonValue {
  if (value.kind === 'declined') return { kind: 'declined' }
  return {
    kind: 'restored',
    restoredCount: value.restored.length,
    failedCount: value.failed.length,
    ...(value.serverId === undefined ? {} : { serverId: value.serverId }),
  }
}

function presentRestoreItemsResult(_args: Args, result: ToolResult): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero restore: declined, nothing written' }
  }
  const restored = typeof record.restoredCount === 'number' ? record.restoredCount : 0
  const failed = typeof record.failedCount === 'number' ? record.failedCount : 0
  return {
    card: 'generic',
    title: `Zotero restore applied: ${restored} restored${failed > 0 ? `, ${failed} failed` : ''}`,
  }
}

export function registerRestoreItemsTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_restore_items',
      description: `Restore items from Zotero Trash. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
      parameters: PARAMETERS,
      output: {
        schema: OUTPUT,
        render: renderRestoreItems,
        presentationMeta: presentRestoreItemsMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Restore Zotero Trash items',
        rawInput: `${args.refs.length} items`,
      }),
      presentResult: presentRestoreItemsResult,
      async execute(args, exec): Promise<ZoteroRestoreItemsOutcome> {
        const refs = assertWriteList('refs', args.refs, 50).map((ref) =>
          parseWritableRef(ref, ['item']),
        )
        const request: ZoteroRestoreItemsRequest = { items: refs }
        return await service.restoreItems(request, {
          exec,
          plan: restoreItemsPlan(args),
        })
      },
    }),
  )
}
