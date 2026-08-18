/**
 * The open-in-Zotero deep links and verdicts: URL construction, provenance
 * gating, and the attachment-ref precedence.
 * @module tests/client/actions/open-zotero
 */

import { describe, expect, it } from 'vitest'
import {
  attachmentRefOf,
  openVerdictOf,
  pdfUrlOf,
  selectUrlOf,
} from '../../../src/client/actions/open-zotero.ts'
import type { SourceItem } from '../../../src/client/sources/model.ts'
import { sourceOf } from '../helpers/source-fixtures.ts'

describe('selectUrlOf', () => {
  it('builds the select deep link for a personal-library item ref', () => {
    expect(selectUrlOf('zotero://user/0/item/ABCDEFGH?server=S1')).toBe(
      'zotero://select/library/items/ABCDEFGH',
    )
  })

  it('returns null for an unparseable ref', () => {
    expect(selectUrlOf('not a ref')).toBeNull()
  })
})

describe('pdfUrlOf', () => {
  it('builds the open-pdf deep link with page and annotation parameters', () => {
    expect(pdfUrlOf('zotero://user/0/attachment/WXYZ6789')).toBe(
      'zotero://open-pdf/library/items/WXYZ6789',
    )
    expect(pdfUrlOf('zotero://user/0/attachment/WXYZ6789', { page: '7' })).toBe(
      'zotero://open-pdf/library/items/WXYZ6789?page=7',
    )
    expect(pdfUrlOf('zotero://user/0/attachment/WXYZ6789', { annotation: 'ANN1' })).toBe(
      'zotero://open-pdf/library/items/WXYZ6789?annotation=ANN1',
    )
    expect(pdfUrlOf('zotero://user/0/attachment/WXYZ6789', { page: '7', annotation: 'ANN1' })).toBe(
      'zotero://open-pdf/library/items/WXYZ6789?page=7&annotation=ANN1',
    )
    expect(pdfUrlOf('zotero://user/0/attachment/WXYZ6789', { page: '' })).toBe(
      'zotero://open-pdf/library/items/WXYZ6789',
    )
  })

  it('returns null for an unparseable ref', () => {
    expect(pdfUrlOf('junk')).toBeNull()
  })
})

describe('openVerdictOf', () => {
  it('opens verified items, blocks mismatches, and caves the rest', () => {
    expect(openVerdictOf(sourceOf({ provenance: 'verified' }))).toBe('open')
    expect(openVerdictOf(sourceOf({ provenance: 'mismatch' }))).toBe('blocked')
    expect(openVerdictOf(sourceOf({ provenance: 'unknown' }))).toBe('unverified')
  })
})

describe('attachmentRefOf', () => {
  it('prefers the resolved attachment, then the hint, then the retrieve attachment', () => {
    expect(
      attachmentRefOf(
        sourceOf({
          attachment: {
            ref: 'zotero://user/0/attachment/RESOLVED',
            kind: 'file',
            contentType: 'application/pdf',
            title: '',
            location: '',
          },
          bestAttachment: { ref: 'zotero://user/0/attachment/HINT' },
          retrievalFacts: {
            attachmentRef: 'zotero://user/0/attachment/FULLTEXT',
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toBe('zotero://user/0/attachment/RESOLVED')
    expect(
      attachmentRefOf(sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/HINT' } })),
    ).toBe('zotero://user/0/attachment/HINT')
    expect(
      attachmentRefOf(
        sourceOf({
          retrievalFacts: {
            attachmentRef: 'zotero://user/0/attachment/FULLTEXT',
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toBe('zotero://user/0/attachment/FULLTEXT')
    expect(attachmentRefOf(sourceOf({}))).toBeNull()
  })
})
