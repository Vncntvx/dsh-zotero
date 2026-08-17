/**
 * The open-in-Zotero deep links and verdicts: URL construction, provenance
 * gating, and the attachment-ref precedence.
 * @module tests/client/actions/open-zotero
 */

import { describe, expect, it } from 'vitest'
import {
  annotationKeyOf,
  attachmentRefOf,
  openVerdictOf,
  pdfUrlOf,
  selectUrlOf,
} from '../../../src/client/actions/open-zotero.ts'
import type { SourceItem } from '../../../src/client/sources/model.ts'

function itemOf(overrides: Partial<SourceItem>): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    callRefs: { successful: [], failed: [], running: [] },
    ...overrides,
  }
}

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
    expect(openVerdictOf(itemOf({ provenance: 'verified' }))).toBe('open')
    expect(openVerdictOf(itemOf({ provenance: 'mismatch' }))).toBe('blocked')
    expect(openVerdictOf(itemOf({ provenance: 'unknown' }))).toBe('unverified')
  })
})

describe('attachmentRefOf', () => {
  it('prefers the resolved attachment, then the hint, then the retrieve attachment', () => {
    expect(
      attachmentRefOf(
        itemOf({
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
      attachmentRefOf(itemOf({ bestAttachment: { ref: 'zotero://user/0/attachment/HINT' } })),
    ).toBe('zotero://user/0/attachment/HINT')
    expect(
      attachmentRefOf(
        itemOf({
          retrievalFacts: {
            attachmentRef: 'zotero://user/0/attachment/FULLTEXT',
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toBe('zotero://user/0/attachment/FULLTEXT')
    expect(attachmentRefOf(itemOf({}))).toBeNull()
  })
})

describe('annotationKeyOf', () => {
  it('extracts the annotation key', () => {
    expect(annotationKeyOf('zotero://user/0/annotation/ANN00001')).toBe('ANN00001')
    expect(annotationKeyOf('junk')).toBeNull()
  })
})
