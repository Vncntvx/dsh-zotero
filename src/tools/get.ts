/**
 * The `zotero_get` tool: read one item's metadata, with child notes,
 * annotations, and attachments included on request. The default call is a
 * single request; a notes or attachments include reads the bare `/children`
 * listing, and an annotations include adds the `?itemType=annotation`
 * listing, because the Local API never returns annotations from the bare children
 * endpoint, so an annotations-only include reads no bare listing. Ref
 * provenance is checked by the provider.
 * @module dsh-zotero/tools/get
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
import { boundedPresentationMeta, projectGetMeta } from '../presentation-meta.js'
import {
  ANNOTATION_RECORD,
  ATTACHMENT_RECORD,
  NOTE_RECORD,
  LOCATION_RECORD,
  CHILD_PAGE_FIELDS,
} from './child-records.js'
import { formatSearchLine, metaRecordOf } from './present.js'
import { formatCreatorsList } from '../creators.js'
import { parseSupportedRef } from '../refs.js'
import { REF_ARG_HINT } from './validate.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroGetRequest, ZoteroInclude } from '../types.js'

const PAGE_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    offset: { type: 'integer', required: true },
    limit: { type: 'integer', required: true },
  },
} as const

const GET_PARAMETERS = {
  locations: {
    type: 'string',
    enum: ['none', 'best', 'included'],
    description:
      'none (default): metadata only. best: resolve target attachment or item best attachment. included: resolve only returned attachments; requires include attachments and an item ref.',
  },
  childPages: {
    type: 'object',
    additionalProperties: false,
    properties: { notes: PAGE_PARAMETER, annotations: PAGE_PARAMETER, attachments: PAGE_PARAMETER },
    description:
      'Optional independent windows (offset >= 0, limit 1–100). Omitted kinds read all requested children and their full normalized bodies.',
  },
  ref: {
    type: 'string',
    required: true,
    description: `A ${REF_ARG_HINT} item or attachment ref (zotero://user/0/item/<KEY> or zotero://user/0/attachment/<KEY>).`,
  },
  include: {
    type: 'array',
    items: { type: 'string', enum: ['notes', 'annotations', 'attachments'] },
    description:
      'Child content kinds to include. Omit for metadata only. For items, notes/attachments read direct children; annotations read under PDF attachments. For attachments, annotations read its annotations. Locations are resolved only when explicitly requested.',
  },
  fields: {
    type: 'string',
    enum: ['standard', 'all'],
    description:
      'standard (default) returns the normalized model; all additionally returns extraFields, which is every data field the model does not consume (repository, archive, number-of-pages, …), so special item types keep their metadata.',
  },
} as const

type GetArgs = InferArgs<typeof GET_PARAMETERS>

const GET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location: LOCATION_RECORD,
    ref: { type: 'string', required: true },
    itemType: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          creatorType: { type: 'string', required: true },
          name: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
    },
    extra: { type: 'string' },
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
        ...CHILD_PAGE_FIELDS,
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: NOTE_RECORD },
      },
    },
    annotations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        ...CHILD_PAGE_FIELDS,
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: ANNOTATION_RECORD },
      },
    },
    attachments: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true },
        ...CHILD_PAGE_FIELDS,
        returned: { type: 'integer', required: true },
        items: { type: 'array', required: true, items: ATTACHMENT_RECORD },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          predicate: { type: 'string', required: true },
          targetUri: { type: 'string', required: true },
          targetRef: { type: 'string' },
        },
      },
    },
    version: { type: 'integer' },
    serverId: { type: 'string' },
    extraFields: { type: 'object', additionalProperties: true },
    path: { type: 'string' },
    contentType: { type: 'string' },
  },
} as const

type GetOutput = InferValue<typeof GET_OUTPUT_SCHEMA>

function buildRequest(args: GetArgs): ZoteroGetRequest {
  const ref = parseSupportedRef(args.ref, ['item', 'attachment'])
  return {
    ref,
    include: new Set<ZoteroInclude>(args.include ?? []),
    ...(args.locations !== undefined ? { locations: args.locations } : {}),
    ...(args.childPages !== undefined ? { childPages: args.childPages } : {}),
    ...(args.fields !== undefined ? { fields: args.fields } : {}),
  }
}

export const FILE_ENVIRONMENT_MESSAGE =
  'File environment: the machine running Zotero (this plugin only reaches a loopback API, so that is this machine). A reader elsewhere (a sandbox, a container, a remote host) may not see this path.'

export function renderGet(_args: GetArgs, value: GetOutput): ContentBlock[] {
  const lines = [formatSearchLine(value.ref, value.title, value.year, value.itemType)]
  const creators = formatCreatorsList(value.creators)
  if (creators !== '') {
    lines.push(`Creators: ${creators}`)
  }
  if (value.contentType !== undefined && value.itemType === 'attachment') {
    lines.push(`Content type: ${value.contentType}`)
  }
  if (value.location?.kind === 'unavailable')
    lines.push(`Location unavailable: ${value.location.reason}`)
  if (value.location?.kind === 'url') lines.push(`Resolved location: ${value.location.url}`)
  if (value.path !== undefined) {
    lines.push(`Path: ${value.path}`)
    lines.push(FILE_ENVIRONMENT_MESSAGE)
  }
  if (value.extra !== undefined) lines.push(`Extra: ${value.extra}`)
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
    const loc = value.bestAttachment.path
      ? ` → ${value.bestAttachment.path}`
      : value.bestAttachment.url
        ? ` → ${value.bestAttachment.url}`
        : ''
    lines.push(
      `Best attachment: ${value.bestAttachment.ref} (${value.bestAttachment.contentType || 'unknown type'})${loc}`,
    )
  }
  if (value.attachments !== undefined) {
    for (const att of value.attachments.items) {
      const loc = att.path ? ` → ${att.path}` : att.url ? ` → ${att.url}` : ''
      lines.push(`  - Attachment: ${att.ref}: ${att.title} (${att.contentType || 'unknown'})${loc}`)
    }
  }
  if (value.annotations !== undefined) {
    for (const ann of value.annotations.items) {
      const page = ann.pageLabel ? ` (page ${ann.pageLabel})` : ''
      lines.push(
        `  - Annotation: ${ann.ref}${page}: ${ann.text}${ann.comment ? ` [Comment: ${ann.comment}]` : ''}`,
      )
    }
  }
  if (value.notes !== undefined) {
    for (const note of value.notes.items) {
      lines.push(`  - Note: ${note.ref}: ${note.text}`)
    }
  }
  if (value.relations !== undefined && value.relations.length > 0) {
    lines.push(
      `Relations: ${value.relations.map((r) => `${r.predicate} -> ${r.targetRef ?? r.targetUri}`).join(', ')}`,
    )
  }
  if (value.extraFields !== undefined) {
    const entries = Object.entries(value.extraFields).filter(([, v]) => v !== undefined)
    if (entries.length > 0) {
      lines.push(
        `Additional fields: ${entries.map(([key, val]) => `${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`).join('; ')}`,
      )
    }
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The completed item card: the item title plus its year when known. `meta`
 * is absent on nested code dispatch or malformed replay records, and a failed
 * call keeps the raw error content; both fall back to the generic card.
 */
function presentGetResult(_args: GetArgs, result: ToolResult): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (typeof record.title !== 'string' || record.title === '') return undefined
  if (record.itemType === 'attachment') {
    return { card: 'generic', title: `Zotero attachment: ${record.title}` }
  }
  const year = typeof record.year === 'number' ? ` (${record.year})` : ''
  return { card: 'generic', title: `Zotero item: ${record.title}${year}` }
}

export function registerGetTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_get',
      description: [
        'Read the metadata of one Zotero library item or attachment referenced by a zotero:// ref.',
        'The default call fetches metadata only; request include to also return child notes, annotations, and attachments (full normalized bodies unless childPages specifies a window).',
        'When the target is an attachment, returns metadata and optionally annotations; locations best explicitly resolves a file path or URL.',
        'When the item is a note, noteBody returns its full normalized text. include governs child kinds only.',
        'Child notes carry parentRef, the parent item ref that produced them.',
        'Results echo the served instance in the ref, so refs can be reused safely.',
      ].join(' '),
      parameters: GET_PARAMETERS,
      output: {
        schema: GET_OUTPUT_SCHEMA,
        render: renderGet,
        presentationMeta: (_args, value) =>
          boundedPresentationMeta(projectGetMeta(value), [
            'notesPreview',
            'annotationsPreview',
            'relations',
          ]),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: args.ref.includes('/attachment/') ? 'Read Zotero attachment' : 'Read Zotero item',
        rawInput: args.ref,
      }),
      presentResult: presentGetResult,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.get(buildRequest(args), exec.signal)
      },
    }),
  )
}
