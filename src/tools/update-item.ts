/**
 * The `zotero_update_item` tool updates scalar metadata or native PDF
 * annotation fields under a version precondition.
 * @module dsh-zotero/tools/update-item
 */

import type { Context } from '@deepseek-ai/cordis'
import { planValue } from '../write-plan.js'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { defineZoteroTool as defineTool } from '../define-tool.js'
import { renderDeclined } from './present.js'
import {
  APPLIED_ENVELOPE_PROPERTIES,
  COMMITTED_UNVERIFIED_VARIANT,
  DECLINED_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentUpdateResultView,
  renderCommittedUnverified,
  unverifiedPresentationMeta,
} from '../write-present.js'
import { parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js'
import { validateItemUpdateFields } from '../write-item-rules.js'
import { normalizeAnnotationTagChanges } from '../local/write-domain.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import { assertWritePayload } from '../write-bounds.js'
import type { ZoteroUpdateItemOutcome, ZoteroUpdateItemRequest } from '../types.js'

export const UPDATE_ITEM_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref whose metadata changes.`,
  },
  expectedVersion: {
    type: 'integer',
    description: 'Required for annotations.',
  },
  tagChanges: {
    type: 'object',
    additionalProperties: false,
    properties: {
      add: { type: 'array', items: { type: 'string' } },
      remove: { type: 'array', items: { type: 'string' } },
    },
    description: 'Annotation tag names to add or remove.',
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
      annotationComment: { type: 'string' },
      annotationColor: { type: 'string' },
      annotationPageLabel: { type: 'string' },
      annotationType: { type: 'string', enum: ['highlight', 'underline'] },
    },
    description:
      'Fields for the target kind. Color is #rrggbb. Empty comment or page label clears it.',
  },
} as const

type UpdateItemArgs = InferArgs<typeof UPDATE_ITEM_PARAMETERS>

const UPDATE_ITEM_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    COMMITTED_UNVERIFIED_VARIANT,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...APPLIED_ENVELOPE_PROPERTIES,
        changed: { type: 'array', items: { type: 'string' }, required: true },
        unchanged: { type: 'boolean' },
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
    WRITE_PLAN_LIBRARY_LINE,
    `- Item: ${planValue(args.ref)}`,
    ...(args.expectedVersion === undefined ? [] : [`- Expected version: ${args.expectedVersion}`]),
    ...entries.map(([field, value]) => `- ${planValue(field)}: ${planValue(value.trim())}`),
    ...(args.tagChanges?.add ?? []).map((tag) => `- Add tag: ${planValue(tag.trim())}`),
    ...(args.tagChanges?.remove ?? []).map((tag) => `- Remove tag: ${planValue(tag.trim())}`),
    'Each field must be valid for the item type; an invalid field refuses the write before any PATCH.',
  ].join('\n')
}

function buildRequest(args: UpdateItemArgs): ZoteroUpdateItemRequest {
  const item = parseWritableRef(args.ref, ['item', 'annotation'])
  const tagChanges = normalizeAnnotationTagChanges(args.tagChanges, item.kind === 'annotation')
  const updates = validateItemUpdateFields(
    args.set,
    item.kind === 'annotation',
    args.expectedVersion,
    tagChanges !== undefined,
  )
  return {
    item,
    expectedVersion: args.expectedVersion,
    set: Object.fromEntries(updates),
    ...(tagChanges === undefined ? {} : { tagChanges }),
  }
}

export function renderUpdateItem(_args: UpdateItemArgs, value: UpdateItemOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined(value)
  }
  if (value.kind === 'committed-unverified')
    return renderCommittedUnverified(value, 'item', 'committed')
  if (value.unchanged)
    return [
      {
        type: 'text',
        text: `Already satisfied: ${value.ref} (version ${value.version}); no fields changed.`,
      },
    ]
  return [
    {
      type: 'text',
      text: [
        `Updated ${value.ref} (version ${value.version}); changed ${value.changed.join(', ')}.`,
        ...(value.libraryVersion === undefined
          ? []
          : [libraryVersionLine({ ...value, libraryVersion: value.libraryVersion })]),
      ].join('\n'),
    },
  ]
}

function presentUpdateItemResult(
  _args: UpdateItemArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentUpdateResultView('item', result)
}

export function registerUpdateItemTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_update_item',
      description:
        'Edit item metadata or a native highlight or underline. Item fields follow zotero_browse itemFields. ' +
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
                ...(value.unchanged ? { unchanged: true } : {}),
                changedCount: value.changed.length,
              }
            : value.kind === 'committed-unverified'
              ? unverifiedPresentationMeta(value)
              : { ...value },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero item',
        rawInput: args.ref,
      }),
      presentResult: presentUpdateItemResult,
      async execute(args, exec): Promise<ZoteroUpdateItemOutcome> {
        assertWritePayload(args, service.config.writeFieldMaxChars)
        const request = buildRequest(args)
        return await service.updateItem(request, { exec, plan: updateItemPlan(args) })
      },
    }),
  )
}
