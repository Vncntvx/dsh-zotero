import { describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_REF, ZoteroError } from '../src/errors.js'
import { formatRef, isRefString, localRef, parseRef, requireLocalRef } from '../src/refs.js'
import { ZOTERO_SORT_FIELDS } from '../src/constants.js'

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

describe('localRef', () => {
  it('builds a user/0 ref', () => {
    expect(localRef('item', 'ABCD1234')).toEqual({
      library: { type: 'user', id: 0 },
      kind: 'item',
      key: 'ABCD1234',
      serverId: undefined,
    })
  })

  it('rejects malformed keys', () => {
    expectRejected(() => localRef('item', 'nope'), ZOTERO_INVALID_REF, 'nope')
  })
})

describe('requireLocalRef', () => {
  it('passes a user/0 ref through unchanged', () => {
    const ref = parseRef('zotero://user/0/item/ABCD1234')
    expect(requireLocalRef(ref)).toBe(ref)
  })

  it('rejects group refs before any request happens', () => {
    expectRejected(
      () => requireLocalRef(parseRef('zotero://group/42/item/ABCD1234')),
      ZOTERO_INVALID_REF,
      'Group library references are not supported',
    )
  })

  it('rejects non-zero user ids', () => {
    expectRejected(
      () => requireLocalRef(parseRef('zotero://user/123/item/ABCD1234')),
      ZOTERO_INVALID_REF,
      'user/0',
    )
  })

  it('enforces a kind filter when given', () => {
    const ref = parseRef('zotero://user/0/collection/ABCD1234')
    expectRejected(() => requireLocalRef(ref, ['item']), ZOTERO_INVALID_REF, 'item')
    expect(requireLocalRef(ref, ['collection']).key).toBe('ABCD1234')
  })
})
