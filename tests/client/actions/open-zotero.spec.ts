// @vitest-environment jsdom
/**
 * The canonical Zotero deep links: URL construction, ref parsing, and
 * group-library support, plus the PDF capability of one source.
 * @module tests/client/actions/open-zotero
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRefIdentityCacheForTesting,
  launchZoteroProtocol,
  launchZoteroProtocolAsync,
  parseRefIdentity,
  pdfUrlOf,
  selectUrlOf,
} from '../../../src/client/actions/open-zotero.ts'
import { setProtocolDispatcher } from '../../../src/client/actions/protocol-dispatcher.ts'
import { hasPdf, pdfCapabilityOf } from '../../../src/client/sources/source-capabilities.ts'
import type { SourceAttachment } from '../../../src/client/sources/model.ts'
import { sourceOf } from '../helpers/source-fixtures.ts'

describe('parseRefIdentity', () => {
  beforeEach(() => {
    clearRefIdentityCacheForTesting()
  })

  it('parses personal-library item and attachment refs', () => {
    expect(parseRefIdentity('zotero://user/0/item/ABCDEFGH?server=S1')).toEqual({
      libraryType: 'user',
      libraryId: '0',
      kind: 'item',
      key: 'ABCDEFGH',
    })
    expect(parseRefIdentity('zotero://user/0/attachment/WXYZ6789')).toEqual({
      libraryType: 'user',
      libraryId: '0',
      kind: 'attachment',
      key: 'WXYZ6789',
    })
  })

  it('parses group-library item and attachment refs', () => {
    expect(parseRefIdentity('zotero://group/12345/item/GRP00001')).toEqual({
      libraryType: 'group',
      libraryId: '12345',
      kind: 'item',
      key: 'GRP00001',
    })
    expect(parseRefIdentity('zotero://group/987654/attachment/GRPATT01')).toEqual({
      libraryType: 'group',
      libraryId: '987654',
      kind: 'attachment',
      key: 'GRPATT01',
    })
  })

  it('returns null for unparseable or malformed refs', () => {
    expect(parseRefIdentity('not a ref')).toBeNull()
    expect(parseRefIdentity('')).toBeNull()
    expect(parseRefIdentity('zotero://invalid/0/item/ABC')).toBeNull()
  })

  it('serves cached results and handles eviction at cache limit', () => {
    const ref = 'zotero://user/0/item/CACHED01'
    const first = parseRefIdentity(ref)
    const second = parseRefIdentity(ref)
    expect(first).toBe(second) // exact same cached object reference

    // Fill cache past 500 limit to verify FIFO eviction does not crash or corrupt
    for (let i = 0; i < 505; i++) {
      parseRefIdentity(`zotero://user/0/item/ITEM${i.toString().padStart(4, '0')}`)
    }

    // Verify clearRefIdentityCacheForTesting clears cache
    clearRefIdentityCacheForTesting()
    const third = parseRefIdentity(ref)
    expect(third).toEqual(first)
    expect(third).not.toBe(first)
  })
})

describe('selectUrlOf', () => {
  it('builds the select deep link for a personal-library item ref', () => {
    expect(selectUrlOf('zotero://user/0/item/ABCDEFGH?server=S1')).toBe(
      'zotero://select/library/items/ABCDEFGH',
    )
  })

  it('builds the select deep link for a group-library item ref', () => {
    expect(selectUrlOf('zotero://group/12345/item/GRP00001')).toBe(
      'zotero://select/groups/12345/items/GRP00001',
    )
  })

  it('returns null for an unparseable ref', () => {
    expect(selectUrlOf('not a ref')).toBeNull()
  })
})

describe('pdfUrlOf', () => {
  it('builds the open-pdf deep link for personal library with page and annotation parameters', () => {
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

  it('builds the open-pdf deep link for group library with page and annotation parameters', () => {
    expect(pdfUrlOf('zotero://group/54321/attachment/GRPATT01')).toBe(
      'zotero://open-pdf/groups/54321/items/GRPATT01',
    )
    expect(pdfUrlOf('zotero://group/54321/attachment/GRPATT01', { page: '3' })).toBe(
      'zotero://open-pdf/groups/54321/items/GRPATT01?page=3',
    )
  })

  it('returns null for an unparseable ref', () => {
    expect(pdfUrlOf('junk')).toBeNull()
  })
})

describe('launchZoteroProtocol', () => {
  it('safely dispatches a valid zotero:// url via DOM click', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    const removeSpy = vi.spyOn(document.body, 'removeChild')

    const result = launchZoteroProtocol('zotero://select/library/items/ITEM1234')
    expect(result).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(appendSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('refuses invalid non-zotero schemes', () => {
    expect(launchZoteroProtocol('https://example.com')).toBe(false)
    expect(launchZoteroProtocol('javascript:alert(1)')).toBe(false)
    expect(launchZoteroProtocol('')).toBe(false)
  })

  it('delegates to protocol dispatcher when configured', async () => {
    let dispatchedUrl: string | undefined
    setProtocolDispatcher(async (url) => {
      dispatchedUrl = url
      return true
    })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    const result = launchZoteroProtocol('zotero://select/library/items/CUSTOM1')
    expect(result).toBe(true)
    expect(dispatchedUrl).toBe('zotero://select/library/items/CUSTOM1')
    expect(clickSpy).not.toHaveBeenCalled()

    const asyncRes = await launchZoteroProtocolAsync('zotero://select/library/items/ASYNC1')
    expect(asyncRes).toBe(true)
    expect(dispatchedUrl).toBe('zotero://select/library/items/ASYNC1')

    clickSpy.mockRestore()
    setProtocolDispatcher(undefined)
  })

  it('reports host dispatch failure without claiming a DOM fallback succeeded', async () => {
    setProtocolDispatcher(async () => false)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    const removeSpy = vi.spyOn(document.body, 'removeChild')

    const asyncRes = await launchZoteroProtocolAsync('zotero://select/library/items/FALLBACK1')
    expect(asyncRes).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()

    setProtocolDispatcher(async () => {
      throw new Error('remote error')
    })
    const asyncResError = await launchZoteroProtocolAsync('zotero://select/library/items/FALLBACK2')
    expect(asyncResError).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()

    clickSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
    setProtocolDispatcher(undefined)
  })
})

/** A resolved attachment fixture; the content type is always present (possibly empty). */
function attachmentOf(contentType: string, location = ''): SourceAttachment {
  return {
    ref: 'zotero://user/0/attachment/RESOLVED',
    kind: 'file',
    title: '',
    location,
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
        attachment: attachmentOf('application/pdf', '/local/path/to/resolved.pdf'),
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
      filePath: '/local/path/to/resolved.pdf',
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
    })
  })

  it('rejects a resolved non-PDF when no candidate carries a PDF type', () => {
    expect(pdfCapabilityOf(sourceOf({ attachment: attachmentOf('text/html') }))).toBeNull()
  })

  it('never hands a resolved web PDF to the file candidate when a file fact answers', () => {
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
