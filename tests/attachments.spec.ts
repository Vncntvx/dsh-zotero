import { describe, expect, it } from 'vitest'
import {
  bestAttachmentFromLinks,
  normalizeAttachmentRecord,
  selectAttachment,
} from '../src/attachments.js'

const PDF_CHILD = {
  key: 'WXYZ6789',
  data: {
    itemType: 'attachment',
    title: 'Full Text PDF',
    contentType: 'application/pdf',
    linkMode: 'imported_file',
    dateAdded: '2022-01-02T00:00:00Z',
  },
}

const LINKED_PDF_CHILD = {
  key: 'LINK0001',
  data: {
    itemType: 'attachment',
    title: 'Linked PDF',
    contentType: 'application/pdf',
    linkMode: 'linked_file',
    dateAdded: '2021-01-01T00:00:00Z',
  },
}

const SNAPSHOT_CHILD = {
  key: 'SNAP0002',
  data: {
    itemType: 'attachment',
    title: 'Web Page Snapshot',
    contentType: 'text/html',
    linkMode: 'imported_url',
    dateAdded: '2020-01-01T00:00:00Z',
  },
}

describe('bestAttachmentFromLinks', () => {
  it('reads the key and content type from links.attachment', () => {
    expect(
      bestAttachmentFromLinks({
        links: {
          attachment: {
            href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
            type: 'application/json',
            attachmentType: 'application/pdf',
          },
        },
      }),
    ).toEqual({ key: 'WXYZ6789', contentType: 'application/pdf' })
  })

  it('returns undefined when links.attachment is absent or keyless', () => {
    expect(bestAttachmentFromLinks({ links: {} })).toBeUndefined()
    expect(
      bestAttachmentFromLinks({
        links: { attachment: { href: 'http://localhost:23119/api/users/0/items/not-a-key' } },
      }),
    ).toBeUndefined()
    expect(bestAttachmentFromLinks({})).toBeUndefined()
  })
})

describe('selectAttachment', () => {
  it('prefers Zotero-computed PDFs: imported files first, then earliest date, then key order', () => {
    const rows = [SNAPSHOT_CHILD, LINKED_PDF_CHILD, PDF_CHILD]
    const selected = selectAttachment(rows, 'pdf')
    expect(selected).toEqual({
      key: 'WXYZ6789',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    })
  })

  it('falls back across equal-rank PDFs by date then key', () => {
    const older = {
      ...PDF_CHILD,
      key: 'AAAA1111',
      data: { ...PDF_CHILD.data, dateAdded: '2021-01-01T00:00:00Z' },
    }
    const newer = {
      ...PDF_CHILD,
      key: 'BBBB2222',
      data: { ...PDF_CHILD.data, dateAdded: '2022-01-01T00:00:00Z' },
    }
    expect(selectAttachment([newer, older], 'pdf')!.key).toBe('AAAA1111')
    const tieA = { ...older, key: 'CCCC3333' }
    const tieB = { ...older, key: 'DDDD4444' }
    expect(selectAttachment([tieB, tieA], 'pdf')!.key).toBe('CCCC3333')
  })

  it('returns undefined when no attachment of the requested kind exists', () => {
    expect(selectAttachment([SNAPSHOT_CHILD], 'pdf')).toBeUndefined()
  })
})

describe('normalizeAttachmentRecord', () => {
  it('normalizes an attachment item JSON into a record', () => {
    expect(normalizeAttachmentRecord(PDF_CHILD)).toEqual({
      key: 'WXYZ6789',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    })
  })

  it('tolerates missing optional fields', () => {
    expect(
      normalizeAttachmentRecord({ key: 'WXYZ6789', data: { itemType: 'attachment' } }),
    ).toEqual({ key: 'WXYZ6789', title: '', contentType: '', linkMode: undefined })
  })
})

describe('attachment failure modes', () => {
  it('fails loud on an attachment without a valid key', () => {
    let thrown: unknown
    try {
      normalizeAttachmentRecord({ data: { contentType: 'application/pdf' } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as { code: string }).code).toBe('ZOTERO_UNEXPECTED')
  })

  it('tolerates a bare attachment row without a data block', () => {
    expect(normalizeAttachmentRecord({ key: 'WXYZ6789' })).toEqual({
      key: 'WXYZ6789',
      title: '',
      contentType: '',
    })
  })

  it('skips non-attachment rows while selecting', () => {
    const selected = selectAttachment(
      [{ key: 'NOTE1111', data: { itemType: 'note' } }, PDF_CHILD],
      'pdf',
    )
    expect(selected!.key).toBe('WXYZ6789')
  })

  it('matches non-pdf kinds as literal content types', () => {
    expect(selectAttachment([SNAPSHOT_CHILD], 'text/html')).toEqual({
      key: 'SNAP0002',
      title: 'Web Page Snapshot',
      contentType: 'text/html',
      linkMode: 'imported_url',
    })
  })
})

describe('selectAttachment tie-breaking', () => {
  it('treats a missing dateAdded as the earliest addition', () => {
    const noDate = {
      key: 'AAAA1111',
      data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' },
    }
    const withDate = { ...PDF_CHILD, key: 'BBBB2222' }
    expect(selectAttachment([withDate, noDate], 'pdf')!.key).toBe('AAAA1111')
  })
})

describe('selectAttachment non-object rows', () => {
  it('treats non-object rows as unselectable', () => {
    expect(selectAttachment(['junk'], 'pdf')).toBeUndefined()
    let thrown: unknown
    try {
      normalizeAttachmentRecord('junk')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
  })
})

describe('selectAttachment rank comparison', () => {
  it('ranks a linked file below an imported file even when added earlier', () => {
    expect(selectAttachment([LINKED_PDF_CHILD, PDF_CHILD], 'pdf')!.key).toBe('WXYZ6789')
    expect(selectAttachment([PDF_CHILD, LINKED_PDF_CHILD], 'pdf')!.key).toBe('WXYZ6789')
  })
})
