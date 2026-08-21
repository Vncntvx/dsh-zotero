/**
 * The `zotero_children` tool: explore the Zotero object graph. An item ref
 * yields its direct notes and attachments plus every attachment's
 * annotations as one merged corpus; an attachment ref yields its own
 * annotations. This is the graph-exploration counterpart to `zotero_get`
 * (one object's detail) — use it when the model needs to walk structure
 * rather than read metadata.
 * @module dsh-zotero/tools/children
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { boundedPresentationMeta } from '../presentation-meta.js'
import { parseRef, requireSupportedLocalRef } from '../refs.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroChildrenInclude, ZoteroChildrenRequest } from '../types.js'

const CHILDREN_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description:
      'A zotero://user/0/item/<KEY>, zotero://user/0/attachment/<KEY> (or group form) ref from a previous tool result.',
  },
  include: {
    type: 'array',
    items: { type: 'string', enum: ['notes', 'attachments', 'annotations'] },
    description:
      'Child kinds to return; omitted returns all three. Item refs yield notes+attachments+annotations (annotations gathered from each attachment); attachment refs yield their annotations.',
  },
} as const

type ChildrenArgs = InferArgs<typeof CHILDREN_PARAMETERS>

const CHILDREN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    itemType: { type: 'string' },
    serverId: { type: 'string' },
    notes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
              parentRef: { type: 'string' },
            },
          },
        },
      },
    },
    annotations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              type: { type: 'string', required: true },
              text: { type: 'string', required: true },
              comment: { type: 'string' },
              color: { type: 'string' },
              pageLabel: { type: 'string' },
              parentRef: { type: 'string' },
            },
          },
        },
      },
    },
    attachments: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              title: { type: 'string', required: true },
              contentType: { type: 'string', required: true },
              linkMode: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const

type ChildrenOutput = InferValue<typeof CHILDREN_OUTPUT_SCHEMA>

function buildRequest(args: ChildrenArgs): ZoteroChildrenRequest {
  const ref = parseRef(args.ref)
  requireSupportedLocalRef(ref, ['item', 'attachment'])
  const include = new Set<ZoteroChildrenInclude>(
    (args.include as ZoteroChildrenInclude[] | undefined) ?? [
      'notes',
      'attachments',
      'annotations',
    ],
  )
  return { ref, include }
}

export function renderChildren(_args: ChildrenArgs, value: ChildrenOutput): ContentBlock[] {
  const lines = [`${value.ref}${value.itemType === undefined ? '' : ` (${value.itemType})`}`]
  if (value.notes !== undefined) {
    lines.push(`Notes: ${value.notes.returned} of ${value.notes.total}`)
    for (const note of value.notes.items) {
      lines.push(`  - ${note.ref}: ${note.text}`)
    }
  }
  if (value.attachments !== undefined) {
    lines.push(`Attachments: ${value.attachments.returned} of ${value.attachments.total}`)
    for (const attachment of value.attachments.items) {
      lines.push(`  - ${attachment.ref}: ${attachment.title} (${attachment.contentType})`)
    }
  }
  if (value.annotations !== undefined) {
    lines.push(`Annotations: ${value.annotations.returned} of ${value.annotations.total}`)
    for (const annotation of value.annotations.items) {
      const page = annotation.pageLabel === undefined ? '' : ` (page ${annotation.pageLabel})`
      lines.push(`  - ${annotation.ref}${page}: ${annotation.text}`)
    }
  }
  if (lines.length === 1) lines.push('No child kinds requested.')
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerChildrenTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_children',
      description: [
        'Explore the child-object graph of one Zotero item or attachment.',
        'An item ref returns its direct notes and attachments plus the annotations that live under each attachment (Zotero stores annotations as children of the PDF, not of the paper).',
        "An attachment ref returns that file's own annotations.",
        "Use it to enumerate structure before reading; zotero_get remains the tool for one object's full metadata.",
      ].join(' '),
      parameters: CHILDREN_PARAMETERS,
      output: {
        schema: CHILDREN_OUTPUT_SCHEMA,
        render: renderChildren,
        presentationMeta: (_args, value) => boundedPresentationMeta(value, []),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero children',
        rawInput: args.ref,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return (await withConnectivityAsk(ctx, exec, () =>
          service.children(buildRequest(args), exec.signal),
        )) as unknown as ChildrenOutput
      },
    }),
  )
}
