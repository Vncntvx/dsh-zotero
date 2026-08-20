/**
 * The `zotero_browse` tool: library discovery without assuming structure.
 * Model-facing bounded listing for libraries, collections, saved searches, tags, itemTypes.
 * All library resolution follows canonical SupportedLocalLibrary identity.
 * @module dsh-zotero/tools/browse
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { boundedPresentationMeta } from '../presentation-meta.js'
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../errors.js'
import { asRecord } from '../json.js'
import { assertIntInRange } from './validate.js'
import type { ZoteroService } from '../service.js'
import type { SupportedLocalLibrary, ZoteroBrowseKind, ZoteroBrowseRequest } from '../types.js'

const BROWSE_KINDS: readonly ZoteroBrowseKind[] = [
  'libraries',
  'collections',
  'savedSearches',
  'tags',
  'itemTypes',
]

const BROWSE_PARAMETERS = {
  kind: {
    type: 'string',
    enum: [...BROWSE_KINDS],
    required: true,
    description: 'What to browse: libraries, collections, savedSearches, tags, itemTypes',
  },
  library: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['user', 'group'], required: true },
      id: { type: 'integer', required: true },
    },
    description:
      'Library for collections/savedSearches/tags; omitted defaults to personal user/0. Not allowed for libraries/itemTypes (fail-closed).',
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
    items: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
    total: { type: 'integer', required: true },
    offset: { type: 'integer', required: true },
    returned: { type: 'integer', required: true },
    nextOffset: { type: 'integer' },
  },
} as const

type BrowseOutput = InferValue<typeof BROWSE_OUTPUT_SCHEMA>

export { assertIntInRange }

export function parseLibrary(value: unknown): SupportedLocalLibrary | undefined {
  if (value === undefined || value === null) return undefined
  const rec = value as Record<string, unknown>
  const type = rec.type
  const id = rec.id
  if (type !== 'user' && type !== 'group')
    throw new ZoteroError('library.type must be user or group', ZOTERO_INVALID_ARGUMENT)
  if (!Number.isInteger(id))
    throw new ZoteroError('library.id must be integer', ZOTERO_INVALID_ARGUMENT)
  if (type === 'user' && id !== 0)
    throw new ZoteroError('Only user/0 is supported for personal library', ZOTERO_INVALID_ARGUMENT)
  if (type === 'group' && (id as number) <= 0)
    throw new ZoteroError('group id must be positive integer', ZOTERO_INVALID_ARGUMENT)
  return { type: type as SupportedLocalLibrary['type'], id: id as number } as SupportedLocalLibrary
}

export function buildRequest(
  args: BrowseArgs,
  config: { maxBrowseResults: number },
): ZoteroBrowseRequest {
  const kind = args.kind as ZoteroBrowseKind
  if (!BROWSE_KINDS.includes(kind))
    throw new ZoteroError(`Unsupported browse kind ${kind}`, ZOTERO_INVALID_ARGUMENT)
  const offset = args.offset ?? 0
  const limit = args.limit ?? 20
  assertIntInRange('offset', offset, 0, 1_000_000)
  assertIntInRange('limit', limit, 1, config.maxBrowseResults)
  const library = parseLibrary((args as Record<string, unknown>).library)
  // Fail-closed: libraries/itemTypes are global; library param is not allowed
  if ((kind === 'libraries' || kind === 'itemTypes') && library !== undefined) {
    throw new ZoteroError(
      `library is not allowed for kind ${kind}; omit library for libraries/itemTypes`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const q = (args as Record<string, unknown>).q as string | undefined
  const match = (args as Record<string, unknown>).match as 'contains' | 'startsWith' | undefined
  if ((q !== undefined || match !== undefined) && kind !== 'tags') {
    throw new ZoteroError('q/match are only valid when kind="tags"', ZOTERO_INVALID_ARGUMENT)
  }
  if (match !== undefined && q === undefined) {
    throw new ZoteroError('match requires q', ZOTERO_INVALID_ARGUMENT)
  }
  return {
    kind,
    ...(library ? { library } : {}),
    ...(q !== undefined ? { q } : {}),
    ...(match !== undefined ? { match } : {}),
    offset,
    limit,
  }
}

export function renderBrowse(_args: BrowseArgs, value: BrowseOutput): ContentBlock[] {
  const lines = [`${value.kind}: ${value.returned} of ${value.total}`]
  const items = value.items as Array<Record<string, unknown>>
  items.forEach((it, idx) => {
    if (value.kind === 'libraries' && asRecord(it.library) !== undefined) {
      const lib = asRecord(it.library)!
      const libId = `${lib.type}/${lib.id}`
      const name = (it.name as string | undefined) ?? libId
      lines.push(`${idx + 1}. ${name} — ${libId}`)
      lines.push(`   library=${libId}`)
    } else {
      const name = (it.name ?? it.tag ?? it.itemType ?? it.ref ?? JSON.stringify(it)) as string
      const ref = (it.ref as string | undefined) ?? ''
      lines.push(`${idx + 1}. ${name}${ref ? ` — ${ref}` : ''}`)
    }
  })
  if (value.nextOffset !== undefined)
    lines.push(`More: browse again with offset ${value.nextOffset}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerBrowseTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_browse',
      description: [
        'Browse Zotero library structure. Use libraries to discover personal/group libraries,',
        'collections/savedSearches/tags per library, itemTypes globally. Always offset/limit paginated; use for discovery before search/get.',
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
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return (await withConnectivityAsk(ctx, exec, () =>
          service.browse(buildRequest(args as BrowseArgs, service.config), exec.signal),
        )) as unknown as BrowseOutput
      },
    }),
  )
}
