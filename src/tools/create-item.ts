/**
 * The `zotero_create_item` tool: create a bibliographic item from the closed
 * field set. No BibTeX/CSL-JSON channel exists: `POST /items` only accepts
 * Zotero item JSON, so the entry is assembled field by field. The
 * plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/create-item
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
import {
  normalizeCreator,
  requireCreatableItemType,
  requireTitleOrUrl,
} from '../write-item-rules.js'
import { renderDeclined } from './present.js'
import {
  COMMITTED_UNVERIFIED_VARIANT,
  createWritePresentationMeta,
  DECLINED_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentCreateResultView,
  renderCommittedUnverified,
} from './write-present.js'
import { assertNonBlank } from './validate.js'
import {
  WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
  WRITE_PLAN_OUTCOME_DESCRIPTION,
  WRITE_PLAN_LIBRARY_LINE,
} from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroCreateItemOutcome, ZoteroCreateItemRequest } from '../types.js'

const CREATE_ITEM_PARAMETERS = {
  itemType: {
    type: 'string',
    required: true,
    description:
      'The Zotero item type: webpage, journalArticle, book, conferencePaper, report, thesis, document, or preprint.',
  },
  title: { type: 'string', description: 'The item title. At least a title or a URL is required.' },
  url: { type: 'string', description: 'The item URL. At least a title or a URL is required.' },
  date: { type: 'string', description: 'The publication date, as Zotero stores it.' },
  doi: { type: 'string', description: 'The DOI (stored as DOI).' },
  abstractNote: { type: 'string', description: 'The abstract.' },
  publicationTitle: { type: 'string', description: 'The venue (journal, proceedings, site).' },
  creators: {
    type: 'array',
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
    description:
      'Creators, each with a creatorType and either a name or a firstName/lastName pair.',
  },
} as const

type CreateItemArgs = InferArgs<typeof CREATE_ITEM_PARAMETERS>

const CREATE_ITEM_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: { type: 'string', required: true },
        key: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        itemType: { type: 'string', required: true },
        title: { type: 'string' },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
    COMMITTED_UNVERIFIED_VARIANT,
  ],
} as const

type CreateItemOutput = InferValue<typeof CREATE_ITEM_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function createItemPlan(args: CreateItemArgs): string {
  const lines = [
    '**Create a Zotero item**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Type: ${(args.itemType as string).trim()}`,
    `- Title: ${args.title === undefined ? '(none)' : args.title.trim()}`,
    `- URL: ${args.url === undefined ? '(none)' : args.url.trim()}`,
  ]
  if (args.date !== undefined) lines.push(`- Date: ${args.date.trim()}`)
  if (args.doi !== undefined) lines.push(`- DOI: ${args.doi.trim()}`)
  if (args.publicationTitle !== undefined) lines.push(`- Venue: ${args.publicationTitle.trim()}`)
  if (args.creators !== undefined && args.creators.length > 0) {
    lines.push(`- Creators: ${args.creators.length} listed`)
  }
  lines.push('Only the closed field set is stored; no BibTeX or CSL-JSON channel exists.')
  return lines.join('\n')
}

function buildRequest(args: CreateItemArgs): ZoteroCreateItemRequest {
  const itemType = requireCreatableItemType(assertNonBlank('itemType', args.itemType))
  const title = args.title?.trim() ?? ''
  const url = args.url?.trim() ?? ''
  requireTitleOrUrl(title, url)
  const creators = args.creators?.map((creator, index) => normalizeCreator(creator, index))
  return {
    itemType: itemType as ZoteroCreateItemRequest['itemType'],
    ...(title !== '' ? { title } : {}),
    ...(url !== '' ? { url } : {}),
    ...(args.date !== undefined ? { date: assertNonBlank('date', args.date) } : {}),
    ...(args.doi !== undefined ? { doi: assertNonBlank('doi', args.doi) } : {}),
    ...(args.abstractNote !== undefined
      ? { abstractNote: assertNonBlank('abstractNote', args.abstractNote) }
      : {}),
    ...(args.publicationTitle !== undefined
      ? { publicationTitle: assertNonBlank('publicationTitle', args.publicationTitle) }
      : {}),
    ...(creators !== undefined && creators.length > 0 ? { creators } : {}),
  }
}

export function renderCreateItem(_args: CreateItemArgs, value: CreateItemOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  if (value.kind === 'committed-unverified') {
    return renderCommittedUnverified(value, 'item', 'created')
  }
  const lines = [`Created ${value.itemType} item ${value.ref} (version ${value.version}).`]
  if (value.title !== undefined) lines.push(`Title: ${value.title}`)
  lines.push(libraryVersionLine(value))
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentCreateItemResult(
  _args: CreateItemArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentCreateResultView('item', 'created', result)
}

export function registerCreateItemTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_create_item',
      description:
        'Create a bibliographic item in the Zotero personal library from the closed field set (itemType plus title, url, date, doi, abstractNote, publicationTitle, creators). At least a title or a URL is required. There is no BibTeX or CSL-JSON intake: build the entry field-by-field instead. Zotero itself may show its authorization dialog on first use. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION +
        WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
      parameters: CREATE_ITEM_PARAMETERS,
      output: {
        schema: CREATE_ITEM_OUTPUT_SCHEMA,
        render: renderCreateItem,
        presentationMeta: (_args, value): JsonValue => createWritePresentationMeta(value),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Create Zotero item',
        rawInput: args.title ?? args.url ?? args.itemType,
      }),
      presentResult: presentCreateItemResult,
      async execute(args, exec): Promise<ZoteroCreateItemOutcome> {
        const request = buildRequest(args)
        return await service.createItem(request, { exec, plan: createItemPlan(args) })
      },
    }),
  )
}
