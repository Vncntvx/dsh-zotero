/**
 * Library-scope projection specs: `normalizeScopeEntry` and its name
 * matching (`matchScopeName`, `nearScopeCandidates`), plus the item-side
 * field readers `normalizeCreators`, `normalizeVenue`, and `collectionKeysOf`.
 * @module tests/unit/normalize-scope
 */

import { describe, expect, it } from 'vitest'
import {
  collectionKeysOf,
  formatCreatorDisplayName,
  matchScopeName,
  nearScopeCandidates,
  normalizeCreators,
  normalizeScopeEntry,
  normalizeVenue,
} from '../../src/normalize.js'
import { expectUnexpected } from './normalize-helpers.js'

describe('normalizeScopeEntry', () => {
  it('reads the key and data name of a collection or saved search', () => {
    expect(
      normalizeScopeEntry({
        key: 'COLL1234',
        version: 1,
        data: { key: 'COLL1234', version: 1, name: 'LLM Papers' },
      }),
    ).toEqual({ key: 'COLL1234', name: 'LLM Papers' })
  })

  it('tolerates a missing name and rejects a broken key', () => {
    expect(normalizeScopeEntry({ key: 'SRCH1234', data: {} }).name).toBe('')
    expectUnexpected(() => normalizeScopeEntry({ key: 'nope', data: { name: 'x' } }))
  })

  it('defaults a missing collection name to an empty string', () => {
    expect(normalizeScopeEntry({ key: 'COLL1234' })).toEqual({ key: 'COLL1234', name: '' })
  })
})

describe('matchScopeName', () => {
  const entries = [
    { key: 'AAAA1111', name: 'LLM' },
    { key: 'BBBB2222', name: 'LLMs' },
    { key: 'CCCC3333', name: 'Reasoning' },
  ]

  it('prefers an exact Unicode match', () => {
    expect(matchScopeName(entries, 'LLM')).toEqual([{ key: 'AAAA1111', name: 'LLM' }])
    expect(matchScopeName(entries, 'LLMs')).toEqual([{ key: 'BBBB2222', name: 'LLMs' }])
  })

  it('falls back to a case-insensitive match', () => {
    expect(matchScopeName(entries, 'llm')).toEqual([{ key: 'AAAA1111', name: 'LLM' }])
  })

  it('returns every case-insensitive match and an empty list otherwise', () => {
    expect(matchScopeName(entries, 'reasoning')).toEqual([{ key: 'CCCC3333', name: 'Reasoning' }])
    expect(matchScopeName(entries, 'vision')).toEqual([])
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
    expect(nearScopeCandidates(entries, 'llm', 1)).toEqual([
      { key: 'BBBB2222', name: 'LLM Inference' },
    ])
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

describe('normalizeCreators', () => {
  it('formats name-field creators and first/last pairs, skipping empties', () => {
    expect(
      normalizeCreators({
        creators: [
          { creatorType: 'author', firstName: 'Tri', lastName: 'Dao' },
          { creatorType: 'author', firstName: '', lastName: 'Fu' },
          { creatorType: 'editor', name: 'OpenAI Research' },
        ],
      }),
    ).toEqual([
      { creatorType: 'author', firstName: 'Tri', lastName: 'Dao' },
      { creatorType: 'author', lastName: 'Fu' },
      { creatorType: 'editor', name: 'OpenAI Research' },
    ])
  })

  it('returns an empty list when creators are absent or not an array', () => {
    expect(normalizeCreators(undefined)).toEqual([])
    expect(normalizeCreators({ creators: 'nope' })).toEqual([])
  })

  it('skips rows that are not creator records instead of failing the item', () => {
    expect(
      normalizeCreators({ creators: [null, 42, { creatorType: 'author', name: 'Real' }] }),
    ).toEqual([{ creatorType: 'author', name: 'Real' }])
  })

  it('fills missing first or last names from the other field', () => {
    expect(normalizeCreators({ creators: [{ creatorType: 'author', lastName: 'Dao' }] })).toEqual([
      { creatorType: 'author', lastName: 'Dao' },
    ])
    expect(normalizeCreators({ creators: [{ creatorType: 'author', firstName: 'Tri' }] })).toEqual([
      { creatorType: 'author', firstName: 'Tri' },
    ])
  })
})

describe('formatCreatorDisplayName', () => {
  it('formats creators with role suffixes and first/last names', () => {
    expect(formatCreatorDisplayName({ creatorType: 'author', name: 'OpenAI' })).toBe('OpenAI')
    expect(formatCreatorDisplayName({ creatorType: 'editor', name: 'OpenAI' })).toBe(
      'OpenAI (editor)',
    )
    expect(
      formatCreatorDisplayName({ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }),
    ).toBe('Tri Dao')
    expect(formatCreatorDisplayName({ creatorType: 'translator', lastName: 'Dao' })).toBe(
      'Dao (translator)',
    )
    expect(formatCreatorDisplayName({ creatorType: 'author' })).toBe('')
  })
})

describe('normalizeVenue', () => {
  it('picks the first available publication venue', () => {
    expect(normalizeVenue({ publicationTitle: 'ICML' })).toBe('ICML')
    expect(normalizeVenue({ proceedingsTitle: 'Proceedings' })).toBe('Proceedings')
    expect(normalizeVenue({ bookTitle: 'A Book' })).toBe('A Book')
    expect(normalizeVenue({ journalAbbreviation: 'JMLR' })).toBe('JMLR')
    expect(normalizeVenue({ conferenceName: 'NeurIPS' })).toBe('NeurIPS')
    expect(normalizeVenue({})).toBeUndefined()
  })

  it('prefers the earlier venue fields when several are present', () => {
    // The priority order is Zotero's own: publicationTitle wins over the
    // book-level and conference fields, proceedings over bookTitle. A
    // reordering of the field list must change which one is reported.
    expect(
      normalizeVenue({
        publicationTitle: 'ICML',
        bookTitle: 'A Book',
        conferenceName: 'NeurIPS',
      }),
    ).toBe('ICML')
    expect(normalizeVenue({ proceedingsTitle: 'Proceedings', bookTitle: 'A Book' })).toBe(
      'Proceedings',
    )
  })
})

describe('collectionKeysOf', () => {
  it('reads collection keys from the data block', () => {
    expect(collectionKeysOf({ data: { collections: ['COLL1234', 'COLL5678'] } })).toEqual([
      'COLL1234',
      'COLL5678',
    ])
    expect(collectionKeysOf({ data: {} })).toEqual([])
    expect(collectionKeysOf({ data: { collections: 'nope' } })).toEqual([])
  })
})
