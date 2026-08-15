import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../src/errors.js'
import {
  extractAttachmentKey,
  matchScopeName,
  nearScopeCandidates,
  normalizeScopeEntry,
  normalizeSearchItem,
} from '../src/normalize.js'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

function expectUnexpected(fn: () => unknown): ZoteroError {
  let thrown: unknown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
  return thrown as ZoteroError
}

describe('normalizeSearchItem', () => {
  it('normalizes a full Zotero 10 item, including the best attachment link and server provenance', () => {
    const item = normalizeSearchItem(fixture('item10'), 'S1')
    expect(item).toEqual({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      title: 'FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning',
      creatorSummary: 'Dao, Tri',
      year: 2023,
      itemType: 'conferencePaper',
      bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      bestAttachmentType: 'application/pdf',
      attachmentSize: 1234567,
    })
  })

  it('omits the server qualifier when the instance reported none (pre-Zotero-10)', () => {
    const item = normalizeSearchItem(fixture('item-pre10'))
    expect(item.ref).toBe('zotero://user/0/item/EFGH5678')
    expect(item.bestAttachmentRef).toBeUndefined()
    expect(item.year).toBe(2017)
  })

  it('ignores unknown fields from future Zotero versions', () => {
    const item = normalizeSearchItem(fixture('item-extra-fields'), 'S2')
    expect(item.ref).toBe('zotero://user/0/item/MNOP3456?server=S2')
    expect(item.title).toBe('A Forward-Tolerant Record')
    expect(item.year).toBe(2020)
  })

  it('tolerates missing optional fields', () => {
    const item = normalizeSearchItem(fixture('item-minimal'))
    expect(item).toEqual({
      ref: 'zotero://user/0/item/QRST7890',
      title: '',
      creatorSummary: '',
      year: undefined,
      itemType: 'webpage',
      bestAttachmentRef: undefined,
      bestAttachmentType: undefined,
      attachmentSize: undefined,
    })
  })

  it('omits the year when parsedDate does not start with four digits', () => {
    const item = normalizeSearchItem({
      key: 'ABCD1234',
      meta: { parsedDate: 'n/a' },
      data: { itemType: 'book', title: 'Undated' },
    })
    expect(item.year).toBeUndefined()
    expect(item.title).toBe('Undated')
  })

  it('falls back to the top-level itemType when data.itemType is absent', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234', itemType: 'book', data: { title: 'Top Level Type' } })
    expect(item.itemType).toBe('book')
  })

  it('falls back to the top-level itemType when the data block is missing entirely', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234', itemType: 'book' })
    expect(item.itemType).toBe('book')
  })

  it('yields an empty itemType when neither level declares one', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234' })
    expect(item.itemType).toBe('')
  })

  it('fails loud when the key invariant is broken', () => {
    expectUnexpected(() => normalizeSearchItem({ key: 'nope', data: {} }))
    expectUnexpected(() => normalizeSearchItem({ data: { title: 'no key' } }))
    expectUnexpected(() => normalizeSearchItem(null))
  })
})

describe('extractAttachmentKey', () => {
  it('extracts an 8-character key from an attachment href', () => {
    expect(extractAttachmentKey('http://localhost:23119/api/users/0/items/WXYZ6789')).toBe('WXYZ6789')
    expect(extractAttachmentKey('https://api.zotero.org/users/1/items/WXYZ6789?format=json')).toBe('WXYZ6789')
  })

  it('returns undefined when no key is present', () => {
    expect(extractAttachmentKey('http://localhost:23119/api/users/0/items/not-a-key')).toBeUndefined()
    expect(extractAttachmentKey(undefined)).toBeUndefined()
  })
})

describe('normalizeScopeEntry', () => {
  it('reads the key and data name of a collection or saved search', () => {
    expect(normalizeScopeEntry({ key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } }))
      .toEqual({ key: 'COLL1234', name: 'LLM Papers' })
  })

  it('tolerates a missing name and rejects a broken key', () => {
    expect(normalizeScopeEntry({ key: 'SRCH1234', data: {} }).name).toBe('')
    expectUnexpected(() => normalizeScopeEntry({ key: 'nope', data: { name: 'x' } }))
  })
})

describe('matchScopeName', () => {
  const entries = [
    { key: 'AAAA1111', name: 'LLM' },
    { key: 'BBBB2222', name: 'LLMs' },
    { key: 'CCCC3333', name: 'Reasoning' },
  ]

  it('prefers an exact Unicode match', () => {
    expect(matchScopeName(entries, 'LLM')).toEqual({ exact: true, matched: [{ key: 'AAAA1111', name: 'LLM' }] })
    expect(matchScopeName(entries, 'LLMs')).toEqual({ exact: true, matched: [{ key: 'BBBB2222', name: 'LLMs' }] })
  })

  it('falls back to a case-insensitive match', () => {
    expect(matchScopeName(entries, 'llm')).toEqual({ exact: false, matched: [{ key: 'AAAA1111', name: 'LLM' }] })
  })

  it('returns every case-insensitive match and an empty list otherwise', () => {
    expect(matchScopeName(entries, 'reasoning')).toEqual({ exact: false, matched: [{ key: 'CCCC3333', name: 'Reasoning' }] })
    expect(matchScopeName(entries, 'vision')).toEqual({ exact: false, matched: [] })
  })
})

describe('nearScopeCandidates', () => {
  const entries = [
    { key: 'AAAA1111', name: 'LLM Papers 2026' },
    { key: 'BBBB2222', name: 'LLM Inference' },
    { key: 'CCCC3333', name: 'Speculative Decoding' },
  ]

  it('returns case-insensitive substring matches sorted by name length', () => {
    expect(nearScopeCandidates(entries, 'llm')).toEqual([
      { key: 'BBBB2222', name: 'LLM Inference' },
      { key: 'AAAA1111', name: 'LLM Papers 2026' },
    ])
  })

  it('respects the limit and returns nothing without matches', () => {
    expect(nearScopeCandidates(entries, 'llm', 1)).toEqual([{ key: 'BBBB2222', name: 'LLM Inference' }])
    expect(nearScopeCandidates(entries, 'quantization')).toEqual([])
  })

  it('orders equal-length matches by name', () => {
    const sameLength = [
      { key: 'AAAA1111', name: 'LLM Zoo' },
      { key: 'BBBB2222', name: 'LLM Ada' },
    ]
    expect(nearScopeCandidates(sameLength, 'llm')).toEqual([
      { key: 'BBBB2222', name: 'LLM Ada' },
      { key: 'AAAA1111', name: 'LLM Zoo' },
    ])
  })
})
