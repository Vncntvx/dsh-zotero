/**
 * The shared BibTeX field grammar: the key source the client's exports lens
 * compiles with `g`, and the brace/quote-aware field reader the host's entry
 * fingerprinting uses.
 * @module tests/export-items
 */

import { describe, expect, it } from 'vitest'
import { BIBTEX_KEY_SOURCE, bibtexFieldOf } from '../../src/export-items.js'

describe('BIBTEX_KEY_SOURCE', () => {
  it('captures the citation key of an entry header', () => {
    expect(BIBTEX_KEY_SOURCE).toBe('@[A-Za-z]+\\{([^,\\s{}]+),')
    // The client compiles the same source with `g` for `matchAll`; the host
    // compiles it without, so the string must carry no flags of its own.
    const scanned = new RegExp(BIBTEX_KEY_SOURCE, 'g')
    const keys = [...'@article{alpha,\n}\n@book{beta,\n}'.matchAll(scanned)].map((m) => m[1])
    expect(keys).toEqual(['alpha', 'beta'])
  })
})

describe('bibtexFieldOf', () => {
  it('reads braced values including nested braces, without unwrapping them', () => {
    // The reader returns the field's raw value: the outer pair delimits it, the
    // inner braces belong to the value (BibTeX case protection).
    expect(bibtexFieldOf('@article{k,\n  title = {{Nested {Braced} Value}},\n}', 'title')).toBe(
      '{Nested {Braced} Value}',
    )
  })

  it('reads quoted values', () => {
    expect(bibtexFieldOf('@article{k,\n  title = "Quoted title",\n}', 'title')).toBe('Quoted title')
  })

  it('reads bare numeric values', () => {
    expect(bibtexFieldOf('@article{k,\n  year = 2024,\n}', 'year')).toBe('2024')
  })

  it('keeps commas, braces, and spaces inside a braced value', () => {
    expect(bibtexFieldOf('@article{k,\n  author = {Doe, Jane and Smith, John},\n}', 'author')).toBe(
      'Doe, Jane and Smith, John',
    )
  })

  it('falls back to a generic pattern for a field outside the known set', () => {
    expect(bibtexFieldOf('@article{k,\n  keywords = {alignment, bibtex},\n}', 'keywords')).toBe(
      'alignment, bibtex',
    )
  })

  it('returns undefined for an absent field, an empty value, and unclosed values', () => {
    expect(bibtexFieldOf('@article{k,\n}\n', 'title')).toBeUndefined()
    expect(bibtexFieldOf('@article{k,\n  year = ,\n}\n', 'year')).toBeUndefined()
    expect(bibtexFieldOf('title = {Unclosed', 'title')).toBeUndefined()
    expect(bibtexFieldOf('title = "Unclosed', 'title')).toBeUndefined()
  })

  it('refuses a bare token when allowBareToken is false', () => {
    expect(bibtexFieldOf('@article{k,\n  title = 5,\n}', 'title', false)).toBeUndefined()
    expect(bibtexFieldOf('@article{k,\n  title = {Braced},\n}', 'title', false)).toBe('Braced')
  })
})
