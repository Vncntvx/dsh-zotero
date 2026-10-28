/**
 * The `extraFields` lossless-JSON gate: the `fields: 'all'` passthrough keeps
 * only the unconsumed `data` fields that survive the harness's strict JSON
 * round trip, so a value the wire cannot carry is dropped, never mangled.
 * @module tests/unit/normalize/normalize-item-extra-fields
 */

import { describe, expect, it } from 'vitest'
import { normalizeItemDetail } from '../../../src/normalize.js'

describe('extraFields lossless-JSON gate', () => {
  it('drops non-finite and negative-zero numbers that JSON cannot round-trip', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        repository: 'Zenodo',
        scoreNaN: Number.NaN,
        scoreInf: Number.POSITIVE_INFINITY,
        negZero: -0,
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      maxAttachmentRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({ repository: 'Zenodo' })
  })

  it('drops fields whose nested values cannot round-trip, keeping valid nested records', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        validNested: { level: 1, tags: ['a', 'b'], flag: true, score: 3, nothing: null },
        nestedNaN: { score: Number.NaN },
        nestedInf: [1, Number.POSITIVE_INFINITY],
        nestedNegZero: { zero: -0 },
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      maxAttachmentRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({
      validNested: { level: 1, tags: ['a', 'b'], flag: true, score: 3, nothing: null },
    })
  })

  it('drops non-JSON values the strict harness gate rejects', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        kept: 'yes',
        missing: undefined,
        fn: () => 1,
        date: new Date('2024-01-01T00:00:00.000Z'),
        loop: circular,
        sparse: (() => {
          const sparseArray: unknown[] = []
          sparseArray[2] = 'x'
          return sparseArray
        })(),
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      maxAttachmentRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({ kept: 'yes' })
  })

  it('omits extraFields when every unconsumed field is dropped', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        scoreNaN: Number.NaN,
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      maxAttachmentRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toBeUndefined()
  })
})
