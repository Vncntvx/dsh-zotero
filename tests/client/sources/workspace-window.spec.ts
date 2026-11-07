/**
 * The workspace's wire-view windows: the lists the client renders are capped
 * in transcript order while every total and session-wide aggregate stays
 * exact over the FULL session, so what the window omits is counted, never
 * lost. The windowing lives in `buildSourceWorkspace` — the one aggregation
 * rule both the host projection and the client's local fallback share — so
 * these pins hold for both feeders.
 * @module tests/client/sources/workspace-window
 */

import { describe, expect, it } from 'vitest'
import {
  ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS,
  ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES,
} from '../../../src/constants.js'
import { buildSourceWorkspace } from '../../../src/sources/ledger.js'
import { REF, block, searchMetaOf } from './reducer-fixtures.ts'

/** The retrieve projection one real `zotero_retrieve` returns, per passage index. */
function retrieveMetaOf(index: number): Record<string, unknown> {
  return {
    count: 1,
    sources: ['annotation'],
    truncated: false,
    sourcesSkipped: [],
    items: [
      {
        source: 'annotation',
        sourceRef: `zotero://user/0/annotation/ANN${index}`,
        preview: `passage ${index}`,
        previewTruncated: false,
        pageLabel: '7',
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      },
    ],
    attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
    coverage: { indexedPages: 5, totalPages: 10, complete: false },
    sourceAvailability: {
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
    },
  }
}

describe('buildSourceWorkspace windows', () => {
  it('caps the source union and keeps the exact totals and filter counts', () => {
    const rows = Array.from({ length: ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES + 50 }, (_, i) => ({
      ref: REF(`S${String(i).padStart(4, '0')}`),
      title: `Paper ${i}`,
    }))
    const workspace = buildSourceWorkspace([
      block('s1', 1, 'zotero_search', { query: 'all' }, { meta: searchMetaOf(rows) }),
    ])
    expect(workspace.sources).toHaveLength(ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES)
    expect(workspace.sourceTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES + 50)
    expect(workspace.filterCounts.all).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES + 50)
    // The window keeps the transcript head: the first sources survive.
    expect(workspace.sources[0]!.ref).toBe(REF('S0000'))
  })

  it('caps each item list and carries its exact total', () => {
    const blocks = Array.from({ length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 10 }, (_, i) =>
      block(
        `s${i}`,
        i + 1,
        'zotero_search',
        { query: `q${i}` },
        {
          meta: searchMetaOf([{ ref: REF('A1') }]),
        },
      ),
    )
    const workspace = buildSourceWorkspace(blocks)
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]!.searches).toHaveLength(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS)
    expect(workspace.sources[0]!.searchesTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 10)
  })

  it('caps evidence and keeps the exact passage total', () => {
    const blocks = Array.from({ length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 5 }, (_, i) =>
      block(`r${i}`, i + 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: retrieveMetaOf(i) }),
    )
    const workspace = buildSourceWorkspace(blocks)
    expect(workspace.sources[0]!.evidence).toHaveLength(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS)
    expect(workspace.sources[0]!.evidenceTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 5)
    expect(workspace.evidencePassageTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 5)
  })

  it('caps exports and keeps the session-wide ref count exact', () => {
    const blocks = Array.from({ length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 10 }, (_, i) =>
      block(
        `e${i}`,
        i + 1,
        'zotero_export',
        { refs: [REF('A1')], format: 'ris' },
        {
          meta: { format: 'ris', requested: 1, refs: [REF('A1')], refsOmitted: 0 },
          content: [{ type: 'text', text: `TY  - JOUR\nER  -\n${i}` }],
        },
      ),
    )
    const workspace = buildSourceWorkspace(blocks)
    expect(workspace.exports).toHaveLength(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS)
    expect(workspace.exportTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 10)
    expect(workspace.sources[0]!.exports).toHaveLength(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS)
    expect(workspace.sources[0]!.exportsTotal).toBe(ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 10)
    // The ref count is exact over ALL artifacts, windowed or not.
    expect(workspace.exportedRefCount).toBe(1)
  })

  it('keeps the pill count and the passage total genuinely different measures', () => {
    const workspace = buildSourceWorkspace([
      block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: retrieveMetaOf(0) }),
      block('r2', 2, 'zotero_retrieve', { ref: REF('B2') }, { meta: retrieveMetaOf(1) }),
      block('r3', 3, 'zotero_retrieve', { ref: REF('A1') }, { meta: retrieveMetaOf(2) }),
    ])
    expect(workspace.evidencePassageTotal).toBe(3)
    // The same three sources count as two evidence-bearing sources: the
    // filter pill count and the overview sum genuinely differ.
    expect(workspace.filterCounts.evidence).toBe(2)
  })

  it('deduplicates exported refs across formats and server qualifiers over the full session', () => {
    const workspace = buildSourceWorkspace([
      block(
        'e1',
        1,
        'zotero_export',
        { refs: [REF('QRST3456')], format: 'bibtex' },
        {
          meta: { format: 'bibtex', requested: 1, refs: [REF('QRST3456')], refsOmitted: 0 },
          content: [{ type: 'text', text: '@article{a}' }],
        },
      ),
      block(
        'e2',
        2,
        'zotero_export',
        { refs: [REF('QRST3456')], format: 'ris' },
        {
          meta: { format: 'ris', requested: 1, refs: [REF('QRST3456')], refsOmitted: 0 },
          content: [{ type: 'text', text: 'TY  - JOUR\nER  -' }],
        },
      ),
      block(
        'e3',
        3,
        'zotero_export',
        { refs: [REF('QRST3456', 'S1')], format: 'bibtex' },
        {
          meta: { format: 'bibtex', requested: 1, refs: [REF('QRST3456', 'S1')], refsOmitted: 0 },
          content: [{ type: 'text', text: '@article{a2}' }],
        },
      ),
    ])
    expect(workspace.exportedRefCount).toBe(1)
  })
})
