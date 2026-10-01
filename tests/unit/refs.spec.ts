import { describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_REF, ZOTERO_UNEXPECTED, ZoteroError } from '../../src/errors.js'
import {
  formatRef,
  formatZoteroRelationUri,
  isRefString,
  isSupportedLocalLibrary,
  libraryPrefix,
  parseRef,
  parseZoteroRelationUri,
  PERSONAL_GROUPS_DISCOVERY,
  PERSONAL_LIBRARY,
  refForLibrary,
  relationTargetRef,
  requireSupportedLibraryOfRef,
  requireSupportedLocalRef,
} from '../../src/refs.js'
import { ZOTERO_SORT_FIELDS } from '../../src/constants.js'

function expectInvalidRef(value: string, messagePart?: string): void {
  let thrown: unknown
  try {
    parseRef(value)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  expect((thrown as ZoteroError).code).toBe(ZOTERO_INVALID_REF)
  expect((thrown as ZoteroError).message).toContain(value)
  if (messagePart !== undefined) expect((thrown as ZoteroError).message).toContain(messagePart)
}

function expectRejected(fn: () => unknown, code: string, messagePart?: string): ZoteroError {
  let thrown: unknown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  const zoteroError = thrown as ZoteroError
  expect(zoteroError.code).toBe(code)
  if (messagePart !== undefined) expect(zoteroError.message).toContain(messagePart)
  return zoteroError
}

describe('parseRef', () => {
  it('parses a plain user-library item ref without a server qualifier', () => {
    expect(parseRef('zotero://user/0/item/ABCD1234')).toEqual({
      library: { type: 'user', id: 0 },
      kind: 'item',
      key: 'ABCD1234',
      serverId: undefined,
    })
  })

  it('parses every object kind', () => {
    expect(parseRef('zotero://user/0/attachment/EFGH5678').kind).toBe('attachment')
    expect(parseRef('zotero://user/0/annotation/IJKL9012').kind).toBe('annotation')
    expect(parseRef('zotero://user/0/collection/MNOP3456').kind).toBe('collection')
    expect(parseRef('zotero://user/0/search/QRST7890').kind).toBe('search')
  })

  it('parses a server provenance qualifier', () => {
    expect(parseRef('zotero://user/0/item/ABCD1234?server=sPMHtLD6HHBd')).toEqual({
      library: { type: 'user', id: 0 },
      kind: 'item',
      key: 'ABCD1234',
      serverId: 'sPMHtLD6HHBd',
    })
  })

  it('accepts group libraries and non-zero user ids in the grammar (provider gates them later)', () => {
    expect(parseRef('zotero://group/42/collection/ABCD1234').library).toEqual({
      type: 'group',
      id: 42,
    })
    expect(parseRef('zotero://user/123/item/ABCD1234').library).toEqual({ type: 'user', id: 123 })
  })

  it('rejects strings outside the grammar', () => {
    expectInvalidRef('zotero://user/0/item/abcd1234') // lowercase key
    expectInvalidRef('zotero://user/0/item/ABCD123') // 7-char key
    expectInvalidRef('zotero://user/0/item/ABCD12345') // 9-char key
    expectInvalidRef('zotero://user/0/paper/ABCD1234') // unknown kind
    expectInvalidRef('zotero://user/x/item/ABCD1234') // non-numeric id
    expectInvalidRef('zotero://user//item/ABCD1234') // missing id
    expectInvalidRef('zotero://library/0/item/ABCD1234') // unknown library type
    expectInvalidRef('zotero:user/0/item/ABCD1234') // wrong scheme form
    expectInvalidRef('zotero://user/0/item/ABCD1234/extra') // trailing segment
    expectInvalidRef('zotero://user/0/item/ABCD1234?server=') // empty server id
    expectInvalidRef('zotero://user/0/item/ABCD1234?server=bad!id') // illegal server character
    expectInvalidRef('zotero://user/0/item/ABCD1234?server=' + 'a'.repeat(65)) // server id too long
    expectInvalidRef('zotero://user/0/item/ABCD1234?server=x&other=1') // extra query params
  })
})

describe('formatRef', () => {
  it('round-trips plain refs', () => {
    const value = 'zotero://user/0/item/ABCD1234'
    expect(formatRef(parseRef(value))).toBe(value)
  })

  it('round-trips refs with a server qualifier', () => {
    const value = 'zotero://user/0/item/ABCD1234?server=sPMHtLD6HHBd'
    expect(formatRef(parseRef(value))).toBe(value)
  })

  it('formats a server qualifier onto a parsed ref', () => {
    expect(
      formatRef({
        library: { type: 'user', id: 0 },
        kind: 'item',
        key: 'ABCD1234',
        serverId: 'S1',
      }),
    ).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })

  it('formats a group library with its own prefix', () => {
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

describe('library identity', () => {
  it('accepts only the canonical personal library and positive group ids', () => {
    expect(isSupportedLocalLibrary({ type: 'user', id: 0 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'group', id: 1 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'group', id: 42 })).toBe(true)
    expect(isSupportedLocalLibrary({ type: 'user', id: 1 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: 0 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: -5 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'group', id: 3.5 })).toBe(false)
    expect(isSupportedLocalLibrary({ type: 'unknown' as unknown as 'user', id: 0 })).toBe(false)
  })

  it('names the API prefix of each supported library', () => {
    expect(libraryPrefix({ type: 'user', id: 0 })).toBe('users/0')
    expect(libraryPrefix({ type: 'group', id: 99 })).toBe('groups/99')
    expect(PERSONAL_LIBRARY).toEqual({ type: 'user', id: 0 })
    expect(PERSONAL_GROUPS_DISCOVERY).toBe('users/0/groups')
  })

  it('builds a ref for a supported library and refuses the rest', () => {
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
    expectRejected(
      () => refForLibrary({ type: 'user', id: 123 }, 'item', 'ABCD1234'),
      ZOTERO_INVALID_REF,
    )
    expectRejected(
      () => refForLibrary({ type: 'group', id: 0 }, 'item', 'ABCD1234'),
      ZOTERO_INVALID_REF,
    )
  })
})

describe('parseZoteroRelationUri', () => {
  it('reads the library and key from every spelling Zotero serves, and nothing else', () => {
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
    // A foreign host, a non-URL, a malformed key, a non-item kind and a
    // non-HTTP scheme are all "no relation" rather than a guessed target.
    expect(parseZoteroRelationUri('https://example.com/users/0/items/ABCD1234')).toBeNull()
    expect(parseZoteroRelationUri('not a url')).toBeNull()
    expect(parseZoteroRelationUri('http://zotero.org/users/0/items/badkey')).toBeNull()
    expect(parseZoteroRelationUri('http://zotero.org/groups/1/collections/ABCD1234')).toBeNull()
    expect(parseZoteroRelationUri('ftp://zotero.org/users/0/items/ABCD1234')).toBeNull()
  })
})

describe('formatZoteroRelationUri', () => {
  it('pins the user arm to users/0 and names groups by id', () => {
    expect(formatZoteroRelationUri({ library: { type: 'user', id: 0 }, key: 'ABCD1234' })).toBe(
      'http://zotero.org/users/0/items/ABCD1234',
    )
    expect(formatZoteroRelationUri({ library: { type: 'group', id: 42 }, key: 'ABCD1234' })).toBe(
      'http://zotero.org/groups/42/items/ABCD1234',
    )
  })
})

describe('requireSupportedLibraryOfRef', () => {
  it('passes supported local refs through and refuses the rest with the scope message', () => {
    expect(requireSupportedLibraryOfRef('zotero://user/0/collection/ABCD1234')).toEqual({
      type: 'user',
      id: 0,
    })
    let thrown: unknown
    try {
      requireSupportedLibraryOfRef('zotero://user/7/collection/ABCD1234')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
    expect((thrown as ZoteroError).message).toContain(
      'Resolved scope carries a ref outside the local contract',
    )
  })
})

describe('relationTargetRef', () => {
  it('maps canonical user ids and same-library groups, never foreign users', () => {
    expect(relationTargetRef('http://zotero.org/users/0/items/ABCD1234', 'S1')).toBe(
      'zotero://user/0/item/ABCD1234?server=S1',
    )
    expect(
      relationTargetRef('http://zotero.org/groups/42/items/ABCD1234', 'S1', {
        library: { type: 'group', id: 42 },
      }),
    ).toBe('zotero://group/42/item/ABCD1234?server=S1')
    // Another group stays bare: a target ref never implies foreign locality.
    expect(
      relationTargetRef('http://zotero.org/groups/99/items/ABCD1234', 'S1', {
        library: { type: 'group', id: 42 },
      }),
    ).toBeUndefined()
    // A foreign user id stays bare without proof — it would resolve the same
    // key against the wrong library.
    expect(relationTargetRef('http://zotero.org/users/987654/items/ABCD1234', 'S1')).toBeUndefined()
    expect(relationTargetRef('not a uri', 'S1')).toBeUndefined()
    // A URI whose key breaks the object-key grammar, or a group id that is
    // not a positive integer, is unprovable by definition.
    expect(relationTargetRef('http://zotero.org/users/0/items/short', 'S1')).toBeUndefined()
    expect(relationTargetRef('http://zotero.org/groups/0/items/ABCD1234', 'S1')).toBeUndefined()
  })

  it('maps the sync alias when the caller proves the personal context', () => {
    // The write echo only ever sends users/0: any users/<id> in it is the
    // server-side canonicalization of that same personal library.
    expect(
      relationTargetRef('http://zotero.org/users/987654/items/ABCD1234', 'S1', {
        personalContext: true,
      }),
    ).toBe('zotero://user/0/item/ABCD1234?server=S1')
    // A read proves the alias through the record's real library id.
    expect(
      relationTargetRef('http://zotero.org/users/123/items/ABCD1234', undefined, {
        library: { type: 'user', id: 0 },
        parentLibraryId: 123,
      }),
    ).toBe('zotero://user/0/item/ABCD1234')
    expect(
      relationTargetRef('http://zotero.org/users/999/items/ABCD1234', undefined, {
        library: { type: 'user', id: 0 },
        parentLibraryId: 123,
      }),
    ).toBeUndefined()
  })
})

describe('isRefString', () => {
  it('recognizes valid ref strings only', () => {
    expect(isRefString('zotero://user/0/item/ABCD1234')).toBe(true)
    expect(isRefString('zotero://user/0/item/ABCD1234?server=x')).toBe(true)
    expect(isRefString('ABCD1234')).toBe(false)
    expect(isRefString('zotero://user/0/item/abcd1234')).toBe(false)
  })
})

describe('sort vocabulary', () => {
  it('pins the sort fields Zotero accepts', () => {
    expect(ZOTERO_SORT_FIELDS).toEqual(['dateModified', 'dateAdded', 'date', 'title', 'creator'])
  })
})

describe('requireSupportedLocalRef', () => {
  it('passes a supported local ref through unchanged', () => {
    const ref = parseRef('zotero://user/0/item/ABCD1234')
    expect(requireSupportedLocalRef(ref)).toBe(ref)
  })

  it('rejects non-zero user ids with the canonical-ref hint', () => {
    expectRejected(
      () => requireSupportedLocalRef(parseRef('zotero://user/123/item/ABCD1234')),
      ZOTERO_INVALID_REF,
      'zotero://user/0/item/ABCD1234',
    )
  })

  it('rejects an unknown library type even when the object shape parses', () => {
    expectRejected(
      () =>
        requireSupportedLocalRef({
          library: { type: 'unknown' as unknown as 'user', id: 0 },
          kind: 'item',
          key: 'ABCD1234',
        }),
      ZOTERO_INVALID_REF,
    )
  })

  it('accepts a group library the grammar parsed', () => {
    const ref = parseRef('zotero://group/5/item/ABCD1234')
    expect(requireSupportedLocalRef(ref)).toBe(ref)
  })

  it('refuses a parsed ref whose kind the caller does not accept', () => {
    expectRejected(
      () => requireSupportedLocalRef(parseRef('zotero://user/0/collection/COLL1234'), ['item']),
      ZOTERO_INVALID_REF,
    )
  })
})
