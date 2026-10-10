/**
 * The in-memory ref → batch-entry mapping: body splitting with text spans,
 * deterministic tier matching for BibTeX/BibLaTeX (extra citation key, DOI,
 * normalized title with year+author disambiguation, own citation key,
 * whole-token item-key mention: never positional guessing), identity
 * matching for RIS and CSL JSON, and bare refs for entries that cannot be
 * located.
 * @module tests/export-mapping
 */

import { describe, expect, it } from 'vitest'
import { bibtexFieldOf } from '../../src/export-items.js'
import {
  locateExportItemsFromBatch,
  normalizeAuthorForAlignment,
  normalizeDoiForAlignment,
  normalizeTitleForAlignment,
  normalizeYearForAlignment,
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

  it('matches BibTeX entries by key, mention, or metadata without positional guessing', () => {
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

    // 3. Metadata title match when key is arbitrary and not mentioned in text
    const metaText = '@article{unrelatedCitekey,\n  title = {Paper Meta},\n}\n'
    const meta = locateExportItemsFromBatch(
      'bibtex',
      metaText,
      [ref1],
      [{ key: 'AAAAAAA1', data: { title: 'Paper Meta' } }],
    )
    expect(meta).toEqual([
      {
        ref: R1,
        title: 'Paper Meta',
        key: 'unrelatedCitekey',
        start: 0,
        end: metaText.length,
      },
    ])

    // 4. Strictly unlocated when neither key, mention, nor metadata matches (no positional guessing)
    const unlocated = locateExportItemsFromBatch(
      'bibtex',
      '@article{unrelatedCitekey,\n  title = {Unrelated},\n}\n',
      [ref1, ref2],
    )
    expect(unlocated).toEqual([{ ref: R1 }, { ref: R2 }])
  })

  it('deterministically pairs entries in reverse order with custom citekeys via metadata', () => {
    const R3 = 'zotero://user/0/item/CCCCCCCC'
    const ref3 = parseRef(R3)
    // 3 items requested in order: ref1, ref2, ref3
    // BibTeX exported in reverse alphabetical order: entry3 (Adams), entry2 (Brown), entry1 (Zhang)
    const bibtex =
      '@article{adams2017,\n  title = {{Attention} is All You Need},\n  author = {Adams, John},\n  year = {2017},\n  doi = {10.1000/adams}\n}\n\n' +
      '@article{brown2022,\n  title = {Deep Residual Learning},\n  author = {Brown, Bob},\n  year = {2022},\n  doi = {10.1000/brown}\n}\n\n' +
      '@article{zhang2023,\n  title = {Quantum Computing Foundations},\n  author = {Zhang, Wei},\n  year = {2023},\n  doi = {10.1000/zhang}\n}\n'

    const secondStart = bibtex.indexOf('@article{brown2022,')
    const thirdStart = bibtex.indexOf('@article{zhang2023,')

    const rawItems = [
      {
        key: 'AAAAAAA1',
        data: {
          title: 'Quantum Computing Foundations',
          DOI: '10.1000/zhang',
          date: '2023',
          creators: [{ creatorType: 'author', lastName: 'Zhang', firstName: 'Wei' }],
        },
      },
      {
        key: 'BBBBBBBB',
        data: {
          title: 'Deep Residual Learning',
          DOI: '10.1000/brown',
          date: '2022',
          creators: [{ creatorType: 'author', lastName: 'Brown', firstName: 'Bob' }],
        },
      },
      {
        key: 'CCCCCCCC',
        data: {
          title: 'Attention is All You Need',
          DOI: '10.1000/adams',
          date: '2017',
          creators: [{ creatorType: 'author', lastName: 'Adams', firstName: 'John' }],
        },
      },
    ]

    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1, ref2, ref3], rawItems)
    expect(items).toEqual([
      {
        ref: R1,
        key: 'zhang2023',
        title: 'Quantum Computing Foundations',
        start: thirdStart,
        end: bibtex.length,
      },
      {
        ref: R2,
        key: 'brown2022',
        title: 'Deep Residual Learning',
        start: secondStart,
        end: thirdStart,
      },
      {
        ref: R3,
        key: 'adams2017',
        title: '{Attention} is All You Need',
        start: 0,
        end: secondStart,
      },
    ])
  })

  it('disambiguates homonymous entries using publication year and author', () => {
    const bibtex =
      '@article{editorial2021,\n  title = {Editorial Overview},\n  author = {Smith, Alice},\n  year = {2021},\n}\n\n' +
      '@article{editorial2023,\n  title = {Editorial Overview},\n  author = {Jones, Bob},\n  year = {2023},\n}\n'
    const secondStart = bibtex.indexOf('@article{editorial2023,')
    const rawItems = [
      {
        key: 'AAAAAAA1',
        data: {
          title: 'Editorial Overview',
          date: '2021-01-01',
          creators: [{ creatorType: 'author', lastName: 'Smith' }],
        },
      },
      {
        key: 'BBBBBBBB',
        data: {
          title: 'Editorial Overview',
          date: '2023-05-01',
          creators: [{ creatorType: 'author', lastName: 'Jones' }],
        },
      },
    ]

    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1, ref2], rawItems)
    expect(items).toEqual([
      {
        ref: R1,
        key: 'editorial2021',
        title: 'Editorial Overview',
        start: 0,
        end: secondStart,
      },
      {
        ref: R2,
        key: 'editorial2023',
        title: 'Editorial Overview',
        start: secondStart,
        end: bibtex.length,
      },
    ])
  })

  it('leaves missing items unlocated without guessing or displacing others', () => {
    const bibtex = '@article{adams2017,\n  title = {Attention is All You Need},\n}\n'
    const rawItems = [
      { key: 'AAAAAAA1', data: { title: 'Missing Paper' } },
      { key: 'BBBBBBBB', data: { title: 'Attention is All You Need' } },
    ]
    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1, ref2], rawItems)
    expect(items).toEqual([
      { ref: R1 },
      {
        ref: R2,
        key: 'adams2017',
        title: 'Attention is All You Need',
        start: 0,
        end: bibtex.length,
      },
    ])
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

  it('never equates a key with a longer token containing it and refuses positional guessing', () => {
    const text = '@article{customKey,\n  note = {XAAAAAAA1},\n}\n'
    const items = locateExportItemsFromBatch('bibtex', text, [ref1])
    expect(items).toEqual([{ ref: R1 }])

    const two = locateExportItemsFromBatch('bibtex', text, [ref1, ref2])
    expect(two).toEqual([{ ref: R1 }, { ref: R2 }])
  })

  it('treats underscores as part of a token during mention matching', () => {
    const text = '@article{customKey,\n  note = {foo_AAAAAAA1_bar},\n}\n'
    expect(locateExportItemsFromBatch('bibtex', text, [ref1])).toEqual([{ ref: R1 }])
  })

  it('matches BibTeX entries via the lowercase citekey alias, mid-line in extra', () => {
    const bibtex = '@article{daoLowerKey,\n  title = {Alias Title},\n}\n'
    const rawItems = [
      {
        key: 'AAAAAAA1',
        data: {
          title: 'Alias Paper',
          extra: 'PMID: 12345\nsee citekey: daoLowerKey, and more prose',
        },
      },
    ]
    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1], rawItems)
    expect(items).toEqual([
      {
        ref: R1,
        key: 'daoLowerKey',
        title: 'Alias Title',
        start: 0,
        end: bibtex.length,
      },
    ])
  })

  it('takes the citation key as one token, so trailing prose never becomes the key', () => {
    const bibtex = '@article{daoToken,\n  title = {Token Title},\n}\n'
    const rawItems = [
      {
        key: 'AAAAAAA1',
        data: {
          title: 'Token Paper',
          extra: 'Citation Key: daoToken and then some',
        },
      },
    ]
    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1], rawItems)
    expect(items).toEqual([
      { ref: R1, key: 'daoToken', title: 'Token Title', start: 0, end: bibtex.length },
    ])
  })

  it('matches BibTeX entries via extra citation key', () => {
    const bibtex = '@article{customExtraKey,\n  title = {Different Title in Bib},\n}\n'
    const rawItems = [
      {
        key: 'AAAAAAA1',
        data: {
          title: 'Paper Title',
          extra: 'Citation Key: customExtraKey',
        },
      },
    ]
    const items = locateExportItemsFromBatch('bibtex', bibtex, [ref1], rawItems)
    expect(items).toEqual([
      {
        ref: R1,
        key: 'customExtraKey',
        title: 'Different Title in Bib',
        start: 0,
        end: bibtex.length,
      },
    ])
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

  it('tolerates entries without title and leaves unlocatable homonyms unlocated', () => {
    // 1. Entry without title field
    const textNoTitle = '@article{keyNoTitle,\n  year = 2024,\n}\n'
    const itemsNoTitle = locateExportItemsFromBatch(
      'bibtex',
      textNoTitle,
      [ref1],
      [{ key: 'AAAAAAA1', data: { extra: 'Citation Key: keyNoTitle' } }],
    )
    expect(itemsNoTitle[0]?.title).toBeUndefined()
    expect(itemsNoTitle[0]?.key).toBe('keyNoTitle')

    // 2. Homonyms with completely identical title, year, and author cannot be disambiguated -> stay unlocated
    const homonymText =
      '@article{keyA,\n  title = {Same},\n  author = {Smith},\n  year = 2020,\n}\n\n' +
      '@article{keyB,\n  title = {Same},\n  author = {Smith},\n  year = 2020,\n}\n'
    const rawSame = [
      { key: 'AAAAAAA1', title: 'Same', date: '2020', creators: [{ lastName: 'Smith' }] },
      null,
      { data: { key: 'BBBBBBBB', title: 'Same', date: '2020', creators: [{ lastName: 'Smith' }] } },
    ]
    const itemsHomonym = locateExportItemsFromBatch('bibtex', homonymText, [ref1, ref2], rawSame)
    expect(itemsHomonym).toEqual([{ ref: R1 }, { ref: R2 }])

    // 3. RIS record without ID
    const risNoId = 'TY  - JOUR\nTI  - No ID\nER  -\n'
    expect(locateExportItemsFromBatch('ris', risNoId, [ref1])).toEqual([{ ref: R1 }])

    // 4. CSL JSON duplicate keys
    const cslDup = JSON.stringify([
      { id: 'http://zotero.org/users/0/items/AAAAAAA1', title: 'First' },
      { id: 'http://zotero.org/groups/1/items/AAAAAAA1', title: 'Duplicate' },
    ])
    const cslRes = locateExportItemsFromBatch('csljson', cslDup, [ref1])
    expect(cslRes[0]?.key).toBe('http://zotero.org/users/0/items/AAAAAAA1')
  })

  it('returns plain refs for non-per-document formats', () => {
    const items = locateExportItemsFromBatch('bibliography', '<div/>', [ref1])
    expect(items).toEqual([{ ref: R1 }])
  })
})

describe('bibtexFieldOf', () => {
  it('extracts braced values with nested braces', () => {
    const text = '@article{key,\n  title = {{Nested {Braced} Value}},\n}\n'
    expect(bibtexFieldOf(text, 'title')).toBe('{Nested {Braced} Value}')
  })

  it('extracts double-quoted values', () => {
    const text = '@article{key,\n  author = "Doe, Jane and Smith, John",\n}\n'
    expect(bibtexFieldOf(text, 'author')).toBe('Doe, Jane and Smith, John')
  })

  it('extracts bare numeric or token values', () => {
    const text = '@article{key,\n  year = 2024,\n}\n'
    expect(bibtexFieldOf(text, 'year')).toBe('2024')
  })

  it('rejects a bare-token field that carries no token at all', () => {
    // `year = ,` reaches the bare-token reader with an empty cursor.
    expect(bibtexFieldOf('@article{key,\n  year = ,\n}\n', 'year')).toBeUndefined()
  })

  it('looks up field names outside the known set with the generic pattern', () => {
    const text = '@article{key,\n  keywords = {alignment, bibtex},\n}\n'
    expect(bibtexFieldOf(text, 'keywords')).toBe('alignment, bibtex')
    expect(bibtexFieldOf(text, 'series')).toBeUndefined()
  })

  it('returns undefined for absent fields, unclosed braces, or unclosed quotes', () => {
    expect(bibtexFieldOf('@article{key,\n}\n', 'title')).toBeUndefined()
    expect(bibtexFieldOf('title = {Unclosed', 'title')).toBeUndefined()
    expect(bibtexFieldOf('title = "Unclosed', 'title')).toBeUndefined()
  })
})

describe('normalization helpers', () => {
  it('normalizes titles by stripping braces, LaTeX macros, and punctuation', () => {
    expect(normalizeTitleForAlignment('{Deep} {Learning}: A \\textbf{New} Frontier!')).toBe(
      'deep learning a new frontier',
    )
    expect(normalizeTitleForAlignment(undefined)).toBeUndefined()
    expect(normalizeTitleForAlignment('   ')).toBeUndefined()
  })

  it('normalizes DOIs by stripping URL prefixes', () => {
    expect(normalizeDoiForAlignment('https://doi.org/10.1234/XYZ')).toBe('10.1234/xyz')
    expect(normalizeDoiForAlignment('http://dx.doi.org/10.1234/XYZ')).toBe('10.1234/xyz')
    expect(normalizeDoiForAlignment('doi:10.1234/XYZ')).toBe('10.1234/xyz')
    expect(normalizeDoiForAlignment(undefined)).toBeUndefined()
    expect(normalizeDoiForAlignment('   ')).toBeUndefined()
  })

  it('normalizes authors to primary surname', () => {
    expect(normalizeAuthorForAlignment('Vaswani, Ashish and Shazeer, Noam')).toBe('vaswani')
    expect(normalizeAuthorForAlignment('Ashish Vaswani and Noam Shazeer')).toBe('vaswani')
    expect(normalizeAuthorForAlignment(undefined)).toBeUndefined()
    expect(normalizeAuthorForAlignment('   ')).toBeUndefined()
  })

  it('normalizes year to 4-digit string', () => {
    expect(normalizeYearForAlignment('2023-07-28')).toBe('2023')
    expect(normalizeYearForAlignment('circa 1999')).toBe('1999')
    expect(normalizeYearForAlignment('no date')).toBeUndefined()
    expect(normalizeYearForAlignment(undefined)).toBeUndefined()
  })
})
