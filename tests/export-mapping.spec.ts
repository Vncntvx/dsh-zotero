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
})

describe('splitRisRecords', () => {
  const TEXT = 'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n\nTY  - JOUR\nTI  - Two\nID  - K2\nER  -\n'

  it('splits records with their ids and text spans', () => {
    const records = splitRisRecords(TEXT)
    const firstEr = TEXT.indexOf('ER  -')
    expect(records).toEqual([
      { key: 'K1', start: 0, end: firstEr, text: 'TY  - JOUR\nTI  - One\nID  - K1' },
      {
        key: 'K2',
        start: firstEr + 'ER  -'.length,
        end: TEXT.length - 'ER  -\n'.length,
        text: 'TY  - JOUR\nTI  - Two\nID  - K2',
      },
    ])
  })

  it('handles a trailing record without a terminator', () => {
    const text = 'TY  - JOUR\nID  - K1\nER  -\n\nTY  - JOUR\nTI  - Two\nID  - K2\n'
    const records = splitRisRecords(text)
    const firstEr = text.indexOf('ER  -')
    expect(records).toHaveLength(2)
    expect(records[1]).toEqual({
      key: 'K2',
      start: firstEr + 'ER  -'.length,
      end: text.length,
      text: 'TY  - JOUR\nTI  - Two\nID  - K2',
    })
  })

  it('keeps records without an id', () => {
    const text = 'TY  - JOUR\nTI  - No id\nER  -\n'
    const records = splitRisRecords(text)
    expect(records).toEqual([
      { start: 0, end: text.indexOf('ER  -'), text: 'TY  - JOUR\nTI  - No id' },
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
    const firstEr = batch.indexOf('ER  -')
    const items = locateExportItems('ris', batch, [
      { ref: R1, key: 'K1', text: 'TY  - JOUR\nTI  - One\nID  - K1\nER  -\n' },
      { ref: R2, key: 'K2', text: 'TY  - JOUR\nTI  - Two\nID  - K2\nER  -\n' },
    ])
    expect(items).toEqual([
      { ref: R1, title: 'One', start: 0, end: firstEr },
      {
        ref: R2,
        title: 'Two',
        start: firstEr + 'ER  -'.length,
        end: batch.length - 'ER  -\n'.length,
      },
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
