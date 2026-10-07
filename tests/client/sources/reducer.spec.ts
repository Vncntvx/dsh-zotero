/**
 * The session source reducer's item-assembly rules: search episode folding,
 * the stable union of search rows and directly referenced items, the
 * evidence match verdict per instance, and the degradation of unusable input. The
 * reducer's per-call output rules live in `reducer-evidence.spec.ts` (the
 * evidence a retrieve folds in) and `reducer-outputs.spec.ts` (export
 * artifacts, attachment resolution and hint precedence, operation counters).
 * @module tests/client/sources/reducer
 */

import { describe, expect, it } from 'vitest'
import { settled, running } from '../helpers/blocks.ts'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import type { SourceScope } from '../../../src/client/sources/model.ts'
import { GET_META, REF, block } from './reducer-fixtures.ts'

/** A search projection with one row per ref. */
function searchMetaOf(
  rows: Array<{ ref: string; title?: string }>,
  omitted = 0,
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
  }
}

/**
 * The expected SearchOccurrence of one episode: defaults mirror the reducer's
 * argument normalization, so an episode created from plain `query` args
 * carries the library scope and empty filters.
 */
function searchOccurrenceOf(
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
    ...overrides,
  }
}

describe('buildSourceWorkspace', () => {
  describe('search episodes and search records', () => {
    it('falls back to the args-derived library when the meta resolves none', () => {
      // Without a resolved library in the meta, the episode's library comes
      // from the args parse: an unparseable shape degrades to the default
      // personal-library episode scope and omits the field; a well-formed
      // group id survives verbatim.
      const invalid = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention', library: { type: 'invalid', id: 'x' } },
          { meta: searchMetaOf([{ ref: REF('A1') }]) },
        ),
      ])
      expect(invalid.sources).toHaveLength(1)
      const invalidOccurrence = invalid.sources[0]?.searches[0] as unknown as Record<
        string,
        unknown
      >
      expect(invalidOccurrence.scope).toEqual({
        kind: 'library',
        library: { type: 'user', id: 0 },
      })
      expect(invalidOccurrence).not.toHaveProperty('library')

      const group = buildSourceWorkspace([
        block(
          's2',
          1,
          'zotero_search',
          { query: 'attention', library: { type: 'group', id: 5 } },
          { meta: searchMetaOf([{ ref: REF('B1') }]) },
        ),
      ])
      expect(group.sources).toHaveLength(1)
      const groupOccurrence = group.sources[0]?.searches[0] as unknown as Record<string, unknown>
      expect(groupOccurrence.library).toEqual({ type: 'group', id: 5 })
    })

    it('keeps the hits of every distinct query', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1') }]) },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'diffusion' },
          { meta: searchMetaOf([{ ref: REF('B1') }]) },
        ),
      ])
      expect(workspace.sources).toHaveLength(2)
      const first = workspace.sources.find((item) => item.key.includes('a1'))
      const second = workspace.sources.find((item) => item.key.includes('b1'))
      expect(first?.searches).toEqual([searchOccurrenceOf({ callId: 's1', query: 'attention' })])
      expect(second?.searches).toEqual([searchOccurrenceOf({ callId: 's2', query: 'diffusion' })])
    })

    it('folds pagination continuations into one logical search', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention', offset: 0 },
          { meta: searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }]) },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'attention', offset: 2 },
          { meta: searchMetaOf([{ ref: REF('A3') }]) },
        ),
      ])
      expect(workspace.sources).toHaveLength(3)
      for (const source of workspace.sources) {
        expect(source.searches).toEqual([searchOccurrenceOf({ callId: 's1', query: 'attention' })])
      }
    })

    it('splits searches when the identity changes, even for a repeated query', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1') }]) },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'diffusion' },
          { meta: searchMetaOf([{ ref: REF('B1') }]) },
        ),
        block(
          's3',
          3,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A2') }]) },
        ),
      ])
      const a1 = workspace.sources.find((item) => item.key.includes('a1'))
      const a2 = workspace.sources.find((item) => item.key.includes('a2'))
      expect(a1?.searches.map((entry) => entry.callId)).toEqual(['s1'])
      expect(a2?.searches.map((entry) => entry.callId)).toEqual(['s3'])
    })

    it('keeps degraded searches distinct and never crashes on their arguments', () => {
      const mk = (callId: string, seq: number, args: Record<string, unknown>, ref: string) =>
        block(callId, seq, 'zotero_search', args, { meta: searchMetaOf([{ ref }]) })
      const workspace = buildSourceWorkspace([
        mk('s1', 1, { query: 'attention', scope: 'x' }, REF('A1')),
        mk(
          's2',
          2,
          {
            query: 3,
            scope: { kind: 'savedSearch', refOrName: 'Inbox' },
            offset: -1,
            mode: 'everything',
          },
          REF('A2'),
        ),
        mk('s3', 3, { query: 'attention', scope: { kind: 'collection' } }, REF('A3')),
        mk(
          's4',
          4,
          { query: 'attention', scope: { kind: 'collection', refOrName: '' } },
          REF('A4'),
        ),
        mk('s5', 5, {}, REF('A5')),
        mk(
          's6',
          6,
          {
            query: 'attention',
            scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/C1' },
          },
          REF('A6'),
        ),
      ])
      expect(workspace.sources).toHaveLength(6)
      expect(workspace.sources[0]!.searches).toEqual([
        searchOccurrenceOf({ callId: 's1', query: 'attention' }),
      ])
      expect(workspace.sources[1]!.searches).toEqual([
        searchOccurrenceOf({
          callId: 's2',
          mode: 'everything',
          scope: { kind: 'savedSearch', name: 'Inbox' },
        }),
      ])
      expect(workspace.sources[4]!.searches).toEqual([searchOccurrenceOf({ callId: 's5' })])
      expect(workspace.sources[5]!.searches).toEqual([
        searchOccurrenceOf({
          callId: 's6',
          query: 'attention',
          scope: { kind: 'collection', ref: 'zotero://user/0/collection/C1' },
        }),
      ])
    })

    it('sums the omitted rows of every folded search', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1') }], 5) },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'diffusion' },
          { meta: searchMetaOf([{ ref: REF('B1') }], 3) },
        ),
      ])
      expect(workspace.omittedRows).toBe(8)
    })

    it('produces no sources from running or failed searches', () => {
      const workspace = buildSourceWorkspace([
        running({ callId: 's1', name: 'zotero_search', argsRaw: '{}' }),
        block(
          's2',
          2,
          'zotero_search',
          {},
          { isError: true, error: { name: 'ZoteroError', code: 'ZOTERO_NOT_RUNNING' } },
        ),
      ])
      expect(workspace.sources).toEqual([])
      expect(workspace.exportOperations).toEqual({ running: 0, failed: 0, stopped: 0 })
    })

    it('accepts a search whose meta carries no omission count', () => {
      const meta = searchMetaOf([{ ref: REF('A1') }])
      delete meta.omitted
      const workspace = buildSourceWorkspace([
        block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
      ])
      expect(workspace.omittedRows).toBe(0)
      expect(workspace.sources).toHaveLength(1)
    })

    it('ignores a successful search without meta', () => {
      const workspace = buildSourceWorkspace([
        block('s1', 1, 'zotero_search', { query: 'attention' }, {}),
      ])
      expect(workspace.sources).toEqual([])
    })

    it('never folds searches whose arguments are unparseable', () => {
      // Two calls whose payload merely failed to index are not the same
      // search: folding them would merge distinct queries behind one row.
      const workspace = buildSourceWorkspace([
        settled({
          callId: 's1',
          seq: 1,
          call: { name: 'zotero_search', argsRaw: '{bad-json' },
          meta: searchMetaOf([{ ref: REF('A1') }]),
        }),
        settled({
          callId: 's2',
          seq: 2,
          call: { name: 'zotero_search', argsRaw: '{bad-json' },
          meta: searchMetaOf([{ ref: REF('A2') }]),
        }),
      ])
      expect(workspace.sources).toHaveLength(2)
      expect(workspace.sources[0]!.searches.map((entry) => entry.callId)).toEqual(['s1'])
      expect(workspace.sources[1]!.searches.map((entry) => entry.callId)).toEqual(['s2'])
    })

    it('folds searches whose arguments are an equally empty payload', () => {
      // An empty payload is readable and means "no filters", so two of them
      // are one logical search — unlike a payload that failed to index.
      const workspace = buildSourceWorkspace([
        settled({
          callId: 's1',
          seq: 1,
          call: { name: 'zotero_search', argsRaw: '' },
          meta: searchMetaOf([{ ref: REF('A1') }]),
        }),
        settled({
          callId: 's2',
          seq: 2,
          call: { name: 'zotero_search', argsRaw: '' },
          meta: searchMetaOf([{ ref: REF('A2') }]),
        }),
      ])
      expect(workspace.sources).toHaveLength(2)
      for (const source of workspace.sources)
        expect(source.searches.map((entry) => entry.callId)).toEqual(['s1'])
    })

    it('distinguishes searches by itemTypes and tags, not just query and mode', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          {
            query: 'transformer',
            itemTypes: ['journalArticle'],
            tags: ['review'],
            sort: 'date',
            direction: 'desc',
          },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'T1',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
        block(
          's2',
          2,
          'zotero_search',
          {
            query: 'transformer',
            itemTypes: ['journalArticle'],
            tags: ['dataset'],
            sort: 'date',
            direction: 'asc',
          },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A2'),
                  title: 'T2',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources).toHaveLength(2)
      expect(workspace.sources[0]!.searches).toEqual([
        searchOccurrenceOf({
          callId: 's1',
          query: 'transformer',
          itemTypes: ['journalArticle'],
          tags: ['review'],
        }),
      ])
      expect(workspace.sources[1]!.searches).toEqual([
        searchOccurrenceOf({
          callId: 's2',
          query: 'transformer',
          itemTypes: ['journalArticle'],
          tags: ['dataset'],
        }),
      ])
    })

    it('normalizes non-array itemTypes and tags into empty arrays', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'x', itemTypes: 'not-array', tags: null },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'T',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources).toHaveLength(1)
    })

    it('normalizes non-string sort and direction into empty strings', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'x', sort: 1, direction: true },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'T',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources).toHaveLength(1)
    })

    it('folds searches whose tags differ only in order into one episode', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'x', tags: ['review', 'ml'] },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'T',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'x', tags: ['ml', 'review'] },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A2'),
                  title: 'T',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources).toHaveLength(2)
      expect(workspace.sources[0]!.searches).toEqual([
        searchOccurrenceOf({ callId: 's1', query: 'x', tags: ['ml', 'review'] }),
      ])
      expect(workspace.sources[1]!.searches).toEqual([
        searchOccurrenceOf({ callId: 's1', query: 'x', tags: ['ml', 'review'] }),
      ])
    })
  })

  describe('stable union and item identity', () => {
    it('unions search rows with directly referenced items without shrinking', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          {
            meta: searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }, { ref: REF('A3') }]),
          },
        ),
        block('g1', 2, 'zotero_get', { ref: REF('A2') }, { meta: GET_META }),
      ])
      expect(workspace.sources).toHaveLength(3)
      const inspected = workspace.sources.find((item) => item.key.includes('a2'))
      expect(inspected?.title).toBe('Attention Is All You Need')
    })

    it('produces title from a get, with no invented stage facts', () => {
      const workspace = buildSourceWorkspace([
        block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
      ])
      expect(workspace.sources).toHaveLength(1)
      expect(workspace.sources[0]!.facts).toEqual({
        reportedEvidenceCount: 0,
      })
      expect(workspace.sources[0]!.title).toBe('Attention Is All You Need')
    })

    it('skips a get whose arguments and projection both lack a ref', () => {
      const workspace = buildSourceWorkspace([
        settled({
          callId: 'g1',
          seq: 1,
          call: { name: 'zotero_get', argsRaw: '' },
          meta: { title: 'Only Title' },
        }),
      ])
      expect(workspace.sources).toEqual([])
    })

    it('attributes a get through the projection ref when the arguments are unusable', () => {
      const workspace = buildSourceWorkspace([
        settled({
          callId: 'g1',
          seq: 1,
          call: { name: 'zotero_get', argsRaw: '' },
          meta: { title: 'Attention Is All You Need', ref: REF('A1') },
        }),
      ])
      expect(workspace.sources).toHaveLength(1)
      expect(workspace.sources[0]!.title).toBe('Attention Is All You Need')
    })

    it('keeps the first-seen metadata and lets the get projection win outright', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1'), title: 'Search Title' }]) },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'attention', offset: 1 },
          { meta: searchMetaOf([{ ref: REF('A1'), title: 'Later Title' }]) },
        ),
        block('g1', 3, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
      ])
      expect(workspace.sources[0]!.title).toBe('Attention Is All You Need')
      expect(workspace.sources[0]!.creators).toBe('Vaswani')
      expect(workspace.sources[0]!.venue).toBe('NeurIPS')
    })

    it('inspects from a minimal get meta without inventing fields', () => {
      const workspace = buildSourceWorkspace([
        block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: { title: 'Only Title' } }),
      ])
      expect(workspace.sources[0]!.title).toBe('Only Title')
      expect(workspace.sources[0]!.creators).toBeUndefined()
      expect(workspace.sources[0]!.venue).toBeUndefined()
      expect(workspace.sources[0]!.year).toBeUndefined()
      expect(workspace.sources[0]!.bestAttachment).toBeUndefined()
    })
  })

  describe('instance match against the current instance', () => {
    it('marks one mismatch source for refs of different instances', () => {
      const blocks = [
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1', 'S1') }]) },
        ),
        block('g1', 2, 'zotero_get', { ref: REF('A1', 'S2') }, { meta: GET_META }),
      ]
      const mismatch = buildSourceWorkspace(blocks, { currentServerId: 'S1' })
      expect(mismatch.sources).toHaveLength(1)
      expect(mismatch.sources[0]!.evidenceMatch).toBe('mismatch')

      const matched = buildSourceWorkspace(
        [
          block(
            's1',
            1,
            'zotero_search',
            { query: 'attention' },
            { meta: searchMetaOf([{ ref: REF('A1', 'S1') }]) },
          ),
        ],
        { currentServerId: 'S1' },
      )
      expect(matched.sources[0]!.evidenceMatch).toBe('verified')
    })

    it('stays unknown without qualifiers or a current instance', () => {
      const blocks = [
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchMetaOf([{ ref: REF('A1') }]) },
        ),
      ]
      expect(
        buildSourceWorkspace(blocks, { currentServerId: 'S1' }).sources[0]!.evidenceMatch,
      ).toBe('unknown')
      expect(buildSourceWorkspace(blocks, {}).sources[0]!.evidenceMatch).toBe('unknown')
    })
  })

  describe('degraded and unknown input', () => {
    it('skips ref-less calls without crashing', () => {
      const workspace = buildSourceWorkspace([
        block('g1', 1, 'zotero_get', {}, {}),
        block('e1', 2, 'zotero_export', { refs: 3 }, {}),
        block('r1', 3, 'zotero_retrieve', {}, {}),
        block('a1', 4, 'zotero_attachment', {}, {}),
      ])
      expect(workspace.sources).toEqual([])
      expect(workspace.exports).toEqual([])
    })

    it('degrades malformed meta to no facts without crashing', () => {
      const workspace = buildSourceWorkspace([
        block('s1', 1, 'zotero_search', { query: 'attention' }, { meta: { items: 'x' } }),
        block('g1', 2, 'zotero_get', { ref: REF('A1') }, { meta: {} }),
        block('g2', 3, 'zotero_get', { ref: REF('A2') }, {}),
      ])
      expect(workspace.sources).toHaveLength(2)
      expect(workspace.sources.every((item) => item.title === undefined)).toBe(true)
    })

    it('ignores unknown tool names and handles the empty slice', () => {
      expect(buildSourceWorkspace([])).toEqual({
        sources: [],
        exports: [],
        exportOperations: { running: 0, failed: 0, stopped: 0 },
        omittedRows: 0,
      })
      const workspace = buildSourceWorkspace([block('x1', 1, 'other_tool', {}, {})])
      expect(workspace.sources).toEqual([])
    })
  })
})
