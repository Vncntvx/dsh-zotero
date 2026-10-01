/**
 * The `zotero_create_item` tool: create a bibliographic item from the closed
 * field set. No BibTeX/CSL-JSON channel exists — `POST /items` only accepts
 * Zotero item JSON — so the entry is assembled field-by-field. The
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
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeItemTypeUnsupportedMessage,
  writeNonBlankMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZoteroError,
} from '../errors.js'
import { metaRecordOf, renderDeclined } from './present.js'
import { assertNonBlank, invalid } from './validate.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import {
  ZOTERO_CREATABLE_ITEM_TYPES,
  type ZoteroCreateItemOutcome,
  type ZoteroCreateItemRequest,
} from '../types.js'

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
        itemType: { type: 'string', required: true },
        title: { type: 'string' },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['committed-unverified'], required: true },
        committed: { type: 'boolean', enum: [true], required: true },
        retryable: { type: 'boolean', enum: [false], required: true },
        reason: {
          type: 'string',
          enum: ['saved-state-unverified', 'commit-unknown'],
          required: true,
        },
        ref: { type: 'string' },
        key: { type: 'string' },
        version: { type: 'integer' },
        libraryVersion: { type: 'integer' },
        serverId: { type: 'string', required: true },
      },
    },
  ],
} as const

type CreateItemOutput = InferValue<typeof CREATE_ITEM_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function createItemPlan(args: CreateItemArgs): string {
  const lines = [
    '**Create a Zotero item**',
    '- Library: zotero://user/0 (the local personal library)',
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
  const itemType = assertNonBlank('itemType', args.itemType)
  if (!(ZOTERO_CREATABLE_ITEM_TYPES as readonly string[]).includes(itemType)) {
    invalid(writeItemTypeUnsupportedMessage(itemType))
  }
  const title = args.title?.trim() ?? ''
  const url = args.url?.trim() ?? ''
  if (title === '' && url === '') {
    throw new ZoteroError(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  const optional = (
    name: 'date' | 'doi' | 'abstractNote' | 'publicationTitle',
    value: string | undefined,
  ): string | undefined => {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (trimmed === '') invalid(writeNonBlankMessage(name))
    return trimmed
  }
  const creators = args.creators?.map((creator, index) => {
    const creatorType = creator.creatorType.trim()
    if (creatorType === '') invalid(writeNonBlankMessage(`creators[${index}].creatorType`))
    const name = creator.name?.trim() ?? ''
    const firstName = creator.firstName?.trim() ?? ''
    const lastName = creator.lastName?.trim() ?? ''
    if (name === '' && firstName === '' && lastName === '') {
      invalid(`creators[${index}] must carry a name or a firstName/lastName pair`)
    }
    return {
      creatorType,
      ...(name !== '' ? { name } : {}),
      ...(name === '' && firstName !== '' ? { firstName } : {}),
      ...(name === '' && lastName !== '' ? { lastName } : {}),
    }
  })
  return {
    itemType: itemType as ZoteroCreateItemRequest['itemType'],
    ...(title !== '' ? { title } : {}),
    ...(url !== '' ? { url } : {}),
    ...(optional('date', args.date) !== undefined ? { date: optional('date', args.date)! } : {}),
    ...(optional('doi', args.doi) !== undefined ? { doi: optional('doi', args.doi)! } : {}),
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
    const identity =
      value.key !== undefined
        ? ` (key ${value.key})`
        : value.ref !== undefined
          ? ` (ref ${value.ref})`
          : ''
    const reconciliation =
      value.key !== undefined || value.ref !== undefined
        ? 'reconcile the item by its key/ref'
        : 'reconcile by checking Zotero for the item before taking any further action'
    const text =
      value.reason === 'commit-unknown'
        ? `Zotero may have created the item${identity}, but the response did not prove the outcome. Do not retry; ${reconciliation}.`
        : `Zotero created the item${identity}, but its saved state could not be verified. Do not retry; ${reconciliation}.`
    return [{ type: 'text', text }]
  }
  const lines = [`Created ${value.itemType} item ${value.ref} (version ${value.version}).`]
  if (value.title !== undefined) lines.push(`Title: ${value.title}`)
  lines.push(
    `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
  )
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentCreateItemResult(
  _args: CreateItemArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero item: declined, nothing written' }
  }
  if (record.kind === 'committed-unverified') {
    return {
      card: 'generic',
      title:
        record.reason === 'commit-unknown'
          ? 'Zotero item outcome unknown; do not retry'
          : 'Zotero item created but not verified; do not retry',
    }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero item created${ref === '' ? '' : `: ${ref}`}` }
}

export function registerCreateItemTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_create_item',
      description:
        'Create a bibliographic item in the Zotero personal library from the closed field set (itemType plus title, url, date, doi, abstractNote, publicationTitle, creators). At least a title or a URL is required. There is no BibTeX or CSL-JSON intake: build the entry field-by-field instead. Zotero itself may show its authorization dialog on first use. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION +
        ' kind "committed-unverified" means the write must be treated as committed although its response could not be verified; do not retry, reconcile by key/ref when available.',
      parameters: CREATE_ITEM_PARAMETERS,
      output: {
        schema: CREATE_ITEM_OUTPUT_SCHEMA,
        render: renderCreateItem,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? { kind: 'applied', ref: value.ref, key: value.key, version: value.version }
            : value.kind === 'committed-unverified'
              ? {
                  kind: 'committed-unverified',
                  reason: value.reason,
                  ...(value.key === undefined ? {} : { key: value.key }),
                }
              : { kind: 'declined' },
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
