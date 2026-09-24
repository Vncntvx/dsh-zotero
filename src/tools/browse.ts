/**
 * The `zotero_browse` tool: library discovery without assuming structure.
 * Model-facing bounded listing for libraries, collections, saved searches, tags, itemTypes.
 * All library resolution follows canonical SupportedLocalLibrary identity.
 * @module dsh-zotero/tools/browse
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
import { boundedPresentationMeta } from '../presentation-meta.js'
import { metaRecordOf } from './present.js'
import { asRecord } from '../json.js'
import { assertIntInRange, assertNonBlank, invalid, parseLibrary } from './validate.js'
import {
  ITEM_FIELDS_ITEM_TYPE_MESSAGE,
  ITEM_TYPE_SCOPE_MESSAGE,
  MATCH_REQUIRES_Q_MESSAGE,
  PARENT_REF_SCOPE_MESSAGE,
  Q_MATCH_SCOPE_MESSAGE,
  libraryNotAllowedMessage,
  unsupportedBrowseKindMessage,
} from '../local/browse-domain.js'
import type { ZoteroService } from '../service.js'
import type { SupportedLocalLibrary, ZoteroBrowseKind, ZoteroBrowseRequest } from '../types.js'

const BROWSE_KINDS: readonly ZoteroBrowseKind[] = [
  'libraries',
  'collections',
  'savedSearches',
  'tags',
  'itemTypes',
  'itemFields',
]

const BROWSE_PARAMETERS = {
  kind: {
    type: 'string',
    enum: [...BROWSE_KINDS],
    required: true,
    description:
      'What to browse: libraries, collections, savedSearches, tags, itemTypes, itemFields (itemFields requires itemType)',
  },
  library: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['user', 'group'], required: true },
      id: { type: 'integer', required: true },
    },
    description:
      'Library for collections/savedSearches/tags; omitted defaults to personal user/0. Not allowed for libraries/itemTypes/itemFields (fail-closed).',
  },
  parentRef: {
    type: 'string',
    description:
      'Collections only: a zotero://.../collection/<KEY> ref whose children to list. Omit to list top-level collections.',
  },
  tagScope: {
    type: 'string',
    enum: ['library', 'collection', 'publications'],
    description:
      'Tags only: count tags over this item set. Omit for the whole-library tag list; collection/publications use the scoped tag endpoints.',
  },
  tagCollection: {
    type: 'string',
    description:
      'Tags only with tagScope="collection": a collection ref or exact name whose items the tag counts describe.',
  },
  itemLevel: {
    type: 'string',
    enum: ['top', 'all'],
    description:
      'Tags only with a scope: top counts bibliographic items (default), all includes child items.',
  },
  itemQuery: {
    type: 'string',
    description:
      'Tags only with a scope: count only tags of items matching this query — the facet-discovery move after a search.',
  },
  itemQueryMode: {
    type: 'string',
    enum: ['titleCreatorYear', 'everything'],
    description: 'Tags only with itemQuery: how itemQuery matches (default titleCreatorYear).',
  },
  itemType: {
    type: 'string',
    description:
      'ItemFields only: the Zotero item type whose valid fields and creator types to list (e.g. dataset, patent).',
  },
  q: {
    type: 'string',
    description: 'Filter for tags kind (substring); only valid when kind="tags"',
  },
  match: {
    type: 'string',
    enum: ['contains', 'startsWith'],
    description: 'How q matches tags; only valid when kind="tags"; default contains',
  },
  offset: { type: 'integer', default: 0, description: 'Pagination offset' },
  limit: {
    type: 'integer',
    default: 20,
    description: 'Max items to return; capped by maxBrowseResults',
  },
} as const

type BrowseArgs = InferArgs<typeof BROWSE_PARAMETERS>

const BROWSE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    library: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', required: true },
        id: { type: 'integer', required: true },
      },
    },
    serverId: { type: 'string' },
    // Each kind lists its own row shape, so the model can rely on
    // collections carrying path/depth/parentRef, tags carrying count, and
    // saved searches carrying conditions straight from the schema.
    items: {
      type: 'array',
      required: true,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              library: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  type: { type: 'string', enum: ['user', 'group'], required: true },
                  id: { type: 'integer', required: true },
                },
              },
              name: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              name: { type: 'string', required: true },
              parentRef: { type: 'string' },
              path: { type: 'array', required: true, items: { type: 'string' } },
              depth: { type: 'integer', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              name: { type: 'string', required: true },
              conditions: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              tag: { type: 'string', required: true },
              count: { type: 'integer' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              itemType: { type: 'string', required: true },
              localized: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string', required: true },
              localized: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              creatorType: { type: 'string', required: true },
              localized: { type: 'string' },
            },
          },
        ],
      },
    },
    total: { type: 'integer', required: true },
    offset: { type: 'integer', required: true },
    returned: { type: 'integer', required: true },
    nextOffset: { type: 'integer' },
  },
} as const

type BrowseOutput = InferValue<typeof BROWSE_OUTPUT_SCHEMA>

/**
 * The tag-facet messages are this layer's own wording: they name the
 * model-facing arguments (`tagScope`), while the domain's counterpart names
 * the request field it validates (`SCOPE_FACET_KIND_MESSAGE`, `scope`).
 */
export const TAG_FACET_SCOPE_MESSAGE =
  'tagScope/itemLevel/itemQuery are only valid when kind="tags"'
export const TAG_COLLECTION_SCOPE_MESSAGE = 'tagCollection requires tagScope="collection"'
export const TAG_SCOPE_COLLECTION_MESSAGE =
  'tagScope="collection" requires tagCollection (a zotero:// ref or a collection name)'
export const ITEM_LEVEL_SCOPE_MESSAGE =
  'itemLevel/itemQuery require tagScope (library, collection, or publications)'
export const ITEM_QUERY_MODE_MESSAGE = 'itemQueryMode requires itemQuery'

function buildRequest(args: BrowseArgs, config: { maxBrowseResults: number }): ZoteroBrowseRequest {
  const kind = args.kind as ZoteroBrowseKind
  if (!BROWSE_KINDS.includes(kind)) invalid(unsupportedBrowseKindMessage(kind))
  const offset = args.offset ?? 0
  const limit = args.limit ?? 20
  assertIntInRange('offset', offset, 0, 1_000_000)
  assertIntInRange('limit', limit, 1, config.maxBrowseResults)
  const library = parseLibrary(args.library)
  // Fail-closed: libraries/itemTypes/itemFields are global; library param is not allowed
  if (
    (kind === 'libraries' || kind === 'itemTypes' || kind === 'itemFields') &&
    library !== undefined
  ) {
    invalid(libraryNotAllowedMessage(kind))
  }
  const itemType = args.itemType
  if (itemType !== undefined && kind !== 'itemFields') {
    invalid(ITEM_TYPE_SCOPE_MESSAGE)
  }
  if (kind === 'itemFields') {
    if (itemType === undefined || !/^[A-Za-z][A-Za-z0-9]*$/.test(itemType)) {
      invalid(ITEM_FIELDS_ITEM_TYPE_MESSAGE)
    }
  }
  const q = args.q
  const match = args.match
  if ((q !== undefined || match !== undefined) && kind !== 'tags') {
    invalid(Q_MATCH_SCOPE_MESSAGE)
  }
  if (match !== undefined && q === undefined) {
    invalid(MATCH_REQUIRES_Q_MESSAGE)
  }
  const query = q === undefined ? undefined : assertNonBlank('q', q)
  const parentRef = args.parentRef
  if (parentRef !== undefined && kind !== 'collections') {
    invalid(PARENT_REF_SCOPE_MESSAGE)
  }
  const tagScope = args.tagScope
  const tagCollection = args.tagCollection
  const itemLevel = args.itemLevel
  const itemQuery = args.itemQuery
  const itemQueryMode = args.itemQueryMode
  if (
    (tagScope !== undefined ||
      itemLevel !== undefined ||
      itemQuery !== undefined ||
      itemQueryMode !== undefined) &&
    kind !== 'tags'
  ) {
    invalid(TAG_FACET_SCOPE_MESSAGE)
  }
  if (tagCollection !== undefined && tagScope !== 'collection') {
    invalid(TAG_COLLECTION_SCOPE_MESSAGE)
  }
  if (tagScope === 'collection' && tagCollection === undefined) {
    invalid(TAG_SCOPE_COLLECTION_MESSAGE)
  }
  const collection =
    tagCollection === undefined ? undefined : assertNonBlank('tagCollection', tagCollection)
  if ((itemLevel !== undefined || itemQuery !== undefined) && tagScope === undefined) {
    invalid(ITEM_LEVEL_SCOPE_MESSAGE)
  }
  if (itemQueryMode !== undefined && itemQuery === undefined) {
    invalid(ITEM_QUERY_MODE_MESSAGE)
  }
  const facetedQuery = itemQuery === undefined ? undefined : assertNonBlank('itemQuery', itemQuery)
  const scope =
    tagScope === undefined
      ? undefined
      : tagScope === 'collection'
        ? { kind: 'collection' as const, refOrName: collection! }
        : { kind: tagScope as 'library' | 'publications' }
  return {
    kind,
    ...(library ? { library } : {}),
    ...(parentRef !== undefined ? { parentRef } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(itemLevel !== undefined ? { itemLevel } : {}),
    ...(facetedQuery !== undefined ? { itemQuery: facetedQuery } : {}),
    ...(itemQueryMode !== undefined ? { itemQueryMode } : {}),
    ...(itemType !== undefined ? { itemType } : {}),
    ...(query !== undefined ? { q: query } : {}),
    ...(match !== undefined ? { match } : {}),
    offset,
    limit,
  }
}

/** The page announcement: the offset the next call should pass. */
export function browseMoreMessage(nextOffset: number): string {
  return `More: browse again with offset ${nextOffset}`
}

export function renderBrowse(_args: BrowseArgs, value: BrowseOutput): ContentBlock[] {
  const lines = [`${value.kind}: ${value.returned} of ${value.total}`]
  const items = value.items as Array<Record<string, unknown>>
  items.forEach((it, idx) => {
    const n = idx + 1
    if (asRecord(it.library) !== undefined) {
      const lib = asRecord(it.library)!
      const libId = `${lib.type}/${lib.id}`
      const name = (it.name as string | undefined) ?? libId
      lines.push(`${n}. ${name} — ${libId}`)
      lines.push(`   library=${libId}`)
    } else if (Array.isArray(it.path)) {
      // Collections: the full breadcrumb is the useful line, not just the leaf name.
      const breadcrumb = (it.path as unknown[]).map(String).join(' / ')
      const ref = (it.ref as string | undefined) ?? ''
      lines.push(`${n}. ${breadcrumb}${ref ? ` — ${ref}` : ''}`)
    } else if (typeof it.tag === 'string') {
      const count = typeof it.count === 'number' ? ` — ${it.count} items` : ''
      lines.push(`${n}. ${it.tag}${count}`)
    } else if (typeof it.itemType === 'string') {
      const localized = typeof it.localized === 'string' ? ` (${it.localized})` : ''
      lines.push(`${n}. ${it.itemType}${localized}`)
    } else if (typeof it.field === 'string') {
      const localized = typeof it.localized === 'string' ? ` (${it.localized})` : ''
      lines.push(`${n}. field ${it.field}${localized}`)
    } else if (typeof it.creatorType === 'string') {
      const localized = typeof it.localized === 'string' ? ` (${it.localized})` : ''
      lines.push(`${n}. creatorType ${it.creatorType}${localized}`)
    } else {
      const conditions = Array.isArray(it.conditions) ? ` — ${it.conditions.length} conditions` : ''
      const name =
        (it.name as string | undefined) ?? (it.ref as string | undefined) ?? JSON.stringify(it)
      const ref = (it.ref as string | undefined) ?? ''
      lines.push(`${n}. ${name}${conditions}${ref ? ` — ${ref}` : ''}`)
    }
  })
  if (value.nextOffset !== undefined) lines.push(browseMoreMessage(value.nextOffset))
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The completed browse card: the browsed kind plus the page facts. `meta`
 * is absent on nested code dispatch or malformed replay records, and a failed
 * call keeps the raw error content — both fall back to the generic card.
 */
function presentBrowseResult(_args: BrowseArgs, result: ToolResult): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (typeof record.kind !== 'string' || record.kind === '') return undefined
  if (typeof record.returned !== 'number' || typeof record.total !== 'number') return undefined
  return {
    card: 'generic',
    title: `Zotero browse: ${record.kind} (${record.returned} of ${record.total})`,
  }
}

export function registerBrowseTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_browse',
      description: [
        'Browse Zotero library structure. Use libraries to discover personal/group libraries,',
        'collections/savedSearches/tags per library, itemTypes globally, itemFields with an itemType for its valid fields/creator types.',
        'Collections navigate the tree: omit parentRef for top-level, pass a collection ref to list its children.',
        'Tags accept a scope plus itemQuery for faceted discovery (which tags do my search hits carry?).',
        'Always offset/limit paginated; use for discovery before search/get.',
      ].join(' '),
      parameters: BROWSE_PARAMETERS,
      output: {
        schema: BROWSE_OUTPUT_SCHEMA,
        render: renderBrowse,
        presentationMeta: (_args, value) => boundedPresentationMeta(value, ['items']),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'search',
        title: `Browse Zotero ${args.kind}`,
        rawInput: args.kind,
      }),
      presentResult: presentBrowseResult,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await withConnectivityAsk(ctx, service.recovery, exec, () =>
          service.browse(buildRequest(args, service.config), exec.signal),
        )
      },
    }),
  )
}
