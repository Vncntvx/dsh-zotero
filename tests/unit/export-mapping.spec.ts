/**
 * The in-memory ref → batch-entry mapping: body splitting with text spans,
 * key/mention/1×1-fallback pairing for BibTeX/BibLaTeX, identity matching
 * for RIS and CSL JSON, and bare refs for entries that cannot be located.
 * @module tests/export-mapping
 */

import { describe, expect, it } from 'vitest'
import {
  locateExportItemsFromBatch,
  splitBibtexEntries,
  splitRisRecords,
} from '../../src/export-mapping.js'
import { parseRef } from '../../src/refs.js'

const R1 = 'zotero://user/0/item/AAAAAAA1'
const R2 = 'zotero://user/0/item/BBBBBBBB'

describe('splitBibtexEntries', () => {
  it('splits entries with their keys and text spans', () => {
    const text =
      '@article{batchKeyOne,\n  title = {One},\n}\n\n@article{batchKeyTwo,\n  title = {Two},\n}\n'
    const entries = splitBibtexEntries(text)
    const secondStart = text.indexOf('@article{batchKeyTwo,')
    expect(entries).toEqual([
      {
        key: 'batchKeyOne',
        start: 0,
        end: secondStart,
        text: '@article{batchKeyOne,\n  title = {One},\n}',
      },
      {
        key: 'batchKeyTwo',
        start: secondStart,
        end: text.length,
        text: '@article{batchKeyTwo,\n  title = {Two},\n}',
      },
    ])
  })

  it('keeps inter-entry % comments out of the previous entry body', () => {
    const text =
      '@article{batchKeyOne,\n  title = {One},\n}\n% a comment between entries\n@article{batchKeyTwo,\n  title = {Two},\n}\n'
    const entries = splitBibtexEntries(text)
    const secondStart = text.indexOf('@article{batchKeyTwo,')
    expect(entries).toEqual([
      {
        key: 'batchKeyOne',
        start: 0,
        end: secondStart,
        // Body alone: the trailing `%` comment is not part of the entry text.
        text: '@article{batchKeyOne,\n  title = {One},\n}',
      },
      {
        key: 'batchKeyTwo',
        start: secondStart,
        end: text.length,
        text: '@article{batchKeyTwo,\n  title = {Two},\n}',
      },
    ])
  })

  it('returns nothing for a body without parseable entries', () => {
    expect(splitBibtexEntries('plain text')).toEqual([])
    expect(splitBibtexEntries('')).toEqual([])
  })

  it('ignores @type{key, shapes inside field values and nested braces', () => {
    const text =
      '@article{doe2020,\n  title = {{A {nested} @book{b1, title}}},\n  note = {See @article{smith1999, for details},\n}\n'
    const entries = splitBibtexEntries(text)
    expect(entries).toEqual([
      {
        key: 'doe2020',
        start: 0,
        end: text.length,
        text: '@article{doe2020,\n  title = {{A {nested} @book{b1, title}}},\n  note = {See @article{smith1999, for details},\n}',
      },
    ])
  })

  it('treats quoted strings as opaque, braces inside them never split an entry', () => {
    const text = '@article{keyA,\n  note = "A {b} @book{x, y} c",\n}\n'
    const entries = splitBibtexEntries(text)
    expect(entries).toEqual([
      {
        key: 'keyA',
        start: 0,
        end: text.length,
        text: '@article{keyA,\n  note = "A {b} @book{x, y} c",\n}',
      },
    ])
  })

  it('keeps @comment and @string bodies as entries without disturbing the real ones', () => {
    const text =
      '@comment{jabref-meta: databaseType:bibtex;}\n@string{jour = {Nature}}\n@article{keyB,\n  title = {B},\n}\n'
    const articleStart = text.indexOf('@article{keyB,')
    const entries = splitBibtexEntries(text)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      key: 'jabref-meta:',
      start: 0,
      end: text.indexOf('@string{'),
      text: '@comment{jabref-meta: databaseType:bibtex;}',
    })
    expect(entries[1]).toEqual({
      key: 'jour',
      start: text.indexOf('@string{'),
      end: articleStart,
      text: '@string{jour = {Nature}}',
    })
    expect(entries[2]).toEqual({
      key: 'keyB',
      start: articleStart,
      end: text.length,
      text: '@article{keyB,\n  title = {B},\n}',
    })
  })

  it('splits CRLF bodies with the same spans', () => {
    const text = '@article{a,\r\n  title = {A},\r\n}\r\n@article{b,\r\n  title = {B},\r\n}\r\n'
    const secondStart = text.indexOf('@article{b,')
    const entries = splitBibtexEntries(text)
    expect(entries).toEqual([
      { key: 'a', start: 0, end: secondStart, text: '@article{a,\r\n  title = {A},\r\n}' },
      {
        key: 'b',
        start: secondStart,
        end: text.length,
        text: '@article{b,\r\n  title = {B},\r\n}',
      },
    ])
  })

  it('keeps an entry whose key is empty', () => {
    const text = '@article{,\n  title = {No key},\n}\n'
    const entries = splitBibtexEntries(text)
    expect(entries).toEqual([
      { start: 0, end: text.length, text: '@article{,\n  title = {No key},\n}' },
    ])
  })
})

describe('splitRisRecords', () => {
  const TEXT = 'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n\nTY  - JOUR\nTI  - Two\nID  - K2\nER  -\n'

  it('splits records with their ids and text spans through the terminator', () => {
    const records = splitRisRecords(TEXT)
    const secondStart = TEXT.indexOf('TY  - JOUR\nTI  - Two')
    expect(records).toEqual([
      {
        key: 'K1',
        start: 0,
        end: secondStart,
        text: 'TY  - JOUR\nTI  - One\nID  - K1\nER  -',
      },
      {
        key: 'K2',
        start: secondStart,
        end: TEXT.length,
        text: 'TY  - JOUR\nTI  - Two\nID  - K2\nER  -',
      },
    ])
  })

  it('round-trips the body from its record slices, each ending at its terminator', () => {
    const records = splitRisRecords(TEXT)
    expect(records.map((record) => TEXT.slice(record.start, record.end)).join('')).toBe(TEXT)
    for (const record of records) {
      expect(record.text.endsWith('ER  -')).toBe(true)
    }
  })

  it('handles CRLF line endings', () => {
    const text =
      'TY  - JOUR\r\nTI  - One\r\nID  - K1\r\nER  -\r\n\r\nTY  - JOUR\r\nTI  - Two\r\nID  - K2\r\nER  -\r\n'
    const secondStart = text.indexOf('TY  - JOUR\r\nTI  - Two')
    const records = splitRisRecords(text)
    expect(records).toEqual([
      {
        key: 'K1',
        start: 0,
        end: secondStart,
        text: 'TY  - JOUR\r\nTI  - One\r\nID  - K1\r\nER  -',
      },
      {
        key: 'K2',
        start: secondStart,
        end: text.length,
        text: 'TY  - JOUR\r\nTI  - Two\r\nID  - K2\r\nER  -',
      },
    ])
  })

  it('keeps a trailing-space terminator and a final record without a newline', () => {
    const text = 'TY  - JOUR\nID  - K1\nER  - \nTY  - JOUR\nID  - K2\nER  -'
    const secondStart = text.indexOf('TY  - JOUR\nID  - K2')
    const records = splitRisRecords(text)
    expect(records).toEqual([
      { key: 'K1', start: 0, end: secondStart, text: 'TY  - JOUR\nID  - K1\nER  -' },
      { key: 'K2', start: secondStart, end: text.length, text: 'TY  - JOUR\nID  - K2\nER  -' },
    ])
  })

  it('skips multiple blank lines between records', () => {
    const text = 'TY  - JOUR\nID  - K1\nER  -\n\n\nTY  - JOUR\nID  - K2\nER  -\n'
    const secondStart = text.indexOf('TY  - JOUR\nID  - K2')
    const records = splitRisRecords(text)
    expect(records).toEqual([
      { key: 'K1', start: 0, end: secondStart, text: 'TY  - JOUR\nID  - K1\nER  -' },
      { key: 'K2', start: secondStart, end: text.length, text: 'TY  - JOUR\nID  - K2\nER  -' },
    ])
  })

  it('handles a trailing record without a terminator', () => {
    const text = 'TY  - JOUR\nID  - K1\nER  -\n\nTY  - JOUR\nTI  - Two\nID  - K2\n'
    const secondStart = text.indexOf('TY  - JOUR\nTI  - Two')
    const records = splitRisRecords(text)
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      key: 'K1',
      start: 0,
      end: secondStart,
      text: 'TY  - JOUR\nID  - K1\nER  -',
    })
    expect(records[1]).toEqual({
      key: 'K2',
      start: secondStart,
      end: text.length,
      text: 'TY  - JOUR\nTI  - Two\nID  - K2',
    })
  })

  it('keeps a non-blank tail without a trailing newline', () => {
    const text = 'TY  - JOUR\nID  - K1\nER  -\njunk'
    const junkStart = text.indexOf('junk')
    const records = splitRisRecords(text)
    expect(records).toEqual([
      { key: 'K1', start: 0, end: junkStart, text: 'TY  - JOUR\nID  - K1\nER  -' },
      { key: undefined, start: junkStart, end: text.length, text: 'junk' },
    ])
  })

  it('keeps records without an id', () => {
    const text = 'TY  - JOUR\nTI  - No id\nER  -\n'
    const records = splitRisRecords(text)
    expect(records).toEqual([
      { start: 0, end: text.length, text: 'TY  - JOUR\nTI  - No id\nER  -' },
    ])
    expect(splitRisRecords('')).toEqual([])
  })
})

describe('locateExportItemsFromBatch', () => {
  const ref1 = parseRef(R1)
  const ref2 = parseRef(R2)

  it('matches BibTeX entries by key, mention, or positional fallback', () => {
    // 1. Direct key match
    const directText = '@article{AAAAAAA1,\n  title = {Paper One},\n}\n'
    const direct = locateExportItemsFromBatch('bibtex', directText, [ref1])
    expect(direct).toEqual([
      {
        ref: R1,
        title: 'Paper One',
        key: 'AAAAAAA1',
        start: 0,
        end: directText.length,
      },
    ])

    // 2. Mention match (key is custom citekey, but body mentions item key)
    const mentionText = '@article{customCitekey,\n  title = {Paper One},\n  note = {AAAAAAA1},\n}\n'
    const mention = locateExportItemsFromBatch('bibtex', mentionText, [ref1])
    expect(mention).toEqual([
      {
        ref: R1,
        title: 'Paper One',
        key: 'customCitekey',
        start: 0,
        end: mentionText.length,
      },
    ])

    // 3. Positional fallback when count matches and no key/mention matched
    const posText = '@article{unrelated,\n  title = {Paper Pos},\n}\n'
    const pos = locateExportItemsFromBatch('bibtex', posText, [ref1])
    expect(pos).toEqual([
      {
        ref: R1,
        title: 'Paper Pos',
        key: 'unrelated',
        start: 0,
        end: posText.length,
      },
    ])

    // 4. Unlocated when entries length does not match refs
    const unlocated = locateExportItemsFromBatch('bibtex', '@article{unrelated,\n}\n', [ref1, ref2])
    expect(unlocated).toEqual([{ ref: R1 }, { ref: R2 }])
  })

  it('matches RIS records by ID and falls back gracefully', () => {
    const risText = 'TY  - JOUR\nTI  - One\nID  - AAAAAAA1\nER  -\n'
    const items = locateExportItemsFromBatch('ris', risText, [ref1, ref2])
    expect(items).toEqual([
      {
        ref: R1,
        title: 'One',
        key: 'AAAAAAA1',
        start: 0,
        end: risText.length,
      },
      { ref: R2 },
    ])
  })

  it('matches CSL-JSON records by bare ID or URI', () => {
    const cslText = JSON.stringify([
      { id: 'AAAAAAA1', title: 'Paper 1' },
      { id: 'http://zotero.org/users/0/items/BBBBBBBB', title: 'Paper 2' },
    ])
    const items = locateExportItemsFromBatch('csljson', cslText, [ref1, ref2])
    expect(items).toEqual([
      { ref: R1, title: 'Paper 1', key: 'AAAAAAA1', entryIndex: 0 },
      { ref: R2, title: 'Paper 2', key: 'http://zotero.org/users/0/items/BBBBBBBB', entryIndex: 1 },
    ])

    // Malformed JSON falls back gracefully
    const broken = locateExportItemsFromBatch('csljson', 'not json', [ref1])
    expect(broken).toEqual([{ ref: R1 }])

    // Non-object or non-matching records in JSON array
    const mixed = locateExportItemsFromBatch(
      'csljson',
      JSON.stringify([null, 42, 'string', [], { other: 1 }, { id: 'AAAAAAA1' }]),
      [ref1],
    )
    expect(mixed).toEqual([{ ref: R1, key: 'AAAAAAA1', entryIndex: 5 }])
  })

  it('never equates a key with a longer token containing it', () => {
    // XAAAAAAA1 contains AAAAAAA1 as a substring but not as a whole token:
    // mention matching must not claim the entry, and with 1 ref / 1 entry
    // the 1×1 fallback still applies (unambiguous) — the token rule only
    // decides priority between entries, never locateability itself.
    const text = '@article{customKey,\n  note = {XAAAAAAA1},\n}\n'
    const items = locateExportItemsFromBatch('bibtex', text, [ref1])
    expect(items).toEqual([{ ref: R1, key: 'customKey', start: 0, end: text.length }])
    // Two refs, one entry carrying only the superstring: neither mentions the
    // key, and the counts differ, so both stay bare.
    const two = locateExportItemsFromBatch('bibtex', text, [ref1, ref2])
    expect(two).toEqual([{ ref: R1 }, { ref: R2 }])
  })

  it('claims each entry at most once across direct and mention matches', () => {
    const text =
      '@article{AAAAAAA1,\n  title = {One},\n}\n\n' +
      '@article{customKey,\n  title = {Two},\n  note = {BBBBBBBB},\n}\n'
    const items = locateExportItemsFromBatch('bibtex', text, [ref1, ref2])
    expect(items[0]!.key).toBe('AAAAAAA1')
    expect(items[1]!.key).toBe('customKey')
    expect(items[0]!.start).toBe(0)
    expect(items[1]!.start).toBeGreaterThan(0)
  })

  it('returns plain refs for non-per-document formats', () => {
    const items = locateExportItemsFromBatch('bibliography', '<div/>', [ref1])
    expect(items).toEqual([{ ref: R1 }])
  })
})
