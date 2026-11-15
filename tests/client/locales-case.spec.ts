// @vitest-environment jsdom
/**
 * The product's own chapter titles are sentence case.
 *
 * The host's locale bundles write headings in sentence case, and a settings
 * page whose group titles are Title Case reads like a different product. This
 * scan holds the navigation tabs and the settings group headings — the copy a
 * reader meets before any content — to that rule, with a proper-noun list for
 * the product and service names that always carry a capital.
 *
 * Values the panel only quotes from another surface (Zotero's own menu items,
 * the plugin manager's "Included components") are exempt: their capitalization
 * belongs to that surface. So is the Zotero item-type vocabulary, whose names
 * mirror Zotero's catalogue.
 * @module tests/client/locales-case
 */

import { describe, expect, it } from 'vitest'
import { en } from '../../src/client/locales.ts'
import { itemTypeEn } from '../../src/client/library-item-type-locales.ts'

/**
 * Keys whose value is a chapter title: the navigation tabs and settings
 * groups. Their `…Desc` / `…Hint` / `…Note` siblings are prose, not headings,
 * and may name products mid-sentence.
 */
const HEADING_KEY = /^(?:tab|group)[A-Z][\w]*$/
const PROSE_KEY = /(?:Desc|Hint|Note)$/

/** Capitalized labels a heading may quote verbatim or name. */
const PROPER_NOUNS = new Set([
  'Zotero',
  'MinerU',
  'Markdown',
  'BibTeX',
  'BibLaTeX',
  'LaTeX',
  'CSL',
  'JSON',
  'DOI',
  'DOIs',
  'ISBN',
  'arXiv',
  'OpenAlex',
  'Crossref',
  'Semantic',
  'Scholar',
  'PubMed',
  'Europe',
  'PMC',
  'DBLP',
  'Unpaywall',
  'Google',
  'GitHub',
  'macOS',
  'Windows',
  'Linux',
  'WSL',
])

/** The item-type vocabulary is data, not copy. */
const EXCLUDED = new Set(Object.keys(itemTypeEn))

/**
 * Every interior capitalized word of one heading, ignoring quoted spans and
 * placeholders: the first word of a heading is the sentence's start.
 */
function capitalizedWordsIn(value: string): string[] {
  const withoutQuotes = value
    .replace(/`[^`]*`/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\{[a-z]+\}/g, ' ')
  const words = withoutQuotes.split(/[\s—–:;,()&/]+/).filter((word) => word !== '')
  return words
    .slice(1)
    .filter((word) => /^[A-Z][a-z]/.test(word))
    .filter((word) => !PROPER_NOUNS.has(word))
}

describe('English locale copy', () => {
  it('writes the navigation tabs and settings group headings in sentence case', () => {
    const offenders: string[] = []
    for (const [key, value] of Object.entries(en)) {
      if (EXCLUDED.has(key) || PROSE_KEY.test(key) || !HEADING_KEY.test(key)) continue
      const found = capitalizedWordsIn(value)
      if (found.length > 0) offenders.push(`${key}: ${JSON.stringify(found)} in "${value}"`)
    }
    expect(offenders).toEqual([])
  })

  it('spells the compound as "full-text" in prose', () => {
    // Identifiers (`mode="fulltext"`, `fulltextWindowChars`) keep the one-word
    // spelling; the prose a reader meets does not.
    const offenders = Object.entries(en)
      .filter(([key]) => !EXCLUDED.has(key))
      .filter(([, value]) => /\bfulltext\b(?!["-])/.test(value))
      .map(([key, value]) => `${key}: "${value}"`)
    expect(offenders).toEqual([])
  })
})
