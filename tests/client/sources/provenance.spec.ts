/**
 * Item identity and provenance rules of the session source model.
 * @module tests/client/sources/provenance
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeRefKey,
  provenanceOf,
  serverIdOf,
} from '../../../src/client/sources/provenance.ts'

describe('normalizeRefKey', () => {
  it('strips the query qualifier and lowercases', () => {
    expect(normalizeRefKey('zotero://user/0/item/ABCDEFGH?server=S1')).toBe(
      'zotero://user/0/item/abcdefgh',
    )
    expect(normalizeRefKey('zotero://user/0/item/ABCDEFGH')).toBe('zotero://user/0/item/abcdefgh')
  })

  it('keeps refs without a query unchanged apart from case', () => {
    expect(normalizeRefKey('zotero://user/0/attachment/WXYZ6789')).toBe(
      'zotero://user/0/attachment/wxyz6789',
    )
  })
})

describe('serverIdOf', () => {
  it('reads the server qualifier', () => {
    expect(serverIdOf('zotero://user/0/item/ABCDEFGH?server=S1')).toBe('S1')
  })

  it('returns undefined without a qualifier', () => {
    expect(serverIdOf('zotero://user/0/item/ABCDEFGH')).toBeUndefined()
  })

  it('ignores other query parameters and malformed qualifiers', () => {
    expect(serverIdOf('zotero://user/0/item/ABCDEFGH?foo=bar')).toBeUndefined()
    expect(serverIdOf('zotero://user/0/item/ABCDEFGH?server=S1&foo=bar')).toBe('S1')
  })
})

describe('provenanceOf', () => {
  it('is unknown without qualifiers or a current instance', () => {
    expect(provenanceOf(new Set(), 'S1')).toBe('unknown')
    expect(provenanceOf(new Set(['S1']), undefined)).toBe('unknown')
    expect(provenanceOf(new Set(), undefined)).toBe('unknown')
  })

  it('verifies when every qualifier matches the current instance', () => {
    expect(provenanceOf(new Set(['S1']), 'S1')).toBe('verified')
    expect(provenanceOf(new Set(['S1', 'S1']), 'S1')).toBe('verified')
  })

  it('fails closed on any mismatching qualifier', () => {
    expect(provenanceOf(new Set(['S2']), 'S1')).toBe('mismatch')
    expect(provenanceOf(new Set(['S1', 'S2']), 'S1')).toBe('mismatch')
  })
})
