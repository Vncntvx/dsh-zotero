/**
 * The fixtures the `buildSourceWorkspace` specs share: the ref builder, the
 * settled tool-call block with JSON arguments, the canonical get projection
 * every spec asserts against, and the search projection / episode occurrence
 * builders both `reducer.spec.ts` and `reducer-scopes.spec.ts` walk. What two
 * or more of the reducer specs use lives here; single-spec projections (the
 * retrieve projection) stay with the one spec that reads them.
 * @module tests/client/sources/reducer-fixtures
 */

import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SourceScope } from '../../../src/client/sources/model.ts'
import { settled } from '../helpers/blocks.ts'
import { CANONICAL_ATTACHMENT_REF, CANONICAL_ITEM_REF } from '../helpers/toolview-fixtures.ts'

/** One item/attachment/annotation ref in the specs' spelling. */
export const REF = (key: string, serverId?: string): string =>
  `zotero://user/0/item/${key}${serverId === undefined ? '' : `?server=${serverId}`}`

/** One settled zotero tool result whose arguments are the JSON of `args`. */
export function block(
  callId: string,
  seq: number,
  name: string,
  args: Record<string, unknown>,
  extra: Partial<ToolResultNode> = {},
): ToolResultNode {
  return settled({ callId, seq, call: { name, argsRaw: JSON.stringify(args) }, ...extra })
}

/** The get projection with every field the specs assert on. */
export const GET_META = {
  title: 'Attention Is All You Need',
  creators: 'Vaswani',
  year: 2017,
  venue: 'NeurIPS',
  itemType: 'journalArticle',
  notesPreview: [],
  annotationsPreview: [],
}

/** The search projection one real `zotero_search` returns for one hit. */
export const CANONICAL_SEARCH_META = {
  returned: 1,
  total: 1,
  displayed: 1,
  omitted: 0,
  items: [
    {
      ref: CANONICAL_ITEM_REF,
      title: 'Proactive resource request for disaster response',
      creatorSummary: 'Zhang 等',
      year: 2024,
      itemType: 'journalArticle',
      bestAttachmentRef: CANONICAL_ATTACHMENT_REF,
      bestAttachmentType: 'application/pdf',
    },
  ],
  scope: { kind: 'library', library: { type: 'user', id: 0 } },
  library: { type: 'user', id: 0 },
}

/**
 * A search projection with one row per ref. `resolved` carries the meta's
 * scope-resolution fields (`scope`, `library`), which only the scope specs
 * assert on; leaving it empty keeps the projection args-shaped.
 */
export function searchMetaOf(
  rows: Array<{ ref: string; title?: string }>,
  omitted = 0,
  resolved: { scope?: Record<string, unknown>; library?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    returned: rows.length,
    total: rows.length,
    nextOffset: null,
    displayed: rows.length,
    omitted,
    noteMatches: null,
    items: rows.map(({ ref, title }) => ({
      ref,
      title: title ?? `Paper ${ref.slice(-1)}`,
      creatorSummary: 'Creator',
      year: 2020,
      itemType: 'journalArticle',
    })),
    ...resolved,
  }
}

/**
 * The expected SearchOccurrence of one episode: defaults mirror the reducer's
 * argument normalization, so an episode created from plain `query` args
 * carries the library scope, empty filters, and one returned row of a
 * one-hit total. A spec asserting an unreported count reads the field
 * directly instead: this builder always states a total.
 */
export function searchOccurrenceOf(
  overrides: Partial<{
    callId: string
    query?: string
    mode: 'metadata' | 'everything'
    scope: SourceScope
    library?: { type: 'user' | 'group'; id: number }
    itemTypes: string[]
    tags: string[]
    tagMatch?: 'all' | 'any'
    excludeTags?: string[]
    includeTrashed?: boolean
    returned: number
    total: number
    noteMatches: number
  }> = {},
): Record<string, unknown> {
  return {
    callId: 's1',
    mode: 'metadata',
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    itemTypes: [],
    tags: [],
    tagMatch: 'all',
    excludeTags: [],
    includeTrashed: false,
    returned: 1,
    total: 1,
    ...overrides,
  }
}
