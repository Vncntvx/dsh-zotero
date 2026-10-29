/**
 * The wire boundary schemas' single-source pins: the panel's sort and export
 * enums and the updatable field set derive from `src/constants.ts`, and the
 * year interval is the shared closed range. A drift between constants and
 * schema fails here instead of at runtime.
 * @module tests/unit/wire-schemas
 */

import { describe, expect, it } from 'vitest'
import {
  ZOTERO_EXPORT_FORMATS,
  ZOTERO_SORT_FIELDS,
  ZOTERO_TRANSLATOR_EXPORT_FORMATS,
  ZOTERO_UPDATABLE_ITEM_FIELDS,
  ZOTERO_YEAR_MAX,
  ZOTERO_YEAR_MIN,
} from '../../src/constants.js'
import {
  zoteroLibraryExportFormatSchema,
  zoteroLibrarySearchRequestSchema,
  zoteroLibrarySortSchema,
  zoteroLibraryTranslatorExportFormatSchema,
  zoteroLibraryWriteRequestSchema,
} from '../../src/wire-schemas.js'

const SESSION = { sessionId: 'test-session' }

describe('the panel wire schemas derive from the domain constants', () => {
  it('offers exactly the domain sort fields, in domain order', () => {
    expect(zoteroLibrarySortSchema.options).toEqual([...ZOTERO_SORT_FIELDS])
  })

  it('offers exactly the domain export formats, in domain order', () => {
    expect(zoteroLibraryExportFormatSchema.options).toEqual([...ZOTERO_EXPORT_FORMATS])
  })

  it('offers exactly the translator export formats, in domain order', () => {
    expect(zoteroLibraryTranslatorExportFormatSchema.options).toEqual([
      ...ZOTERO_TRANSLATOR_EXPORT_FORMATS,
    ])
  })

  it('accepts every updatable item field in an updateItem set', () => {
    for (const field of ZOTERO_UPDATABLE_ITEM_FIELDS) {
      expect(
        zoteroLibraryWriteRequestSchema.parse({
          ...SESSION,
          operation: 'updateItem',
          args: { ref: 'zotero://user/0/item/ABCD1234', set: { [field]: 'x' } },
        }),
      ).toBeTruthy()
    }
  })

  it('refuses a set field outside the updatable set', () => {
    expect(() =>
      zoteroLibraryWriteRequestSchema.parse({
        ...SESSION,
        operation: 'updateItem',
        args: { ref: 'zotero://user/0/item/ABCD1234', set: { notAnUpdatableField: 'x' } },
      }),
    ).toThrow()
  })

  it('bounds years to the shared closed interval', () => {
    const withYear = (year: number) => ({
      scope: { kind: 'library' },
      sort: 'title',
      direction: 'asc',
      offset: 0,
      limit: 50,
      yearFrom: year,
    })
    expect(zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MIN))).toBeTruthy()
    expect(zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MAX))).toBeTruthy()
    expect(() => zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MIN - 1))).toThrow()
    expect(() => zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MAX + 1))).toThrow()
  })
})
