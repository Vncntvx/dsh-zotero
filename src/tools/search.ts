/**
 * The `zotero_search` tool: discover candidates in the user's library with
 * Zotero's own quick search. Output stays compact — refs, titles, creators,
 * years, and Zotero's best-attachment hint — so the Agent can escalate to
 * `zotero_get`/`zotero_retrieve` with stable refs.
 * @module dsh-zotero/tools/search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type JsonValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import { ZOTERO_SORT_FIELDS } from '../constants.js'
import type { ResolvedConfig } from '../config.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroSearchRequest } from '../types.js'

const SEARCH_PARAMETERS = {
  query: { type: 'string', description: 'Free-text query; omit to browse the scope unfiltered.' },
  mode: {
    type: 'string',
    enum: ['metadata', 'everything'],
    default: 'metadata',
    description: 'metadata: title/creator/year only; everything: also indexed full text.',
  },
  scope: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { type: 'string', const: 'library', required: true } },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'collection', required: true },
          refOrName: {
            type: 'string',
            required: true,
            description: 'Collection name or zotero://user/0/collection/<KEY> ref.',
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'savedSearch', required: true },
          refOrName: {
            type: 'string',
            required: true,
            description: 'Saved search name or zotero://user/0/search/<KEY> ref.',
          },
        },
      },
    ],
    default: { kind: 'library' },
    description: 'Where to search. Defaults to the whole library.',
  },
  itemTypes: {
    type: 'array',
    items: { type: 'string' },
    description: 'Zotero item type names (e.g. journalArticle), combined with OR.',
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Literal tag names; items must have ALL of them.',
  },
  sort: {
    type: 'string',
    enum: [...ZOTERO_SORT_FIELDS],
    default: 'dateModified',
    description: 'Result order field.',
  },
  direction: {
    type: 'string',
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Result order direction.',
  },
  offset: {
    type: 'integer',
    default: 0,
    description: 'Pagination offset for exploring more results.',
  },
  limit: {
    type: 'integer',
    default: 10,
    description: 'Maximum results to return; capped by the configured maxSearchResults.',
  },
} as const

type SearchArgs = InferArgs<typeof SEARCH_PARAMETERS>

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: {
      required: true,
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { type: 'string', const: 'library', required: true } },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'collection', required: true },
            ref: { type: 'string', required: true },
            name: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'savedSearch', required: true },
            ref: { type: 'string', required: true },
            name: { type: 'string', required: true },
          },
        },
      ],
    },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          title: { type: 'string', required: true },
          creatorSummary: { type: 'string', required: true },
          year: { type: 'integer' },
          itemType: { type: 'string', required: true },
          parentRef: { type: 'string' },
          bestAttachmentRef: { type: 'string' },
          bestAttachmentType: { type: 'string' },
          attachmentSize: { type: 'integer' },
        },
      },
    },
    total: { type: 'integer', required: true },
    offset: { type: 'integer', required: true },
    returned: { type: 'integer', required: true },
    nextOffset: { type: 'integer' },
  },
} as const

type SearchOutput = InferValue<typeof SEARCH_OUTPUT_SCHEMA>

function invalid(message: string): never {
  throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT)
}

function buildRequest(args: SearchArgs, config: ResolvedConfig): ZoteroSearchRequest {
  const limit = args.limit ?? 10
  if (!Number.isInteger(limit) || limit < 1 || limit > config.maxSearchResults) {
    invalid(`limit must be an integer between 1 and ${config.maxSearchResults}; got ${limit}`)
  }
  const offset = args.offset ?? 0
  if (!Number.isInteger(offset) || offset < 0)
    invalid(`offset must be a non-negative integer; got ${offset}`)
  const query = args.query?.trim()
  const scope = args.scope ?? { kind: 'library' }
  if (scope.kind !== 'library' && scope.refOrName.trim() === '') {
    invalid('scope.refOrName must be a collection/saved-search name or ref')
  }
  for (const tag of args.tags ?? []) {
    if (tag.trim() === '' || tag.includes('||')) {
      invalid(
        `tags are literal tag names (AND semantics); got an empty or "||"-containing tag: "${tag}"`,
      )
    }
  }
  for (const itemType of args.itemTypes ?? []) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(itemType)) {
      invalid(`itemTypes are positive Zotero item type names joined with OR; got "${itemType}"`)
    }
  }
  return {
    query: query === '' ? undefined : query,
    mode: args.mode ?? 'metadata',
    scope:
      scope.kind === 'library'
        ? { kind: 'library' }
        : { kind: scope.kind, refOrName: scope.refOrName },
    itemTypes: args.itemTypes,
    tags: args.tags,
    sort: args.sort ?? 'dateModified',
    direction: args.direction ?? 'desc',
    offset,
    limit,
  }
}

export function renderSearch(_args: SearchArgs, value: SearchOutput): ContentBlock[] {
  const lines = [`Found ${value.returned} of ${value.total} results:`]
  value.items.forEach((item, index) => {
    const year = item.year === undefined ? '' : ` (${item.year})`
    const creator = item.creatorSummary === '' ? '' : ` — ${item.creatorSummary}`
    const pdf = item.bestAttachmentType === 'application/pdf' ? ' — PDF' : ''
    lines.push(
      `${index + 1}. ${item.ref} — ${item.title}${year} [${item.itemType}]${creator}${pdf}`,
    )
  })
  if (value.nextOffset !== undefined) {
    lines.push(
      `More results available: search again with offset ${value.nextOffset} and the same scope ref.`,
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** Replayable projection of the page facts a completed card title needs. */
function searchPresentationMeta(_args: SearchArgs, value: SearchOutput): JsonValue {
  return { returned: value.returned, total: value.total, nextOffset: value.nextOffset ?? null }
}

/**
 * The completed search card: a compact page summary. `meta` is absent on
 * nested code dispatch or malformed replay records, and a failed call keeps
 * the raw error content — both fall back to the generic card.
 */
function presentSearchResult(_args: SearchArgs, result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const record = meta as Record<string, unknown>
  if (typeof record.returned !== 'number' || typeof record.total !== 'number') return undefined
  return {
    card: 'generic',
    title: `Zotero search: found ${record.returned} of ${record.total} results`,
  }
}

export function registerSearchTool(
  ctx: Context,
  service: ZoteroService,
  config: ResolvedConfig,
): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_search',
      description: [
        "Search the user's local Zotero research library for candidate papers.",
        'metadata mode matches titles, creators, and years; everything mode also searches indexed full text.',
        "scope restricts the search to a collection or a Zotero saved search by name or zotero:// ref; additional filters combine with a saved search's own conditions.",
        'Results carry stable zotero:// refs for zotero_get/zotero_retrieve, and a scope ref for pagination via offset.',
      ].join(' '),
      parameters: SEARCH_PARAMETERS,
      output: {
        schema: SEARCH_OUTPUT_SCHEMA,
        render: renderSearch,
        presentationMeta: searchPresentationMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'search',
        title: 'Search Zotero library',
        rawInput: args.query ?? '(browse)',
      }),
      presentResult: presentSearchResult,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.search(buildRequest(args, config), exec.signal)
      },
    }),
  )
}
