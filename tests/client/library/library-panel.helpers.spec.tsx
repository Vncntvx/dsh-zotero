/**
 * The library panel's pure projections: the scope derivation, the wire
 * request builders, the tree flattening, and the list/inspector state
 * machines. No mounting; every case is a function call.
 * @module tests/client/library/library-panel.helpers
 */

import { describe, expect, it } from 'vitest'
import {
  collectionRowsOf,
  flattenTree,
  libraryOptionsOf,
  LIBRARY_PAGE_SIZE,
  LIBRARY_SORTS,
  itemStateOf,
  listRequestOf,
  listStateOf,
  pageRangeOf,
  savedSearchRowsOf,
  scopeViewOf,
  treeRequestOf,
  type CollectionRowView,
} from '../../../src/client/components/library/library-model.ts'
import type { ZoteroLibraryBrowseItemView } from '../../../src/contract.ts'

describe('scopeViewOf', () => {
  it('derives the wire scope for the fixed and named selections', () => {
    expect(scopeViewOf({ kind: 'library' })).toEqual({ kind: 'library' })
    expect(scopeViewOf({ kind: 'publications' })).toEqual({ kind: 'publications' })
    expect(scopeViewOf({ kind: 'trash' })).toEqual({ kind: 'trash' })
    expect(scopeViewOf({ kind: 'collection', ref: 'r', name: 'n' })).toEqual({
      kind: 'collection',
      refOrName: 'r',
    })
    expect(scopeViewOf({ kind: 'savedSearch', ref: 'r', name: 'n' })).toEqual({
      kind: 'savedSearch',
      refOrName: 'r',
    })
  })
})

describe('listRequestOf', () => {
  it('builds the wire request with the page size and the toolbar state', () => {
    expect(
      listRequestOf({
        selection: { kind: 'library' },
        library: { type: 'user', id: 0 },
        q: '',
        mode: 'metadata',
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
      }),
    ).toEqual({
      scope: { kind: 'library' },
      library: { type: 'user', id: 0 },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: LIBRARY_PAGE_SIZE,
    })
  })

  it('carries the query only when it is not blank', () => {
    const base = {
      selection: { kind: 'collection', ref: 'r', name: 'n' } as const,
      library: { type: 'group', id: 5 } as const,
      mode: 'everything' as const,
      sort: 'title' as const,
      direction: 'asc' as const,
      offset: 50,
    }
    expect(listRequestOf({ ...base, q: 'flash' })).toMatchObject({
      q: 'flash',
      scope: { kind: 'collection', refOrName: 'r' },
      library: { type: 'group', id: 5 },
      mode: 'everything',
      sort: 'title',
      direction: 'asc',
      offset: 50,
      limit: LIBRARY_PAGE_SIZE,
    })
    expect('q' in listRequestOf({ ...base, q: '' })).toBe(false)
  })
})

describe('treeRequestOf and the browse request builders', () => {
  it('omits parentRef for the root level and names the library', () => {
    expect(treeRequestOf({ type: 'group', id: 7 }, undefined)).toEqual({
      kind: 'collections',
      library: { type: 'group', id: 7 },
      offset: 0,
      limit: LIBRARY_PAGE_SIZE,
    })
    expect(treeRequestOf({ type: 'user', id: 0 }, 'zotero://user/0/collection/C1')).toEqual({
      kind: 'collections',
      library: { type: 'user', id: 0 },
      parentRef: 'zotero://user/0/collection/C1',
      offset: 0,
      limit: LIBRARY_PAGE_SIZE,
    })
  })
})

describe('row projections', () => {
  const rows: ZoteroLibraryBrowseItemView[] = [
    { kind: 'library', library: { type: 'user', id: 0 }, name: 'My Library' },
    { kind: 'collection', ref: 'c1', name: 'C', path: ['C'], depth: 0 },
    { kind: 'savedSearch', ref: 's1', name: 'S', conditions: [] },
  ]

  it('partitions browse rows by their wire kind', () => {
    expect(collectionRowsOf(rows)).toHaveLength(1)
    expect(savedSearchRowsOf(rows)).toHaveLength(1)
    expect(libraryOptionsOf(rows)).toEqual([
      { library: { type: 'user', id: 0 }, name: 'My Library' },
    ])
  })

  it('keeps the personal library first in the selector options', () => {
    expect(
      libraryOptionsOf([
        { kind: 'library', library: { type: 'group', id: 9 }, name: 'G9' },
        { kind: 'library', library: { type: 'group', id: 2 }, name: 'G2' },
        { kind: 'library', library: { type: 'user', id: 0 }, name: 'My Library' },
      ]),
    ).toEqual([
      { library: { type: 'user', id: 0 }, name: 'My Library' },
      { library: { type: 'group', id: 2 }, name: 'G2' },
      { library: { type: 'group', id: 9 }, name: 'G9' },
    ])
  })
})

describe('flattenTree', () => {
  const root: CollectionRowView = {
    kind: 'collection',
    ref: 'root',
    name: 'Root',
    path: ['Root'],
    depth: 0,
  }
  const childA: CollectionRowView = {
    kind: 'collection',
    ref: 'a',
    name: 'A',
    parentRef: 'root',
    path: ['Root', 'A'],
    depth: 1,
  }
  const grandChild: CollectionRowView = {
    kind: 'collection',
    ref: 'a1',
    name: 'A1',
    parentRef: 'a',
    path: ['Root', 'A', 'A1'],
    depth: 2,
  }
  const childB: CollectionRowView = {
    kind: 'collection',
    ref: 'b',
    name: 'B',
    parentRef: 'root',
    path: ['Root', 'B'],
    depth: 1,
  }

  /** A ready lane page for `laneOf`; offset 0 keeps `posInSet` = index + 1. */
  const lane = (rows: readonly CollectionRowView[]) => ({ rows, offset: 0, total: rows.length })

  it('shows only roots while nothing is expanded', () => {
    // childA sits in the children cache, not in the roots: a collapsed tree
    // never leaks cached children into the visible rows.
    const rootLane = lane([root])
    expect(flattenTree([root], () => lane([childA]), new Set(), rootLane)).toEqual([
      { row: root, depth: 0, setSize: 1, posInSet: 1 },
    ])
  })

  it('walks expanded levels recursively with increasing depth', () => {
    const flat = flattenTree(
      [root],
      (ref) =>
        ref === 'root' ? lane([childA, childB]) : ref === 'a' ? lane([grandChild]) : undefined,
      new Set(['root', 'a']),
      lane([root]),
    )
    expect(
      flat.map(({ row, depth, setSize, posInSet }) => [row.ref, depth, setSize, posInSet]),
    ).toEqual([
      ['root', 0, 1, 1],
      ['a', 1, 2, 1],
      ['a1', 2, 1, 1],
      ['b', 1, 2, 2],
    ])
  })

  it('renders an expanded-but-unloaded level as nothing, not an error', () => {
    const rootLane = lane([root])
    const flat = flattenTree([root], () => undefined, new Set(['root']), rootLane)
    expect(flat).toEqual([{ row: root, depth: 0, setSize: 1, posInSet: 1 }])
  })
})

describe('listStateOf and pageRangeOf', () => {
  it('maps the wire arms to the render phases', () => {
    // The failure arm's code-discriminated union is wider than this case
    // needs; the loose shape mirrors the harness specs' scripted failures.
    const failure = {
      ok: false,
      error: { code: 'gateway/internal', message: 'offline', details: {} },
    } as unknown as Parameters<typeof listStateOf>[0]
    expect(listStateOf(failure)).toEqual({
      phase: 'error',
      message: 'offline',
    })
    const ready = listStateOf({
      ok: true,
      value: {
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [],
        total: 0,
        offset: 0,
        returned: 0,
        limit: LIBRARY_PAGE_SIZE,
      },
    })
    expect(ready).toMatchObject({ phase: 'ready', total: 0 })
  })

  it('maps the inspector arms the same way', () => {
    const failure = {
      ok: false,
      error: { code: 'gateway/internal', message: 'gone', details: {} },
    } as unknown as Parameters<typeof itemStateOf>[0]
    expect(itemStateOf(failure)).toEqual({ phase: 'error', message: 'gone' })
    const ready = itemStateOf({
      ok: true,
      value: {
        ref: 'r',
        itemType: 'note',
        title: 'T',
        creators: [],
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 0 },
      },
    })
    expect(ready).toMatchObject({ phase: 'ready', detail: { title: 'T' } })
  })

  it('labels the shown range and stays undefined for an empty page', () => {
    expect(pageRangeOf({ offset: 0, total: 5 }, 0)).toBeUndefined()
    expect(pageRangeOf({ offset: 50, total: 120 }, 2)).toEqual({ start: 51, end: 52, total: 120 })
  })
})

describe('constants', () => {
  it('keeps the sort fields and page size the toolbar assumes', () => {
    expect(LIBRARY_SORTS).toEqual(['dateModified', 'dateAdded', 'date', 'title', 'creator'])
    expect(LIBRARY_PAGE_SIZE).toBe(50)
  })
})
