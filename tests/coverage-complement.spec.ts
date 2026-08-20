import { describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_REF, ZoteroError } from '../src/errors.js'
import {
  formatRef,
  libraryPrefix,
  isSupportedLocalLibrary,
  parseRef,
  parseZoteroRelationUri,
  PERSONAL_GROUPS_DISCOVERY,
  PERSONAL_LIBRARY,
  refForLibrary,
  requireSupportedLocalRef,
} from '../src/refs.js'
import { normalizeItemDetail, normalizeSearchItem } from '../src/normalize.js'

describe('refs: library identity helpers', () => {
  it('isSupportedLocalLibrary', () => {
    expect(isSupportedLocalLibrary({ type: 'user', id: 0 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'group', id: 1 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'group', id: 42 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'user', id: 1 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: 0 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: -5 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: 3.5 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'unknown' as unknown as 'user', id: 0 })).toBe(false)
  })
  it('libraryPrefix', () => {
    expect(libraryPrefix({ type: 'user', id: 0 })).toBe('users/0')
    expect(libraryPrefix({ type: 'group', id: 99 })).toBe('groups/99')
    expect(PERSONAL_LIBRARY).toEqual({ type: 'user', id: 0 })
    expect(PERSONAL_GROUPS_DISCOVERY).toBe('users/0/groups')
  })
  it('refForLibrary success and failure', () => {
    expect(refForLibrary({ type: 'user', id: 0 }, 'item', 'ABCD1234')).toEqual({
      library: { type: 'user', id: 0 },
      kind: 'item',
      key: 'ABCD1234',
      serverId: undefined,
    })
    expect(refForLibrary({ type: 'group', id: 42 }, 'collection', 'COLL1234', 'S1')).toEqual({
      library: { type: 'group', id: 42 },
      kind: 'collection',
      key: 'COLL1234',
      serverId: 'S1',
    })
    expect(() => refForLibrary({ type: 'user', id: 0 }, 'item', 'bad')).toThrowError(ZoteroError)
    expect(() => refForLibrary({ type: 'user', id: 123 }, 'item', 'ABCD1234')).toThrow()
    try {
      refForLibrary({ type: 'user', id: 123 }, 'item', 'ABCD1234')
      expect.unreachable()
    } catch (e) {
      expect((e as ZoteroError).code).toBe(ZOTERO_INVALID_REF)
    }
    expect(() => refForLibrary({ type: 'group', id: 0 }, 'item', 'ABCD1234')).toThrow()
    try {
      refForLibrary({ type: 'group', id: 0 }, 'item', 'ABCD1234')
      expect.unreachable()
    } catch (e) {
      expect((e as ZoteroError).code).toBe(ZOTERO_INVALID_REF)
    }
  })
  it('requireSupportedLocalRef', () => {
    expect(requireSupportedLocalRef(parseRef('zotero://user/0/item/ABCD1234'))).toBeTruthy()
    expect(requireSupportedLocalRef(parseRef('zotero://group/5/item/ABCD1234'))).toBeTruthy()
    try {
      requireSupportedLocalRef(parseRef('zotero://user/123/item/ABCD1234'))
      expect.unreachable()
    } catch (e) {
      expect((e as ZoteroError).code).toBe(ZOTERO_INVALID_REF)
    }
    try {
      requireSupportedLocalRef(parseRef('zotero://user/0/collection/COLL1234'), ['item'])
      expect.unreachable()
    } catch (e) {
      expect((e as ZoteroError).code).toBe(ZOTERO_INVALID_REF)
    }
  })
  it('parseZoteroRelationUri', () => {
    expect(parseZoteroRelationUri('http://zotero.org/users/0/items/ABCD1234')).toEqual({
      library: { type: 'user', id: 0 },
      key: 'ABCD1234',
    })
    expect(parseZoteroRelationUri('https://www.zotero.org/groups/1/items/JKLM6543')).toEqual({
      library: { type: 'group', id: 1 },
      key: 'JKLM6543',
    })
    expect(parseZoteroRelationUri('https://api.zotero.org/users/999/items/ABCD1234?foo')).toEqual({
      library: { type: 'user', id: 999 },
      key: 'ABCD1234',
    })
    expect(parseZoteroRelationUri('https://example.com/users/0/items/ABCD1234')).toBeNull()
    expect(parseZoteroRelationUri('not a url')).toBeNull()
    expect(parseZoteroRelationUri('http://zotero.org/users/0/items/badkey')).toBeNull()
    expect(parseZoteroRelationUri('http://zotero.org/groups/1/collections/ABCD1234')).toBeNull()
    expect(parseZoteroRelationUri('ftp://zotero.org/users/0/items/ABCD1234')).toBeNull()
  })
  it('formatRef with group', () => {
    expect(
      formatRef({
        library: { type: 'group', id: 5 },
        kind: 'item',
        key: 'ABCD1234',
        serverId: 'S1',
      }),
    ).toBe('zotero://group/5/item/ABCD1234?server=S1')
  })
})

describe('normalize: relations and library context', () => {
  it('normalizeSearchItem with group library', () => {
    const item = normalizeSearchItem(
      { key: 'ABCD1234', data: { itemType: 'book', title: 'T' } },
      { library: { type: 'group', id: 42 }, serverId: 'S1' },
    )
    expect(item.ref).toBe('zotero://group/42/item/ABCD1234?server=S1')
  })
  it('normalizeItemDetail with relations: same group', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/groups/42/items/BBBB1234'] },
        },
      },
      library: { type: 'group', id: 42 },
      serverId: 'S1',
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(detail.relations).toEqual([
      {
        predicate: 'dc:relation',
        targetUri: 'http://zotero.org/groups/42/items/BBBB1234',
        targetRef: 'zotero://group/42/item/BBBB1234?server=S1',
      },
    ])
  })
  it('relations: different group -> no targetRef', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/groups/99/items/BBBB1234'] },
        },
      },
      library: { type: 'group', id: 42 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(detail.relations?.[0]?.targetRef).toBeUndefined()
    expect(detail.relations?.[0]?.targetUri).toBe('http://zotero.org/groups/99/items/BBBB1234')
  })
  it('relations: personal with id 0 maps', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/users/0/items/BBBB1234'] },
        },
      },
      library: { type: 'user', id: 0 },
      serverId: 'S1',
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations?.[0]?.targetRef).toBe('zotero://user/0/item/BBBB1234?server=S1')
  })
  it('relations: personal with real id matching parent library id', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        library: { type: 'user', id: 123 },
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/users/123/items/BBBB1234'] },
        },
      },
      library: { type: 'user', id: 0 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations?.[0]?.targetRef).toBe('zotero://user/0/item/BBBB1234')
  })
  it('relations: personal mismatch -> no targetRef', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        library: { type: 'user', id: 123 },
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/users/999/items/BBBB1234'] },
        },
      },
      library: { type: 'user', id: 0 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations?.[0]?.targetRef).toBeUndefined()
  })
  it('relations: external uri, malformed, unknown predicate', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: {
            'unknown:pred': [
              'https://doi.org/10.1234/abc',
              '',
              42 as unknown as string,
              'http://zotero.org/users/0/items/BBBB1234',
            ],
          },
        },
      },
      library: { type: 'user', id: 0 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations?.length).toBe(2)
    expect(d.relations?.[0]?.predicate).toBe('unknown:pred')
    expect(d.relations?.[0]?.targetUri).toBe('https://doi.org/10.1234/abc')
    expect(d.relations?.[0]?.targetRef).toBeUndefined()
  })
  it('relations: empty or absent', () => {
    const d1 = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d1.relations).toBeUndefined()
    const d2 = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T', relations: {} } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d2.relations).toBeUndefined()
    const d3 = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: 'bad' as unknown as Record<string, unknown>,
        },
      },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d3.relations).toBeUndefined()
  })
})
