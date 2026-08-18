/**
 * The server-side ref → batch-entry mapping: body splitting with text spans,
 * content-matched pairing for BibTeX/BibLaTeX (the batch's own citation key
 * wins over the single-item context's), identity matching for RIS and CSL
 * JSON, and the per-item fallback for entries that cannot be located.
 * @module tests/export-mapping
 */

import { describe, expect, it } from 'vitest'
import { locateExportItems, splitBibtexEntries, splitRisRecords } from '../src/export-mapping.js'

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

describe('locateExportItems', () => {
  it('pairs BibTeX items by content and projects the batch body key and span', () => {
    const batch =
      '@article{batchKeyOne,\n  title = {One},\n}\n\n@article{batchKeyTwo,\n  title = {Two},\n}\n'
    const secondStart = batch.indexOf('@article{batchKeyTwo,')
    const items = locateExportItems('bibtex', batch, [
      // The single-item context generates different citation keys.
      { ref: R1, key: 'K1', text: '@article{singleKeyOne,\n  title = {One},\n}\n' },
      { ref: R2, key: 'K2', text: '@article{singleKeyTwo,\n  title = {Two},\n}\n' },
    ])
    expect(items).toEqual([
      { ref: R1, title: 'One', key: 'batchKeyOne', start: 0, end: secondStart },
      { ref: R2, title: 'Two', key: 'batchKeyTwo', start: secondStart, end: batch.length },
    ])
  })

  it('leaves a BibTeX item unlocated when its content matches no batch entry', () => {
    const items = locateExportItems('biblatex', '@article{batchKeyOne,\n  title = {One},\n}\n', [
      { ref: R1, key: 'K1', text: '@article{other,\n  title = {Different},\n}\n' },
    ])
    expect(items).toEqual([{ ref: R1, title: 'Different' }])
  })

  it('pairs RIS items by record id', () => {
    const batch =
      'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n\nTY  - JOUR\nTI  - Two\nID  - K2\nER  -\n'
    const secondStart = batch.indexOf('TY  - JOUR\nTI  - Two')
    const items = locateExportItems('ris', batch, [
      { ref: R1, key: 'K1', text: 'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n' },
      { ref: R2, key: 'K2', text: 'TY  - JOUR\nTI  - Two\nID  - K2\nER  -\n' },
    ])
    expect(items).toEqual([
      { ref: R1, title: 'One', start: 0, end: secondStart },
      { ref: R2, title: 'Two', start: secondStart, end: batch.length },
    ])
  })

  it('leaves an RIS item unlocated when its id is absent from the body', () => {
    const items = locateExportItems('ris', 'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n', [
      { ref: R1, key: 'K9', text: 'TY  - JOUR\nTI  - One\nID  - K9\nER  -\n' },
    ])
    expect(items).toEqual([{ ref: R1, title: 'One' }])
  })

  it('pairs CSL JSON items by their id with the array index', () => {
    const batch = JSON.stringify([
      { id: 'one', title: 'One' },
      { id: 'two', title: 'Two' },
    ])
    const items = locateExportItems('csljson', batch, [
      { ref: R1, key: 'K1', text: '[{"id": "one", "title": "One"}]' },
      { ref: R2, key: 'K2', text: '[{"id": "two", "title": "Two"}]' },
    ])
    expect(items).toEqual([
      { ref: R1, title: 'One', key: 'one', entryIndex: 0 },
      { ref: R2, title: 'Two', key: 'two', entryIndex: 1 },
    ])
  })

  it('leaves CSL JSON items unlocated for unknown ids or malformed bodies', () => {
    const items = locateExportItems('csljson', JSON.stringify([{ id: 'one' }]), [
      { ref: R1, key: 'K1', text: '[{"id": "missing"}]' },
    ])
    expect(items).toEqual([{ ref: R1 }])
    const malformed = locateExportItems('csljson', 'not json', [
      { ref: R1, key: 'K1', text: '[{"id": "one"}]' },
    ])
    expect(malformed).toEqual([{ ref: R1 }])
  })

  it('keeps items unlocated for formats without per-document entries', () => {
    const items = locateExportItems('bibliography', '<div>a</div>', [
      { ref: R1, key: 'K1', text: 'x' },
    ])
    expect(items).toEqual([{ ref: R1 }])
  })
})
