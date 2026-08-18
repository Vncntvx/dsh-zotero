/**
 * The session source reducer: stable union, provable facts only, operation
 * separation, dedup, provenance, and malformed-meta degradation.
 * @module tests/client/sources/reducer
 */

import { describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { settled, running } from '../helpers/blocks.ts'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import type { SourceScope } from '../../../src/client/sources/model.ts'

const REF = (key: string, serverId?: string): string =>
  `zotero://user/0/item/${key}${serverId === undefined ? '' : `?server=${serverId}`}`

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

function block(
  callId: string,
  seq: number,
  name: string,
  args: Record<string, unknown>,
  extra: Partial<ToolResultNode> = {},
): ToolResultNode {
  return settled({ callId, seq, call: { name, argsRaw: JSON.stringify(args) }, ...extra })
}

/**
 * The expected SearchProvenance of one episode: defaults mirror the reducer's
 * argument normalization, so an episode created from plain `query` args
 * carries the library scope and empty filters.
 */
function provenanceOf(
  overrides: Partial<{
    callId: string
    query?: string
    mode: 'metadata' | 'everything'
    scope: SourceScope
    itemTypes: string[]
    tags: string[]
  }> = {},
): Record<string, unknown> {
  return {
    callId: 's1',
    mode: 'metadata',
    scope: { kind: 'library' },
    itemTypes: [],
    tags: [],
    ...overrides,
  }
}

const GET_META = {
  title: 'Attention Is All You Need',
  creators: 'Vaswani',
  year: 2017,
  venue: 'NeurIPS',
  itemType: 'journalArticle',
  notesPreview: [],
  annotationsPreview: [],
}

const RETRIEVE_META = {
  count: 1,
  sources: ['annotation'],
  truncated: false,
  sourcesSkipped: [],
  items: [
    {
      source: 'annotation',
      sourceRef: 'zotero://user/0/annotation/ANN1',
      preview: 'the claim',
      previewTruncated: false,
      pageLabel: '7',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
    },
  ],
  attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
  coverage: { indexedPages: 5, totalPages: 10, complete: false },
  sourceAvailability: { annotation: { requested: true, returnedPassages: 1, unavailable: false } },
}

describe('buildSourceWorkspace', () => {
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
    expect(inspected?.facts.inspected).toBe(true)
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
    expect(first?.searches).toEqual([provenanceOf({ callId: 's1', query: 'attention' })])
    expect(second?.searches).toEqual([provenanceOf({ callId: 's2', query: 'diffusion' })])
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
      expect(source.searches).toEqual([provenanceOf({ callId: 's1', query: 'attention' })])
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
      mk('s4', 4, { query: 'attention', scope: { kind: 'collection', refOrName: '' } }, REF('A4')),
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
      provenanceOf({ callId: 's1', query: 'attention' }),
    ])
    expect(workspace.sources[1]!.searches).toEqual([
      provenanceOf({
        callId: 's2',
        mode: 'everything',
        scope: { kind: 'savedSearch', name: 'Inbox' },
      }),
    ])
    expect(workspace.sources[4]!.searches).toEqual([provenanceOf({ callId: 's5' })])
    expect(workspace.sources[5]!.searches).toEqual([
      provenanceOf({
        callId: 's6',
        query: 'attention',
        scope: { kind: 'collection', ref: 'zotero://user/0/collection/C1' },
      }),
    ])
  })

  it('produces only inspected from a get, with no invented stage facts', () => {
    const workspace = buildSourceWorkspace([
      block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts).toEqual({
      inspected: true,
      evidenceCount: 0,
      reportedEvidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    })
    expect(workspace.sources[0]!.title).toBe('Attention Is All You Need')
  })

  it('skips a get whose arguments and projection both lack a ref', () => {
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 'g1',
        seq: 1,
        call: { name: 'zotero_get', argsRaw: '' },
        meta: { title: 'Only Title' },
      },
    ])
    expect(workspace.sources).toEqual([])
  })

  it('skips an export with neither projection refs nor usable arguments', () => {
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 'e1',
        seq: 1,
        call: { name: 'zotero_export', argsRaw: '' },
      },
    ])
    expect(workspace.sources).toEqual([])
    expect(workspace.exports).toEqual([])
  })

  it('attributes a get through the projection ref when the arguments are unusable', () => {
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 'g1',
        seq: 1,
        call: { name: 'zotero_get', argsRaw: '' },
        meta: { title: 'Attention Is All You Need', ref: REF('A1') },
      },
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts.inspected).toBe(true)
  })

  it('produces evidence facts from retrieve and never export facts', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
    ])
    expect(workspace.sources[0]!.facts).toMatchObject({ evidenceCount: 1, exportCount: 0 })
    expect(workspace.exports).toEqual([])
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
      indexedPages: 5,
      totalPages: 10,
      complete: false,
    })
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789',
    )
    expect(workspace.sources[0]!.evidence[0]!.attachmentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789',
    )
  })

  it('summarizes retrieves with a run count, the latest event time, and the budget', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META, time: 1000 }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            ...RETRIEVE_META,
            count: 2,
            items: [
              ...RETRIEVE_META.items,
              {
                source: 'annotation',
                sourceRef: 'zotero://user/0/annotation/ANN2',
                preview: 'another claim',
                previewTruncated: false,
              },
            ],
            truncated: true,
          },
          time: 2000,
        },
      ),
    ])
    const summary = workspace.sources[0]!.retrievalSummary
    expect(summary).toEqual({
      runCount: 2,
      latestCallId: 'r2',
      latestRetrievedAt: 2000,
      keptPassageCount: 2,
      reportedPassageCount: 3,
      truncated: true,
    })
  })

  it('counts a repeated retrieve call id as one run', () => {
    // The same call id replayed (a duplicated block in the slice) must not
    // inflate the run count; the evidence merge still refreshes counters.
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      block('r1', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
    ])
    expect(workspace.sources[0]!.retrievalSummary?.runCount).toBe(1)
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
  })

  it('counts each successful retrieve once even when its meta arrives late', () => {
    const workspace = buildSourceWorkspace([
      block(
        'r1',
        1,
        'zotero_retrieve',
        { ref: REF('A1') },
        { meta: { count: 1, items: null, truncated: false } },
      ),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        { meta: { count: 1, items: null, truncated: false } },
      ),
    ])
    expect(workspace.sources[0]!.retrievalSummary?.runCount).toBe(2)
  })

  it('keeps retrievalSummary off an item with no successful retrieve', () => {
    const workspace = buildSourceWorkspace([
      block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
    ])
    expect(workspace.sources[0]!.retrievalSummary).toBeUndefined()
  })

  it('counts running calls as operations and never as facts', () => {
    const workspace = buildSourceWorkspace([
      running({ callId: 'g1', name: 'zotero_get', argsRaw: JSON.stringify({ ref: REF('A1') }) }),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts).toEqual({
      inspected: false,
      evidenceCount: 0,
      reportedEvidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    })
    expect(workspace.sources[0]!.operations).toEqual({ running: 1, failed: 0, stopped: 0 })
  })

  it('counts failed and stopped calls in operations, never as achievements', () => {
    const workspace = buildSourceWorkspace([
      block(
        'g1',
        1,
        'zotero_get',
        { ref: REF('A1') },
        { isError: true, error: { name: 'ZoteroError', code: 'ZOTERO_NOT_FOUND' } },
      ),
      block(
        'r1',
        2,
        'zotero_retrieve',
        { ref: REF('A2') },
        { isError: true, error: { name: 'Interrupted', code: 'interrupted' } },
      ),
    ])
    const failed = workspace.sources.find((item) => item.key.includes('a1'))
    const stopped = workspace.sources.find((item) => item.key.includes('a2'))
    expect(failed?.operations).toEqual({ running: 0, failed: 1, stopped: 0 })
    expect(failed?.facts.inspected).toBe(false)
    expect(stopped?.operations).toEqual({ running: 0, failed: 0, stopped: 1 })
  })

  it('creates an export artifact and exportCount only from a successful call', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1'), REF('A2')], format: 'bibtex' },
        {
          meta: { format: 'bibtex', requested: 2, refs: [REF('A1'), REF('A2')], refsOmitted: 0 },
          content: [{ type: 'text', text: '@article{a1}' }],
        },
      ),
    ])
    expect(workspace.exports).toHaveLength(1)
    expect(workspace.exports[0]).toMatchObject({
      callId: 'e1',
      format: 'bibtex',
      refs: [REF('A1'), REF('A2')],
      refsOmitted: 0,
      text: '@article{a1}',
    })
    expect(workspace.sources).toHaveLength(2)
    for (const source of workspace.sources) {
      expect(source.facts.exportCount).toBe(1)
      expect(source.exports).toEqual([workspace.exports[0]])
    }
  })

  it('carries the per-document items of a translator export onto the artifact', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1')], format: 'bibtex' },
        {
          meta: {
            format: 'bibtex',
            requested: 1,
            refs: [REF('A1')],
            refsOmitted: 0,
            items: [{ ref: REF('A1'), key: 'a1', title: 'Alpha' }],
          },
          content: [{ type: 'text', text: '@article{a1}' }],
        },
      ),
    ])
    expect(workspace.exports[0]!.items).toEqual([{ ref: REF('A1'), key: 'a1', title: 'Alpha' }])
  })

  it('drops malformed item rows while decoding the rest', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1'), REF('A2')], format: 'bibtex' },
        {
          meta: {
            format: 'bibtex',
            requested: 2,
            refs: [REF('A1'), REF('A2')],
            refsOmitted: 0,
            items: [
              { ref: REF('A1'), key: 'a1' },
              { key: 'no-ref' },
              'junk',
              { ref: REF('A2'), key: 7 },
            ],
          },
          content: [{ type: 'text', text: '@article{a1}\n@article{a2}' }],
        },
      ),
    ])
    expect(workspace.exports[0]!.items).toEqual([{ ref: REF('A1'), key: 'a1' }, { ref: REF('A2') }])
  })

  it('keeps artifacts item-less when the projection carries no items', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1')], format: 'bibtex' },
        {
          meta: { format: 'bibtex', requested: 1, refs: [REF('A1')], refsOmitted: 0 },
          content: [{ type: 'text', text: '@article{a1}' }],
        },
      ),
    ])
    expect(workspace.exports[0]!).not.toHaveProperty('items')
  })

  it('counts a duplicated ref once per artifact', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1'), REF('A1')] },
        {
          meta: { format: 'citation', refs: [REF('A1'), REF('A1')], refsOmitted: 0 },
          content: [{ type: 'text', text: 'x' }],
        },
      ),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts.exportCount).toBe(1)
  })

  it('creates no artifact from running, failed, stopped, or text-less exports', () => {
    const workspace = buildSourceWorkspace([
      running({
        callId: 'e1',
        name: 'zotero_export',
        argsRaw: JSON.stringify({ refs: [REF('A1')] }),
      }),
      block(
        'e2',
        2,
        'zotero_export',
        { refs: [REF('A2')] },
        { isError: true, error: { name: 'ZoteroError', code: 'ZOTERO_OUTPUT_TOO_LARGE' } },
      ),
      block('e3', 3, 'zotero_export', { refs: [REF('A3')] }, { content: [] }),
      block(
        'e4',
        4,
        'zotero_export',
        { refs: [REF('A4')] },
        { isError: true, error: { name: 'Interrupted', code: 'interrupted' } },
      ),
    ])
    expect(workspace.exports).toEqual([])
    expect(workspace.exportOperations).toEqual({ running: 1, failed: 1, stopped: 1 })
    const a1 = workspace.sources.find((item) => item.key.includes('a1'))
    const a2 = workspace.sources.find((item) => item.key.includes('a2'))
    expect(a1?.operations.running).toBe(1)
    expect(a1?.facts.exportCount).toBe(0)
    expect(a2?.operations.failed).toBe(1)
    expect(a2?.facts.exportCount).toBe(0)
  })

  it('deduplicates verbatim evidence and keeps every call id', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.evidence).toHaveLength(1)
    expect(workspace.sources[0]!.evidence[0]!.callIds).toEqual(['r1', 'r2'])
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
  })

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
    expect(workspace.sources.every((item) => item.facts.inspected === false)).toBe(true)
  })

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
    expect(mismatch.sources[0]!.provenance).toBe('mismatch')

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
    expect(matched.sources[0]!.provenance).toBe('verified')
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
    expect(buildSourceWorkspace(blocks, { currentServerId: 'S1' }).sources[0]!.provenance).toBe(
      'unknown',
    )
    expect(buildSourceWorkspace(blocks, {}).sources[0]!.provenance).toBe('unknown')
  })

  it('decodes meta without the availability facts', () => {
    const workspace = buildSourceWorkspace([
      block(
        's1',
        1,
        'zotero_search',
        { query: 'attention' },
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
                title: 'Paper A1',
                creatorSummary: 'Creator',
                year: 2020,
                itemType: 'journalArticle',
              },
            ],
          },
        },
      ),
      block(
        'r1',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 2,
            sources: ['annotation', 'fulltext'],
            truncated: false,
            sourcesSkipped: ['note'],
            items: [
              {
                source: 'annotation',
                sourceRef: 'zotero://user/0/annotation/ANN1',
                preview: 'a',
                previewTruncated: false,
              },
              {
                source: 'fulltext',
                sourceRef: REF('A1'),
                preview: 'b',
                previewTruncated: false,
              },
            ],
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(2)
    expect(workspace.sources[0]!.retrievalFacts?.sourceAvailability).toEqual({})
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toBeUndefined()
  })

  it('attributes an export through its meta refs even with unparseable arguments', () => {
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 'e1',
        seq: 1,
        call: { name: 'zotero_export', argsRaw: '' },
        meta: { format: 'ris', requested: 1, refs: [REF('A1')] },
        content: [{ type: 'text', text: 'TY - JOUR' }],
      },
    ])
    expect(workspace.exports[0]!.refs).toEqual([REF('A1')])
    expect(workspace.exports[0]!.refsOmitted).toBe(0)
    expect(workspace.sources).toHaveLength(1)
  })

  it('falls back to the argument refs when the meta carries none', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1')] },
        { meta: { format: 'bibtex' }, content: [{ type: 'text', text: 'x' }] },
      ),
    ])
    expect(workspace.exports[0]!.refs).toEqual([REF('A1')])
    expect(workspace.exports[0]!.refsOmitted).toBe(0)
  })

  it('resolves an attachment location only from a successful call', () => {
    const workspace = buildSourceWorkspace([
      block(
        'a1',
        1,
        'zotero_attachment',
        { ref: REF('A1') },
        {
          meta: {
            kind: 'file',
            title: 'a.pdf',
            contentType: 'application/pdf',
            ref: 'zotero://user/0/attachment/WXYZ6789',
            path: '/tmp/a.pdf',
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.facts.attachmentResolved).toBe(true)
    expect(workspace.sources[0]!.attachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      kind: 'file',
      contentType: 'application/pdf',
      title: 'a.pdf',
      location: '/tmp/a.pdf',
    })
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

  it('accepts a search whose meta carries no omission count', () => {
    const meta = searchMetaOf([{ ref: REF('A1') }])
    delete meta.omitted
    const workspace = buildSourceWorkspace([
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    ])
    expect(workspace.omittedRows).toBe(0)
    expect(workspace.sources).toHaveLength(1)
  })

  it('adopts the attachment selection a get reports', () => {
    const workspace = buildSourceWorkspace([
      block(
        'g1',
        1,
        'zotero_get',
        { ref: REF('A1') },
        {
          meta: {
            title: 'T',
            bestAttachment: {
              ref: 'zotero://user/0/attachment/WXYZ6789',
              contentType: 'application/pdf',
            },
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
  })

  it('ignores an attachment without meta or without a usable arm', () => {
    const workspace = buildSourceWorkspace([
      block('a1', 1, 'zotero_attachment', { ref: REF('A1') }, {}),
      block('a2', 2, 'zotero_attachment', { ref: REF('A2') }, { meta: { kind: 'other' } }),
    ])
    expect(workspace.sources).toHaveLength(2)
    expect(workspace.sources.every((item) => item.facts.attachmentResolved === false)).toBe(true)
  })

  it('ignores a successful search without meta', () => {
    const workspace = buildSourceWorkspace([
      block('s1', 1, 'zotero_search', { query: 'attention' }, {}),
    ])
    expect(workspace.sources).toEqual([])
  })

  it('never folds searches whose arguments are unparseable', () => {
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 's1',
        seq: 1,
        call: { name: 'zotero_search', argsRaw: '' },
        meta: searchMetaOf([{ ref: REF('A1') }]),
      },
      {
        ...settled(),
        callId: 's2',
        seq: 2,
        call: { name: 'zotero_search', argsRaw: '' },
        meta: searchMetaOf([{ ref: REF('A2') }]),
      },
    ])
    expect(workspace.sources).toHaveLength(2)
    expect(workspace.sources[0]!.searches.map((entry) => entry.callId)).toEqual(['s1'])
    expect(workspace.sources[1]!.searches.map((entry) => entry.callId)).toEqual(['s2'])
  })

  it('inspects from a minimal get meta without inventing fields', () => {
    const workspace = buildSourceWorkspace([
      block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: { title: 'Only Title' } }),
    ])
    expect(workspace.sources[0]!.facts.inspected).toBe(true)
    expect(workspace.sources[0]!.title).toBe('Only Title')
    expect(workspace.sources[0]!.creators).toBeUndefined()
    expect(workspace.sources[0]!.venue).toBeUndefined()
    expect(workspace.sources[0]!.year).toBeUndefined()
    expect(workspace.sources[0]!.bestAttachment).toBeUndefined()
  })

  it('ignores a retrieve whose items are malformed', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: { items: 'x' } }),
    ])
    expect(workspace.sources[0]!.retrievalFacts).toBeUndefined()
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(0)
  })

  it('resolves a degraded attachment without a title, location, or ref', () => {
    const workspace = buildSourceWorkspace([
      block(
        'a1',
        1,
        'zotero_attachment',
        { ref: REF('A1') },
        { meta: { kind: 'url', contentType: 'text/html' } },
      ),
    ])
    expect(workspace.sources[0]!.facts.attachmentResolved).toBe(true)
    expect(workspace.sources[0]!.attachment).toEqual({
      kind: 'url',
      contentType: 'text/html',
      title: '',
      location: '',
    })
  })

  it('keeps the style and locale facts on an artifact', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1')] },
        {
          meta: {
            format: 'bibliography',
            style: 'apa',
            locale: 'en-US',
            refs: [REF('A1')],
            refsOmitted: 0,
          },
          content: [{ type: 'text', text: 'bib' }],
        },
      ),
    ])
    expect(workspace.exports[0]).toMatchObject({ style: 'apa', locale: 'en-US' })
  })

  it('still records the artifact text when the meta is absent', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('A1')] },
        { content: [{ type: 'text', text: 'raw' }] },
      ),
    ])
    expect(workspace.exports[0]).toMatchObject({ format: '', refsOmitted: 0, text: 'raw' })
  })

  it('creates no sources from a running export with unusable arguments', () => {
    const workspace = buildSourceWorkspace([
      running({ callId: 'e1', name: 'zotero_export', argsRaw: '{}' }),
    ])
    expect(workspace.sources).toEqual([])
    expect(workspace.exportOperations).toEqual({ running: 1, failed: 0, stopped: 0 })
  })

  it('lets the latest retrieve facts win', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: true,
            sourcesSkipped: ['fulltext'],
            items: [],
            sourceAvailability: {
              fulltext: { requested: true, returnedPassages: 0, unavailable: true },
            },
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.retrievalFacts?.truncated).toBe(true)
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
      indexedPages: 5,
      totalPages: 10,
      complete: false,
    })
  })

  it('keeps the first attachment hint a search surfaced', () => {
    const searchRowMeta = (attachmentRef: string) => ({
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
          bestAttachmentRef: attachmentRef,
        },
      ],
    })
    const workspace = buildSourceWorkspace([
      block(
        's1',
        1,
        'zotero_search',
        { query: 'attention' },
        { meta: searchRowMeta('zotero://user/0/attachment/WXYZ6789') },
      ),
      block(
        's2',
        2,
        'zotero_search',
        { query: 'attention', offset: 1 },
        { meta: searchRowMeta('zotero://user/0/attachment/OTHER99') },
      ),
    ])
    expect(workspace.sources[0]!.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
    })
  })

  it('keeps the content type of the first attachment hint a search surfaced', () => {
    const workspace = buildSourceWorkspace([
      block(
        's1',
        1,
        'zotero_search',
        { query: 'attention' },
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
                bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
                bestAttachmentType: 'application/pdf',
              },
            ],
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
  })

  it('keeps the attachment content type paired with the ref it described', () => {
    const withType = { ...RETRIEVE_META, attachmentContentType: 'application/pdf' }
    const firstMeet = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
    ])
    expect(firstMeet.sources[0]!.retrievalFacts?.attachmentContentType).toBe('application/pdf')

    const replaced = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        { meta: { ...withType, attachmentContentType: 'text/plain' } },
      ),
    ])
    expect(replaced.sources[0]!.retrievalFacts?.attachmentContentType).toBe('text/plain')

    // A ref-less follow-up preserves the pair it already carries.
    const preserved = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            sourceAvailability: {},
          },
        },
      ),
    ])
    expect(preserved.sources[0]!.retrievalFacts?.attachmentContentType).toBe('application/pdf')

    // A new ref without a type drops the stale pair: the deep link and its
    // type always describe the same retrieve.
    const dropped = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
      block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
    ])
    expect(dropped.sources[0]!.retrievalFacts?.attachmentContentType).toBeUndefined()
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
      provenanceOf({
        callId: 's1',
        query: 'transformer',
        itemTypes: ['journalArticle'],
        tags: ['review'],
      }),
    ])
    expect(workspace.sources[1]!.searches).toEqual([
      provenanceOf({
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

  it('preserves previous coverage and attachmentRef when the next retrieve carries none', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            sourceAvailability: {},
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
      indexedPages: 5,
      totalPages: 10,
      complete: false,
    })
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789',
    )
  })

  it('adopts later attachmentRef and coverage when earlier retrieve had none', () => {
    const workspace = buildSourceWorkspace([
      block(
        'r1',
        1,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            sourceAvailability: {},
          },
        },
      ),
      block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
    ])
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789',
    )
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
      indexedPages: 5,
      totalPages: 10,
      complete: false,
    })
  })

  it('treats retrieve count as optional and does not invent reportedEvidenceCount when absent', () => {
    const workspace = buildSourceWorkspace([
      block(
        'r1',
        1,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            sources: ['fulltext'],
            truncated: false,
            sourcesSkipped: [],
            items: [
              {
                source: 'fulltext',
                sourceRef: REF('A1'),
                preview: 'body',
                previewTruncated: false,
              },
            ],
            sourceAvailability: {},
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.facts.reportedEvidenceCount).toBe(0)
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
  })

  it('leaves attachmentRef and coverage unset when no retrieve provides them', () => {
    const workspace = buildSourceWorkspace([
      block(
        'r1',
        1,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            sourceAvailability: {},
          },
        },
      ),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 0,
            sources: [],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            sourceAvailability: {},
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBeUndefined()
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toBeUndefined()
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

  it('attributes every ref of a 50-ref export from the arguments, with no phantom omitted count', () => {
    const refs = Array.from({ length: 50 }, (_, index) => REF(`B${String(index).padStart(2, '0')}`))
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs, format: 'bibtex' },
        {
          meta: {
            format: 'bibtex',
            requested: 50,
            refs: refs.slice(0, 20),
            refsOmitted: 30,
          },
          content: [{ type: 'text', text: 'bib' }],
        },
      ),
    ])
    expect(workspace.exports[0]!.refs).toHaveLength(50)
    expect(workspace.exports[0]!.refsOmitted).toBe(0)
    expect(workspace.sources).toHaveLength(50)
    for (const source of workspace.sources) {
      expect(source.facts.exportCount).toBe(1)
    }
  })

  it('keeps the projection refsOmitted only for the meta-preview fallback', () => {
    const refs = Array.from({ length: 25 }, (_, index) => REF(`C${String(index).padStart(2, '0')}`))
    const workspace = buildSourceWorkspace([
      {
        ...settled(),
        callId: 'e1',
        seq: 1,
        call: { name: 'zotero_export', argsRaw: '' },
        meta: { format: 'ris', requested: 25, refs: refs.slice(0, 20), refsOmitted: 5 },
        content: [{ type: 'text', text: 'TY - JOUR' }],
      },
    ])
    expect(workspace.exports[0]!.refs).toHaveLength(20)
    expect(workspace.exports[0]!.refsOmitted).toBe(5)
  })

  it('records retrieval facts when the byte budget dropped the items preview', () => {
    const workspace = buildSourceWorkspace([
      block(
        'r1',
        1,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 25,
            sources: ['fulltext'],
            truncated: true,
            sourcesSkipped: [],
            detailOmitted: true,
            attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
            sourceAvailability: {
              fulltext: { requested: true, returnedPassages: 25, unavailable: false },
            },
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.retrievalFacts).toBeDefined()
    expect(workspace.sources[0]!.retrievalFacts?.truncated).toBe(true)
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789',
    )
    expect(workspace.sources[0]!.facts.reportedEvidenceCount).toBe(25)
    expect(workspace.sources[0]!.facts.evidenceCount).toBe(0)
  })

  it('adopts the latest attachmentRef and pairs it with the latest coverage', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      block(
        'r2',
        2,
        'zotero_retrieve',
        { ref: REF('A1') },
        {
          meta: {
            count: 1,
            sources: ['fulltext'],
            truncated: false,
            sourcesSkipped: [],
            items: [],
            attachmentRef: 'zotero://user/0/attachment/OTHER99',
            coverage: { indexedPages: 9, totalPages: 9, complete: true },
            sourceAvailability: {},
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
      'zotero://user/0/attachment/OTHER99',
    )
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
      indexedPages: 9,
      totalPages: 9,
      complete: true,
    })
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
      provenanceOf({ callId: 's1', query: 'x', tags: ['ml', 'review'] }),
    ])
    expect(workspace.sources[1]!.searches).toEqual([
      provenanceOf({ callId: 's1', query: 'x', tags: ['ml', 'review'] }),
    ])
  })
})
