/**
 * The `zotero_get` tool: read one item's metadata, with child notes,
 * annotations, and attachments included on request. The default call is a
 * single request; any include adds one lazy `/children` request for all
 * requested kinds. Ref provenance is checked by the provider.
 * @module dsh-zotero/tools/get
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { boundedPresentationMeta, projectGetMeta } from '../presentation-meta.js'
import { formatSearchLine } from './present.js'
import { parseRef, requireLocalRef } from '../refs.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroGetRequest, ZoteroInclude } from '../types.js'

const GET_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'A zotero://user/0/item/<KEY> ref from zotero_search or a previous tool result.',
  },
  include: {
    type: 'array',
    items: { type: 'string', enum: ['notes', 'annotations', 'attachments'] },
    description:
      'Child content kinds to include. Omit for metadata only; any include adds one lazy /children request.',
  },
} as const

type GetArgs = InferArgs<typeof GET_PARAMETERS>

const NOTE_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    parentRef: { type: 'string' },
  },
} as const

const ANNOTATION_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    type: { type: 'string', required: true },
    text: { type: 'string', required: true },
    comment: { type: 'string' },
    color: { type: 'string' },
    pageLabel: { type: 'string' },
  },
} as const

const ATTACHMENT_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    contentType: { type: 'string', required: true },
    linkMode: { type: 'string' },
  },
} as const

const GET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    itemType: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: { type: 'array', required: true, items: { type: 'string' } },
    date: { type: 'string' },
    year: { type: 'integer' },
    venue: { type: 'string' },
    doi: { type: 'string' },
    url: { type: 'string' },
    abstract: { type: 'string' },
    abstractTruncated: { type: 'boolean', required: true },
    noteBody: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
      },
    },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    collections: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          name: { type: 'string' },
        },
      },
    },
    children: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { total: { type: 'integer', required: true } },
    },
    bestAttachment: ATTACHMENT_RECORD,
    notes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: NOTE_RECORD },
      },
    },
    annotations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: ANNOTATION_RECORD },
      },
    },
    attachments: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: ATTACHMENT_RECORD },
      },
    },
    version: { type: 'integer' },
    serverId: { type: 'string' },
  },
} as const

type GetOutput = InferValue<typeof GET_OUTPUT_SCHEMA>

function buildRequest(args: GetArgs): ZoteroGetRequest {
  const ref = parseRef(args.ref)
  requireLocalRef(ref, ['item'])
  return { ref, include: new Set<ZoteroInclude>(args.include ?? []) }
}

export function renderGet(_args: GetArgs, value: GetOutput): ContentBlock[] {
  const lines = [formatSearchLine(value.ref, value.title, value.year, value.itemType)]
  if (value.creators.length > 0) lines.push(`Creators: ${value.creators.join('; ')}`)
  const venueLine = [
    value.venue,
    value.date,
    value.doi === undefined ? undefined : `DOI: ${value.doi}`,
  ].filter((part): part is string => part !== undefined)
  if (venueLine.length > 0) lines.push(venueLine.join(' · '))
  if (value.url !== undefined) lines.push(`URL: ${value.url}`)
  if (value.tags.length > 0) lines.push(`Tags: ${value.tags.join(', ')}`)
  if (value.collections.length > 0) {
    lines.push(
      `Collections: ${value.collections.map((collection) => collection.name ?? collection.ref).join(', ')}`,
    )
  }
  if (value.abstract !== undefined) {
    lines.push(`Abstract${value.abstractTruncated ? ' (truncated)' : ''}: ${value.abstract}`)
  }
  if (value.noteBody !== undefined) {
    lines.push(`Note${value.noteBody.truncated ? ' (truncated)' : ''}: ${value.noteBody.text}`)
  }
  const counts = [
    value.notes === undefined ? undefined : `${value.notes.returned} of ${value.notes.total} notes`,
    value.annotations === undefined
      ? undefined
      : `${value.annotations.returned} of ${value.annotations.total} annotations`,
    value.attachments === undefined
      ? undefined
      : `${value.attachments.returned} of ${value.attachments.total} attachments`,
  ].filter((part): part is string => part !== undefined)
  lines.push(
    counts.length > 0
      ? `Children: ${value.children.total} total (${counts.join('; ')})`
      : `Children: ${value.children.total} total`,
  )
  if (value.bestAttachment !== undefined) {
    lines.push(
      `Best attachment: ${value.bestAttachment.ref} (${value.bestAttachment.contentType || 'unknown type'})`,
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerGetTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_get',
      description: [
        'Read the metadata of one Zotero library item referenced by a zotero:// ref.',
        'The default call fetches metadata only; request include to also return child notes, annotations, and attachments (one extra request covers all included kinds).',
        'When the item is a note, noteBody returns its own text (bounded by the configured budget; truncated flags the cut) — include governs child kinds only.',
        'Child notes carry parentRef, the parent item ref that produced them.',
        'Results echo the served instance in the ref, so refs can be reused safely.',
      ].join(' '),
      parameters: GET_PARAMETERS,
      output: {
        schema: GET_OUTPUT_SCHEMA,
        render: renderGet,
        presentationMeta: (_args, value) =>
          boundedPresentationMeta(projectGetMeta(value), ['notesPreview', 'annotationsPreview']),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero item',
        rawInput: args.ref,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await withConnectivityAsk(ctx, exec, () =>
          service.get(buildRequest(args), exec.signal),
        )
      },
    }),
  )
}
