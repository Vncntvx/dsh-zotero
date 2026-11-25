/** The `zotero_get_batch` tool: bounded metadata reads with isolated failures. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { defineZoteroTool as defineTool } from '../define-tool.js'
import { identityToolWrapper, type ToolWrapper } from '../result-delivery.js'
import { asJsonValue } from '../json.js'
import { parseSupportedRef } from '../refs.js'
import { assertGetBatchRequest, GET_BATCH_MAX } from '../local/get-batch-domain.js'
import { projectGetBatchMeta } from '../presentation-meta.js'
import type { ZoteroGetBatchRequest, ZoteroGetBatchResult } from '../types.js'
import type { ZoteroService } from '../service.js'

const PARAMETERS = {
  refs: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: `Zotero item or attachment refs to read in order; 1–${GET_BATCH_MAX}, unique. Use this for multiple refs instead of repeated zotero_get calls.`,
  },
  fields: {
    type: 'string',
    enum: ['standard', 'all'],
    default: 'standard',
    description: 'Metadata projection; all preserves unconsumed Zotero data fields.',
  },
  include: {
    type: 'object',
    additionalProperties: false,
    properties: {
      children: {
        type: 'boolean',
        description: 'Notes, annotations and attachments; item refs only.',
      },
      attachments: {
        type: 'boolean',
        description: 'Attachments; item refs only.',
      },
      relations: { type: 'boolean', description: 'Include item relations when available.' },
      bestAttachment: { type: 'boolean', description: 'Resolve the best attachment location.' },
    },
  },
} as const

type Args = InferArgs<typeof PARAMETERS>
type Output = InferValue<typeof OUTPUT>

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      required: true,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: true,
            properties: {
              ref: { type: 'string', required: true },
              status: { type: 'string', const: 'ok', required: true },
              item: { type: 'object', additionalProperties: true, required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              status: { type: 'string', const: 'error', required: true },
              code: { type: 'string', required: true },
              message: { type: 'string', required: true },
              next: { type: 'string' },
            },
          },
        ],
      },
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        requested: { type: 'integer', required: true },
        succeeded: { type: 'integer', required: true },
        failed: { type: 'integer', required: true },
      },
    },
  },
} as const

function buildRequest(args: Args): ZoteroGetBatchRequest {
  const request = {
    refs: args.refs.map((value) => parseSupportedRef(value, ['item', 'attachment'])),
    ...(args.fields !== undefined ? { fields: args.fields } : {}),
    ...(args.include !== undefined ? { include: args.include } : {}),
  }
  assertGetBatchRequest(request)
  return request
}

function renderGetBatch(_args: Args, value: Output): ContentBlock[] {
  const lines = [
    `Read ${value.counts.succeeded} of ${value.counts.requested} refs (${value.counts.failed} failed):`,
  ]
  for (const entry of value.items) {
    if (entry.status === 'ok')
      lines.push(`- ${entry.ref}: ${entry.item.title || entry.item.itemType}`)
    else
      lines.push(
        `- ${entry.ref}: ${entry.code} — ${entry.message}${entry.next === undefined ? '' : ` (${entry.next})`}`,
      )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerGetBatchTool(
  ctx: Context,
  service: ZoteroService,
  wrap: ToolWrapper = identityToolWrapper,
): void {
  ctx.tools.register(
    wrap(
      defineTool({
        name: 'zotero_get_batch',
        description:
          'Read multiple Zotero item or attachment refs in one bounded call. Results preserve input order and report each ref independently; use zotero_get for one ref or extra child detail.',
        parameters: PARAMETERS,
        output: {
          schema: OUTPUT,
          render: renderGetBatch,
          presentationMeta: (_args, value) => projectGetBatchMeta(value as ZoteroGetBatchResult),
        },
        presentCall: (args) => ({
          card: 'generic',
          kind: 'read',
          title: 'Read Zotero items',
          rawInput: `${args.refs.length} refs`,
        }),
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const result = await service.getBatch(buildRequest(args), exec.signal)
          return {
            counts: result.counts,
            items: result.items.map((entry) => {
              if (entry.status === 'error') return entry
              const itemRecord: Record<string, JsonValue> = {}
              for (const [k, v] of Object.entries(entry.item)) {
                if (k === 'publicationTitle') continue
                const json = asJsonValue(v)
                if (json !== undefined) itemRecord[k] = json
              }
              return {
                ref: entry.ref,
                status: entry.status,
                item: itemRecord,
              }
            }),
          }
        },
      }),
    ),
  )
}
