/**
 * The open-in-Zotero deep links and verdicts: URL construction, provenance
 * gating, and the PDF capability of one source.
 * @module tests/client/actions/open-zotero
 */

import { describe, expect, it } from 'vitest'
import { openVerdictOf, pdfUrlOf, selectUrlOf } from '../../../src/client/actions/open-zotero.ts'
import { hasPdf, pdfCapabilityOf } from '../../../src/client/sources/source-capabilities.ts'
import type { SourceAttachment } from '../../../src/client/sources/model.ts'
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

/** A resolved attachment fixture; the content type is always present (possibly empty). */
function attachmentOf(contentType: string): SourceAttachment {
  return {
    ref: 'zotero://user/0/attachment/RESOLVED',
    kind: 'file',
    title: '',
    location: '',
    contentType,
  }
}

/** A resolved web-linked attachment fixture. */
function urlAttachmentOf(contentType: string, location: string): SourceAttachment {
  return {
    ref: 'zotero://user/0/attachment/WEBLINK1',
    kind: 'url',
    title: '',
    location,
    contentType,
  }
}

describe('pdfCapabilityOf', () => {
  const PDF_REF = 'zotero://user/0/attachment/RESOLVED'
  const HINT_REF = 'zotero://user/0/attachment/HINT0001'
  const FULLTEXT_REF = 'zotero://user/0/attachment/FULLTEXT'
  it('confirms the resolved attachment ahead of the hint and the retrieve attachment', () => {
    const capability = pdfCapabilityOf(
      sourceOf({
        attachment: attachmentOf('application/pdf'),
        bestAttachment: { ref: HINT_REF, contentType: 'application/pdf' },
        retrievalFacts: {
          attachmentRef: FULLTEXT_REF,
          attachmentContentType: 'application/pdf',
          truncated: false,
          sourceAvailability: {},
        },
      }),
    )
    expect(capability).toEqual({
      kind: 'file',
      ref: PDF_REF,
      url: 'zotero://open-pdf/library/items/RESOLVED',
    })
  })

  it('confirms the hint and the retrieve attachment when nothing was resolved', () => {
    expect(
      pdfCapabilityOf(
        sourceOf({ bestAttachment: { ref: HINT_REF, contentType: 'application/pdf' } }),
      ),
    ).toEqual({
      kind: 'file',
      ref: HINT_REF,
      url: 'zotero://open-pdf/library/items/HINT0001',
    })
    expect(
      pdfCapabilityOf(
        sourceOf({
          retrievalFacts: {
            attachmentRef: FULLTEXT_REF,
            attachmentContentType: 'application/pdf',
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toEqual({
      kind: 'file',
      ref: FULLTEXT_REF,
      url: 'zotero://open-pdf/library/items/FULLTEXT',
    })
  })

  it('skips a resolved non-PDF attachment for a PDF hint with a known type', () => {
    expect(
      pdfCapabilityOf(
        sourceOf({
          attachment: attachmentOf('text/html'),
          bestAttachment: { ref: HINT_REF, contentType: 'application/pdf' },
        }),
      ),
    ).toEqual({
      kind: 'file',
      ref: HINT_REF,
      url: 'zotero://open-pdf/library/items/HINT0001',
    })
  })

  it('rejects a resolved non-PDF when no candidate carries a PDF type', () => {
    expect(pdfCapabilityOf(sourceOf({ attachment: attachmentOf('text/html') }))).toBeNull()
  })

  it('never hands a resolved web PDF to the open-pdf protocol when a file fact answers', () => {
    expect(
      pdfCapabilityOf(
        sourceOf({
          attachment: urlAttachmentOf('application/pdf', 'https://e.org/paper.pdf'),
          bestAttachment: { ref: HINT_REF, contentType: 'application/pdf' },
        }),
      ),
    ).toEqual({
      kind: 'file',
      ref: HINT_REF,
      url: 'zotero://open-pdf/library/items/HINT0001',
    })
    expect(
      pdfCapabilityOf(
        sourceOf({
          attachment: urlAttachmentOf('application/pdf', 'https://e.org/paper.pdf'),
          retrievalFacts: {
            attachmentRef: FULLTEXT_REF,
            attachmentContentType: 'application/pdf',
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toEqual({
      kind: 'file',
      ref: FULLTEXT_REF,
      url: 'zotero://open-pdf/library/items/FULLTEXT',
    })
  })

  it('opens a resolved web PDF at its web location when it is the only PDF fact', () => {
    expect(
      pdfCapabilityOf(
        sourceOf({ attachment: urlAttachmentOf('application/pdf', 'https://e.org/paper.pdf') }),
      ),
    ).toEqual({ kind: 'url', url: 'https://e.org/paper.pdf' })
  })

  it('yields no capability for a resolved web PDF without an openable web location', () => {
    expect(pdfCapabilityOf(sourceOf({ attachment: urlAttachmentOf('application/pdf', '') }))).toBe(
      null,
    )
    expect(
      pdfCapabilityOf(sourceOf({ attachment: urlAttachmentOf('application/pdf', 'file:///x') })),
    ).toBeNull()
  })

  it('never promises a PDF from a type-less ref of an older session', () => {
    expect(pdfCapabilityOf(sourceOf({ bestAttachment: { ref: HINT_REF } }))).toBeNull()
    expect(
      pdfCapabilityOf(
        sourceOf({
          retrievalFacts: {
            attachmentRef: FULLTEXT_REF,
            truncated: false,
            sourceAvailability: {},
          },
        }),
      ),
    ).toBeNull()
  })

  it('rejects a confirmed-type ref the deep link cannot parse', () => {
    const unparseable = {
      ...attachmentOf('application/pdf'),
      ref: 'junk',
    }
    expect(pdfCapabilityOf(sourceOf({ attachment: unparseable }))).toBeNull()
  })

  it('never yields a capability for a type-less ref the deep link cannot parse', () => {
    expect(pdfCapabilityOf(sourceOf({ bestAttachment: { ref: 'junk' } }))).toBeNull()
  })

  it('yields nothing for a bare source', () => {
    expect(pdfCapabilityOf(sourceOf({}))).toBeNull()
  })
})

describe('hasPdf', () => {
  it('mirrors pdfCapabilityOf exactly', () => {
    expect(
      hasPdf(sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/HINT0001' } })),
    ).toBe(false)
    expect(
      hasPdf(
        sourceOf({ attachment: urlAttachmentOf('application/pdf', 'https://e.org/paper.pdf') }),
      ),
    ).toBe(true)
    expect(hasPdf(sourceOf({ attachment: attachmentOf('text/html') }))).toBe(false)
    expect(hasPdf(sourceOf({}))).toBe(false)
  })
})
