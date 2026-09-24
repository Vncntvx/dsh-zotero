/**
 * The `zotero_children` tool: explore the Zotero object graph. An item ref
 * yields direct notes/attachments from bare `/children` plus, when
 * requested, annotations under the item via `/children?itemType=annotation`;
 * an attachment ref yields its own annotations through that filtered
 * listing. Counterpart to `zotero_get` (one object's detail) — use it when
 * the model needs to walk structure rather than read metadata.
 * @module dsh-zotero/tools/children
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { asRecord } from '../json.js'
import { boundedPresentationMeta } from '../presentation-meta.js'
import { ANNOTATION_RECORD, ATTACHMENT_RECORD, NOTE_RECORD } from './child-records.js'
import { metaRecordOf } from './present.js'
import { assertNonEmptyList, parseSupportedRef } from './validate.js'
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
      'Child kinds to return; omitted returns all three. Direct notes/attachments come from bare /children; annotations from /children?itemType=annotation (Zotero stores them under PDF attachments, and a bare listing never returns them). Attachment refs yield their annotations via that filtered read.',
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
          items: NOTE_RECORD,
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
          items: ANNOTATION_RECORD,
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
          items: ATTACHMENT_RECORD,
        },
      },
    },
  },
} as const

type ChildrenOutput = InferValue<typeof CHILDREN_OUTPUT_SCHEMA>

/** The model-facing message for an explicit empty include list. */
export const CHILDREN_INCLUDE_EMPTY_MESSAGE =
  'include must list at least one child kind when provided'

/** The model-facing message for a call that asked for no child kind. */
export const CHILDREN_NONE_REQUESTED_MESSAGE = 'No child kinds requested.'

function buildRequest(args: ChildrenArgs): ZoteroChildrenRequest {
  const ref = parseSupportedRef(args.ref, ['item', 'attachment'])
  if (args.include !== undefined) {
    assertNonEmptyList(args.include, CHILDREN_INCLUDE_EMPTY_MESSAGE)
  }
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
  if (lines.length === 1) lines.push(CHILDREN_NONE_REQUESTED_MESSAGE)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The completed children card: per-kind totals for the sections the call
 * returned. `meta` is absent on nested code dispatch or malformed replay
 * records, and a failed call keeps the raw error content — both fall back to
 * the generic card.
 */
function presentChildrenResult(
  _args: ChildrenArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  const parts: string[] = []
  for (const key of ['notes', 'attachments', 'annotations'] as const) {
    const total = asRecord(record[key])?.total
    if (typeof total !== 'number') continue
    parts.push(`${total} ${key}`)
  }
  if (parts.length === 0) return undefined
  return { card: 'generic', title: `Zotero children: ${parts.join(', ')}` }
}

export function registerChildrenTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_children',
      description: [
        'Explore the child-object graph of one Zotero item or attachment.',
        'An item ref returns direct notes and attachments from bare /children, plus annotations under the item via /children?itemType=annotation when requested (Zotero stores annotations as children of the PDF, not of the paper; a bare listing never returns them).',
        "An attachment ref returns that file's own annotations through the same filtered listing.",
        "Use it to enumerate structure before reading; zotero_get remains the tool for one object's full metadata.",
      ].join(' '),
      parameters: CHILDREN_PARAMETERS,
      output: {
        schema: CHILDREN_OUTPUT_SCHEMA,
        render: renderChildren,
        presentationMeta: (_args, value) =>
          boundedPresentationMeta(value, ['notes', 'attachments', 'annotations']),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero children',
        rawInput: args.ref,
      }),
      presentResult: presentChildrenResult,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await withConnectivityAsk(ctx, service.recovery, exec, () =>
          service.children(buildRequest(args), exec.signal),
        )
      },
    }),
  )
}
