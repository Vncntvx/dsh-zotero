/**
 * The session source reducer: stable union, provable facts only, operation
 * separation, dedup, provenance, and v1 transcript degradation.
 * @module tests/client/sources/reducer
 */

import { describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { settled, running } from '../helpers/blocks.ts'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { serverIdOf } from '../../../src/client/sources/provenance.ts'

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
        { meta: searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }, { ref: REF('A3') }]) },
      ),
      block('g1', 2, 'zotero_get', { ref: REF('A2') }, { meta: GET_META }),
    ])
    expect(workspace.sources).toHaveLength(3)
    const inspected = workspace.sources.find((item) => item.key.includes('a2'))
    expect(inspected?.facts.inspected).toBe(true)
    expect(inspected?.facts.discovered).toBe(true)
    expect(workspace.sources.every((item) => item.facts.discovered)).toBe(true)
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
    expect(workspace.sources.map((item) => serverIdOf(item.ref) ?? item.key)).toHaveLength(2)
    const first = workspace.sources.find((item) => item.key.includes('a1'))
    const second = workspace.sources.find((item) => item.key.includes('b1'))
    expect(first?.searches.map((entry) => entry.query)).toEqual(['attention'])
    expect(second?.searches.map((entry) => entry.query)).toEqual(['diffusion'])
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
      expect(source.searches).toHaveLength(1)
      expect(source.searches[0]).toMatchObject({
        callId: 's1',
        query: 'attention',
        offset: 0,
        returned: 3,
        omitted: 0,
      })
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

  it('normalizes the search scope and never keeps raw arguments', () => {
    const workspace = buildSourceWorkspace([
      block(
        's1',
        1,
        'zotero_search',
        {
          query: 'attention',
          mode: 'everything',
          scope: { kind: 'collection', refOrName: 'Reading' },
        },
        { meta: searchMetaOf([{ ref: REF('A1') }]) },
      ),
      block(
        's2',
        2,
        'zotero_search',
        {
          query: 'attention',
          mode: 'metadata',
          scope: { kind: 'savedSearch', refOrName: 'zotero://user/0/search/SS1' },
        },
        { meta: searchMetaOf([{ ref: REF('A2') }]) },
      ),
    ])
    const a1 = workspace.sources.find((item) => item.key.includes('a1'))
    const a2 = workspace.sources.find((item) => item.key.includes('a2'))
    expect(a1?.searches[0]!.scope).toEqual({ kind: 'collection', name: 'Reading' })
    expect(a1?.searches[0]!.mode).toBe('everything')
    expect(a2?.searches[0]!.scope).toEqual({
      kind: 'savedSearch',
      ref: 'zotero://user/0/search/SS1',
    })
  })

  it('produces only inspected from a get, with no invented stage facts', () => {
    const workspace = buildSourceWorkspace([
      block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts).toEqual({
      discovered: false,
      inspected: true,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    })
    expect(workspace.sources[0]!.callRefs.successful).toEqual(['g1'])
    expect(workspace.sources[0]!.title).toBe('Attention Is All You Need')
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
  })

  it('counts running calls as operations and never as facts', () => {
    const workspace = buildSourceWorkspace([
      running({ callId: 'g1', name: 'zotero_get', argsRaw: JSON.stringify({ ref: REF('A1') }) }),
    ])
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.facts).toEqual({
      discovered: false,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    })
    expect(workspace.sources[0]!.operations).toEqual({ running: 1, failed: 0, stopped: 0 })
    expect(workspace.sources[0]!.callRefs.running).toEqual(['g1'])
    expect(workspace.operations.running).toBe(1)
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
    expect(workspace.operations).toEqual({ running: 0, failed: 1, stopped: 1 })
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

  it('creates no artifact from running, failed, or text-less exports', () => {
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
    expect(workspace.operations).toEqual({ running: 1, failed: 1, stopped: 1 })
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

  it('counts ref-less settled calls as unattributed', () => {
    const workspace = buildSourceWorkspace([
      block('g1', 1, 'zotero_get', {}, {}),
      block('e1', 2, 'zotero_export', { refs: 3 }, {}),
      block('r1', 3, 'zotero_retrieve', {}, {}),
      block('a1', 4, 'zotero_attachment', {}, {}),
    ])
    expect(workspace.unattributed).toBe(4)
    expect(workspace.sources).toEqual([])
  })

  it('degrades malformed meta to no facts without crashing', () => {
    const workspace = buildSourceWorkspace([
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta: { items: 'x' } }),
      block('g1', 2, 'zotero_get', { ref: REF('A1') }, { meta: {} }),
      block('g2', 3, 'zotero_get', { ref: REF('A2') }, {}),
    ])
    expect(workspace.sources).toHaveLength(2)
    expect(workspace.sources.every((item) => item.facts.inspected === false)).toBe(true)
    expect(workspace.sources.every((item) => item.facts.discovered === false)).toBe(true)
    expect(workspace.operations).toEqual({ running: 0, failed: 0, stopped: 0 })
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

    const verified = buildSourceWorkspace(blocks, { currentServerId: 'S2' })
    expect(verified.sources[0]!.provenance).toBe('mismatch')

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
              { source: 'fulltext', sourceRef: REF('A1'), preview: 'b', previewTruncated: false },
            ],
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.facts.discovered).toBe(true)
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
        meta: { format: 'ris', requested: 1, refs: [REF('A1')], refsOmitted: 0 },
        content: [{ type: 'text', text: 'TY - JOUR' }],
      },
    ])
    expect(workspace.exports[0]!.refs).toEqual([REF('A1')])
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

  it('counts running and failed searches in the workspace operations', () => {
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
    expect(workspace.operations).toEqual({ running: 1, failed: 1, stopped: 0 })
  })

  it('treats ref-less calls with unparseable arguments as unattributed', () => {
    const workspace = buildSourceWorkspace([
      { ...settled(), callId: 'g1', seq: 1, call: { name: 'zotero_get', argsRaw: '' } },
      { ...settled(), callId: 'e1', seq: 2, call: { name: 'zotero_export', argsRaw: '' } },
    ])
    expect(workspace.unattributed).toBe(2)
    expect(workspace.sources).toEqual([])
  })

  it('ignores unknown tool names and handles the empty slice', () => {
    expect(buildSourceWorkspace([])).toEqual({
      sources: [],
      exports: [],
      operations: { running: 0, failed: 0, stopped: 0 },
      exportOperations: { running: 0, failed: 0, stopped: 0 },
      unattributed: 0,
      omittedRows: 0,
    })
    const workspace = buildSourceWorkspace([block('x1', 1, 'other_tool', {}, {})])
    expect(workspace.sources).toEqual([])
    expect(workspace.operations).toEqual({ running: 0, failed: 0, stopped: 0 })
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
    expect(workspace.operations).toEqual({ running: 0, failed: 0, stopped: 0 })
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

  it('normalizes degraded scope, query, and offset arguments', () => {
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
    ])
    expect(workspace.sources).toHaveLength(5)
    expect(workspace.sources[0]!.searches[0]!.scope).toEqual({ kind: 'library' })
    expect(workspace.sources[1]!.searches[0]).toMatchObject({
      scope: { kind: 'savedSearch', name: 'Inbox' },
      mode: 'everything',
      offset: 0,
    })
    expect(workspace.sources[1]!.searches[0]!.query).toBeUndefined()
    expect(workspace.sources[2]!.searches[0]!.scope).toEqual({ kind: 'library' })
    expect(workspace.sources[3]!.searches[0]!.scope).toEqual({ kind: 'library' })
    expect(workspace.sources[4]!.searches[0]!.query).toBeUndefined()
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
    expect(workspace.sources[0]!.itemType).toBeUndefined()
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

  it('does not count a running export with unusable arguments as unattributed', () => {
    const workspace = buildSourceWorkspace([
      running({ callId: 'e1', name: 'zotero_export', argsRaw: '{}' }),
    ])
    expect(workspace.unattributed).toBe(0)
    expect(workspace.sources).toEqual([])
    expect(workspace.operations).toEqual({ running: 1, failed: 0, stopped: 0 })
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
    expect(workspace.sources[0]!.retrievalFacts?.coverage).toBeUndefined()
  })

  it('keeps the first attachment hint a search surfaced', () => {
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
              },
            ],
          },
        },
      ),
      block(
        's2',
        2,
        'zotero_search',
        { query: 'attention', offset: 1 },
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
                bestAttachmentRef: 'zotero://user/0/attachment/OTHER99',
              },
            ],
          },
        },
      ),
    ])
    expect(workspace.sources[0]!.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
    })
  })
})
