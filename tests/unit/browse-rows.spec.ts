/**
 * The browse row classification both halves read rows through: `renderBrowse`
 * for the model, the Chat card for the user. These cases establish the order
 * the tests run in — a row is named by the first field it carries — because
 * that order is the contract; a reordering silently renames rows for both
 * readers at once.
 * @module tests/unit/browse-rows
 */

import { describe, expect, it } from 'vitest'
import { BROWSE_ROW_ARMS, browseRowOf } from '../../src/browse-rows.js'
import { renderBrowse } from '../../src/tools/browse.js'

describe('browseRowOf', () => {
  it('reaches exactly the arms the card knows how to draw', () => {
    // One row per arm, each identified by the field that names it, so the
    // enumeration below cannot drift from the arms a card has to handle.
    const ROWS: Record<(typeof BROWSE_ROW_ARMS)[number], unknown> = {
      library: { library: { type: 'user', id: 0 }, name: 'My Library' },
      collection: { path: ['Reading'], ref: 'r1', depth: 0 },
      savedSearch: { ref: 's1', name: 'Unread' },
      tag: { tag: 'quantum' },
      itemType: { itemType: 'book' },
      field: { field: 'archive' },
      creatorType: { creatorType: 'author' },
    }
    expect(BROWSE_ROW_ARMS.map((arm) => browseRowOf(ROWS[arm]).kind)).toEqual([...BROWSE_ROW_ARMS])
  })

  it('names a library row by its library block, before any other field', () => {
    // The library block wins even when the row also carries a tag or a name,
    // which is the ordering the render and the card both depend on.
    expect(browseRowOf({ library: { type: 'group', id: 9 }, name: 'Lab', tag: 'ignored' })).toEqual(
      { kind: 'library', name: 'Lab', libraryId: 'group/9' },
    )
  })

  it('falls back to the library identity when a library row is unnamed', () => {
    expect(browseRowOf({ library: { type: 'user', id: 0 } })).toEqual({
      kind: 'library',
      name: 'user/0',
      libraryId: 'user/0',
    })
  })

  it('never leaks the word undefined into a library identity', () => {
    // The previous inline template spelled a missing field as `undefined/9`.
    expect(browseRowOf({ library: { id: 9 } })).toEqual({
      kind: 'library',
      name: '/9',
      libraryId: '/9',
    })
  })

  it('names a collection row by its path, ahead of every later field', () => {
    expect(
      browseRowOf({
        path: ['Reading', '2026'],
        ref: 'zotero://user/0/collection/ABCD1234',
        depth: 2,
        tag: 'x',
      }),
    ).toEqual({
      kind: 'collection',
      breadcrumb: ['Reading', '2026'],
      ref: 'zotero://user/0/collection/ABCD1234',
      depth: 2,
    })
  })

  it('keeps an empty path a collection rather than collapsing it to absent', () => {
    // Presence classifies, not length: a breadcrumb that came back empty is
    // still the row's identity, and the render still names it.
    expect(browseRowOf({ path: [], ref: 'r' })).toEqual({
      kind: 'collection',
      breadcrumb: [],
      ref: 'r',
      depth: 0,
    })
  })

  it('names a tag row and carries its scoped count when reported', () => {
    expect(browseRowOf({ tag: 'quantum', count: 12 })).toEqual({
      kind: 'tag',
      tag: 'quantum',
      count: 12,
    })
    expect(browseRowOf({ tag: 'quantum' })).toEqual({ kind: 'tag', tag: 'quantum', count: null })
  })

  it('names the itemType, field, and creatorType arms in schema order', () => {
    expect(browseRowOf({ itemType: 'book', localized: 'Book' })).toEqual({
      kind: 'itemType',
      itemType: 'book',
      localized: 'Book',
    })
    expect(browseRowOf({ field: 'archive' })).toEqual({
      kind: 'field',
      field: 'archive',
      localized: null,
    })
    // A field and a creator type can share one row shape's neighborhood; the
    // field test runs first, so a row carrying both is a field.
    expect(browseRowOf({ field: 'author', creatorType: 'author' }).kind).toBe('field')
    expect(browseRowOf({ creatorType: 'author' })).toEqual({
      kind: 'creatorType',
      creatorType: 'author',
      localized: null,
    })
  })

  it('names the remaining arm a saved search and counts its conditions', () => {
    expect(
      browseRowOf({
        ref: 'zotero://user/0/savedSearch/SS123456',
        name: 'Unread',
        conditions: [{ condition: 'unread' }, { condition: 'tag' }],
      }),
    ).toEqual({
      kind: 'savedSearch',
      name: 'Unread',
      ref: 'zotero://user/0/savedSearch/SS123456',
      conditionCount: 2,
    })
  })

  it('falls back to the ref, then to the row itself, for a nameless saved search', () => {
    const named = browseRowOf({ ref: 'SS123456', conditions: [] })
    expect(named.kind === 'savedSearch' && named.name).toBe('SS123456')
    // Nothing identifying at all: the row renders as its own JSON rather than
    // being dropped or named with the word undefined.
    expect(browseRowOf({ conditions: [{ condition: 'unread' }] })).toEqual({
      kind: 'savedSearch',
      name: '{"conditions":[{"condition":"unread"}]}',
      ref: '',
      conditionCount: 1,
    })
  })

  it('classifies a non-record and an empty row without throwing', () => {
    // The fallback arm echoes the value it was handed, so nothing the reader
    // could have seen is discarded on the way to the card.
    for (const value of [undefined, 'nonsense', [], 7]) {
      const row = browseRowOf(value)
      expect(row.kind).toBe('savedSearch')
      expect(row.kind === 'savedSearch' && row.name).toBe(JSON.stringify(value))
    }
  })
})

describe('renderBrowse over the shared classification', () => {
  const out = (items: readonly unknown[], extra: Record<string, unknown> = {}) =>
    (
      renderBrowse({ kind: 'libraries', offset: 0, limit: 20 }, {
        kind: 'libraries',
        total: items.length,
        returned: items.length,
        offset: 0,
        items,
        ...extra,
      } as never)[0] as { text: string }
    ).text

  it('keeps the header, the two-line library rows, and the page pointer', () => {
    // The format pin: a libraries page is one header line, two lines per row,
    // and a closing page pointer. The old card counted text lines as items, so
    // this shape is what made it read 41 for a 20-row page.
    const text = out(
      [
        { library: { type: 'user', id: 0 }, name: 'My Library' },
        { library: { type: 'group', id: 9 }, name: 'Lab' },
      ],
      { nextOffset: 2 },
    )
    expect(text.split('\n')).toEqual([
      'libraries: 2 of 2',
      '1. My Library — user/0',
      '   library=user/0',
      '2. Lab — group/9',
      '   library=group/9',
      'More: browse again with offset 2',
    ])
  })

  it('renders a full libraries page as far more lines than it has rows', () => {
    // The shape that broke the card: a 20-row libraries page is 42 text lines,
    // so a card that counted lines reported 42 items for 20 libraries.
    const items = Array.from({ length: 20 }, (_, index) => ({
      library: { type: 'user', id: index },
      name: `Library ${index}`,
    }))
    const text = out(items, { nextOffset: 20 })
    expect(text.split('\n')).toHaveLength(42)
    expect(text.split('\n')[41]).toBe('More: browse again with offset 20')
  })

  it('renders every other arm on one line each', () => {
    const text = out([
      { path: ['Reading'], ref: 'zotero://user/0/collection/ABCD1234' },
      { tag: 'quantum', count: 12 },
      { itemType: 'book', localized: 'Book' },
      { field: 'archive' },
      { creatorType: 'author' },
      { name: 'Unread', ref: 'SS123456', conditions: [{}] },
    ])
    expect(text.split('\n')).toEqual([
      'libraries: 6 of 6',
      '1. Reading — zotero://user/0/collection/ABCD1234',
      '2. quantum — 12 items',
      '3. book (Book)',
      '4. field archive',
      '5. creatorType author',
      '6. Unread — 1 conditions — SS123456',
    ])
  })
})
