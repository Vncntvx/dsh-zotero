/**
 * The search episode's audit counts: how many hits the folded episode returned,
 * and the first page's whole-hit total and note-scan matches. The returned
 * count comes from the search's own projection (the displayed rows are
 * byte-budget-bounded and include note-supplement rows). Continuation pages
 * only add to the hit counts; they never overwrite the first page's total or
 * note count, and an unreported count stays absent rather than reading as
 * zero. The folding rules themselves live in `reducer.spec.ts`; this spec owns
 * the hit-count fields. The workspace-level omitted-row aggregate is asserted
 * beside them.
 * @module tests/client/sources/reducer-episode-counts
 */

import { describe, expect, it } from 'vitest'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { REF, block, searchMetaOf } from './reducer-fixtures.ts'

/** The first source's one search occurrence (every source folds the same episode). */
function firstOccurrenceOf(...blocks: Parameters<typeof buildSourceWorkspace>[0]) {
  const workspace = buildSourceWorkspace(blocks)
  expect(workspace.sources.length).toBeGreaterThan(0)
  const occurrence = workspace.sources[0]!.searches[0]
  expect(occurrence).toBeDefined()
  return { workspace, occurrence: occurrence! }
}

describe('search episode counts', () => {
  it('reports one page returned, omitted, total, and note matches', () => {
    const meta = searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }], 1)
    meta['total'] = 12
    meta['noteMatches'] = 3
    const { workspace, occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence.returned).toBe(2)
    expect(occurrence).not.toHaveProperty('omitted')
    expect(occurrence.total).toBe(12)
    expect(occurrence.noteMatches).toBe(3)
    expect(workspace.omittedRows).toBe(1)
  })

  it('reports the projection returned count even when budgeted rows are fewer', () => {
    // The projection returned three hits but only two rows fit the byte budget.
    const meta = searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }], 1)
    meta['returned'] = 3
    const { workspace, occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence.returned).toBe(3)
    expect(workspace.omittedRows).toBe(1)
  })

  it('does not count note-supplement rows as returned hits', () => {
    // Three displayed rows: two primary hits and one folded note match. Only
    // the primary hits the listing returned may reach the hit count.
    const meta = searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }, { ref: REF('A3') }])
    meta['returned'] = 2
    meta['noteMatches'] = 1
    const { occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence.returned).toBe(2)
    expect(occurrence.noteMatches).toBe(1)
  })

  it('falls back to the displayed row count when the projection omits returned', () => {
    const meta = searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }])
    delete meta['returned']
    const { occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence.returned).toBe(2)
  })

  it('adds continuation pages to returned and omitted but keeps the first page totals', () => {
    const first = searchMetaOf([{ ref: REF('A1') }, { ref: REF('A2') }], 1)
    first['total'] = 12
    first['noteMatches'] = 3
    // The continuation page reports its own page-sized total and note count;
    // neither may replace the episode's first-page facts.
    const second = searchMetaOf([{ ref: REF('A3') }], 2)
    second['total'] = 99
    second['noteMatches'] = 7
    const { workspace, occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention', offset: 0 }, { meta: first }),
      block('s2', 2, 'zotero_search', { query: 'attention', offset: 2 }, { meta: second }),
    )

    expect(occurrence.returned).toBe(3)
    expect(occurrence.total).toBe(12)
    expect(occurrence.noteMatches).toBe(3)
    expect(workspace.omittedRows).toBe(3)
    // Every source surfaced by either page carries the same folded record.
    for (const source of workspace.sources) {
      expect(source.searches).toEqual([occurrence])
    }
  })

  it('omits the total and note matches when Zotero reported neither', () => {
    const meta = searchMetaOf([{ ref: REF('A1') }])
    delete meta['total']
    delete meta['noteMatches']
    const { occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence.returned).toBe(1)
    expect(occurrence).not.toHaveProperty('omitted')
    expect(occurrence).not.toHaveProperty('total')
    expect(occurrence).not.toHaveProperty('noteMatches')
  })

  it('keeps a reported zero note count distinct from no note scan', () => {
    const meta = searchMetaOf([{ ref: REF('A1') }])
    meta['noteMatches'] = 0
    const { occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta }),
    )

    expect(occurrence).toHaveProperty('noteMatches')
    expect(occurrence.noteMatches).toBe(0)
  })

  it('keeps the first page unreported when only a continuation page states the total', () => {
    const first = searchMetaOf([{ ref: REF('A1') }])
    delete first['total']
    delete first['noteMatches']
    const second = searchMetaOf([{ ref: REF('A2') }])
    second['total'] = 42
    second['noteMatches'] = 5
    const { occurrence } = firstOccurrenceOf(
      block('s1', 1, 'zotero_search', { query: 'attention' }, { meta: first }),
      block('s2', 2, 'zotero_search', { query: 'attention', offset: 1 }, { meta: second }),
    )

    expect(occurrence.returned).toBe(2)
    expect(occurrence).not.toHaveProperty('total')
    expect(occurrence).not.toHaveProperty('noteMatches')
  })
})
