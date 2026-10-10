/**
 * Zotero-parity search folding: the plugin's own matching has to fold text
 * exactly as `Zotero.Utilities.Internal.normalizeForSearch` does, or a query
 * the server's search answered stops matching inside the plugin.
 * @module tests/search-text
 */

import { describe, expect, it } from 'vitest'
import { normalizeForSearch } from '../../src/search-text.js'

describe('normalizeForSearch', () => {
  it('folds diacritics the way Zotero does', () => {
    // Lifted from Zotero's own docstring for the function this mirrors.
    expect(normalizeForSearch('séance')).toBe('seance')
    expect(normalizeForSearch('x²')).toBe('x2')
    expect(normalizeForSearch('café')).toBe('cafe')
    expect(normalizeForSearch('Ångström')).toBe('angstrom')
    // Combining marks arrive either precomposed or as separate code points.
    expect(normalizeForSearch('cafe\u0301')).toBe('cafe')
  })

  it('maps the letters NFKD leaves whole', () => {
    expect(normalizeForSearch('ø Œ æ Ł đ ð þ ß ı')).toBe('o oe ae l d d th ss i')
    expect(normalizeForSearch('1⁄2')).toBe('1/2')
  })

  it('folds typographic quotes and dashes to what a search is typed with', () => {
    expect(normalizeForSearch('children’s “quoted” ‘single’')).toBe(
      "children's \"quoted\" 'single'",
    )
    expect(normalizeForSearch('en–dash em—dash minus−sign')).toBe('en-dash em-dash minus-sign')
    // NFKD decomposes the double prime into two primes, and Zotero folds
    // single quotes first, so the mirrored order yields two apostrophes.
    expect(normalizeForSearch('prime″ and ′minute')).toBe("prime'' and 'minute")
  })

  it('recomposes kana and Hangul so a short form cannot match a longer one', () => {
    // NFKD splits が into か + dakuten; without the NFC step a search for か
    // would substring-match が.
    expect(normalizeForSearch('が')).toBe('が')
    expect(normalizeForSearch('한')).toBe('한')
  })

  it('folds non-ASCII case (Greek, Cyrillic) that a LIKE scan would not', () => {
    expect(normalizeForSearch('ΑΒΓ ΔΕ')).toBe('αβγ δε')
    expect(normalizeForSearch('ПРИВЕТ')).toBe('привет')
  })

  it('strips the formatting tags Zotero supports in fields', () => {
    expect(normalizeForSearch('H<i>2</i>O and <b>bold</b>')).toBe('h2o and bold')
    expect(normalizeForSearch('<span class="nocase">eDNA</span>')).toBe('edna')
    // Only that whitelist: a literal angle bracket stays searchable.
    expect(normalizeForSearch('a < b')).toBe('a < b')
    expect(normalizeForSearch('<em>kept</em>')).toBe('<em>kept</em>')
  })

  it('leaves ASCII text as its lowercase self', () => {
    expect(normalizeForSearch('FlashAttention-2')).toBe('flashattention-2')
    expect(normalizeForSearch('')).toBe('')
  })
})
