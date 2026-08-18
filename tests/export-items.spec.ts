/**
 * The single-item export facts parser: citation keys and titles pulled from
 * one entry at a time, never from the merged batch body.
 * @module tests/export-items
 */

import { describe, expect, it } from 'vitest'
import { parseExportItem } from '../src/export-items.js'

describe('parseExportItem', () => {
  it('extracts the citation key and title from a BibTeX entry', () => {
    expect(
      parseExportItem(
        'bibtex',
        '@article{panCarbonPriceForecasting2022,\n  title = {Carbon price forecasting},\n}',
      ),
    ).toEqual({ key: 'panCarbonPriceForecasting2022', title: 'Carbon price forecasting' })
  })

  it('parses biblatex entries the same way', () => {
    expect(
      parseExportItem('biblatex', '@article{zheng2025,\n  title = {Heterogeneous risks},\n}'),
    ).toEqual({ key: 'zheng2025', title: 'Heterogeneous risks' })
  })

  it('keeps a title whose entry has no citation key', () => {
    expect(parseExportItem('bibtex', 'title = {Untitled to a key}')).toEqual({
      title: 'Untitled to a key',
    })
  })

  it('omits the key when a BibTeX entry has none', () => {
    expect(parseExportItem('bibtex', 'plain text without fields')).toEqual({})
  })

  it('extracts only the title from a RIS record (records carry no citation key)', () => {
    expect(parseExportItem('ris', 'TY  - JOUR\nTI  - Heterogeneous risks\nER  -\n')).toEqual({
      title: 'Heterogeneous risks',
    })
  })

  it('returns nothing for a RIS record without a title', () => {
    expect(parseExportItem('ris', 'TY  - JOUR\nER  -\n')).toEqual({})
  })

  it('extracts id and title from a CSL JSON array of one record', () => {
    expect(parseExportItem('csljson', '[{"id": "wang2023", "title": "Carbon trading"}]')).toEqual({
      key: 'wang2023',
      title: 'Carbon trading',
    })
  })

  it('returns nothing for malformed or non-array CSL JSON', () => {
    expect(parseExportItem('csljson', 'not json')).toEqual({})
    expect(parseExportItem('csljson', '{}')).toEqual({})
    expect(parseExportItem('csljson', '[]')).toEqual({})
  })

  it('drops non-string CSL JSON id and title fields', () => {
    expect(parseExportItem('csljson', '[{"id": 7, "title": "T"}]')).toEqual({ title: 'T' })
    expect(parseExportItem('csljson', '[{"id": "k", "title": 7}]')).toEqual({ key: 'k' })
  })

  it('returns nothing for formats without per-item entries', () => {
    expect(parseExportItem('citation', 'x')).toEqual({})
    expect(parseExportItem('bibliography', 'x')).toEqual({})
  })
})
