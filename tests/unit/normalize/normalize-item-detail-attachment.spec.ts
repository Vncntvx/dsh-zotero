/**
 * Attachment items expose their own PDF through the existing detail attachment
 * shape, using wire metadata and the caller's library/instance provenance.
 * @module tests/unit/normalize/normalize-item-detail-attachment
 */
import { describe, expect, it } from 'vitest'
import { normalizeItemDetail } from '../../../src/normalize-item-detail.js'
import type { NormalizeItemDetailInput } from '../../../src/normalize-item-detail.js'
import { GROUP_LIBRARY, PERSONAL_LIBRARY } from '../../helpers/server/keys.js'
import { attachment, item } from '../../helpers/server/objects.js'

const bounds = {
  include: new Set(),
  maxAbstractChars: 100,
  maxNoteBodyChars: 100,
  maxNoteChars: 100,
  maxNoteRecords: 10,
  maxAnnotationRecords: 10,
  maxAttachmentRecords: 10,
} satisfies Omit<NormalizeItemDetailInput, 'parent'>

describe('normalizeItemDetail attachment targets', () => {
  it.each([
    {
      label: 'default personal library',
      library: undefined,
      serverId: undefined,
      expectedRef: 'zotero://user/0/attachment/WXYZ6789',
    },
    {
      label: 'qualified personal library',
      library: PERSONAL_LIBRARY,
      serverId: 'Desktop A',
      expectedRef: 'zotero://user/0/attachment/WXYZ6789?server=Desktop A',
    },
    {
      label: 'qualified group library',
      library: GROUP_LIBRARY,
      serverId: 'S2',
      expectedRef: 'zotero://group/42/attachment/WXYZ6789?server=S2',
    },
  ])('maps a standalone PDF to itself in the $label', ({ library, serverId, expectedRef }) => {
    const detail = normalizeItemDetail({
      ...bounds,
      library,
      serverId,
      parent: attachment({ data: { title: 'Scanned appendix', filename: 'scan.txt' } }),
      fields: 'all',
    })
    expect(detail.bestAttachment).toEqual({
      ref: expectedRef,
      title: 'Scanned appendix',
      contentType: 'application/pdf',
    })
    expect(detail).toMatchObject({
      itemType: 'attachment',
      title: 'Scanned appendix',
      version: 1,
      children: { total: 0 },
      creators: [],
      tags: [],
      collections: [],
      extraFields: {
        contentType: 'application/pdf',
        filename: 'scan.txt',
        linkMode: 'imported_file',
      },
    })
    expect(detail.attachments).toBeUndefined()
    expect(detail.ref).toBe(expectedRef.replace('/attachment/', '/item/'))
    expect(detail.serverId).toBe(serverId)
  })

  it('uses the wire title default rather than the filename for a PDF without a title', () => {
    const detail = normalizeItemDetail({
      ...bounds,
      parent: attachment({ data: { title: undefined, filename: 'manuscript.pdf' } }),
    })
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it.each([
    { label: 'HTML attachment', contentType: 'text/html' },
    { label: 'generic binary attachment', contentType: 'application/octet-stream' },
    { label: 'attachment without content type', contentType: undefined },
  ])('does not infer a self PDF from the filename of an $label', ({ contentType }) => {
    const detail = normalizeItemDetail({
      ...bounds,
      parent: attachment({ data: { title: 'paper.pdf', filename: 'paper.pdf', contentType } }),
    })
    expect(detail.bestAttachment).toBeUndefined()
  })

  it('does not map a bibliographic item with a PDF content type to an attachment of itself', () => {
    const detail = normalizeItemDetail({
      ...bounds,
      parent: item({ data: { title: 'paper.pdf', contentType: 'application/pdf' } }),
    })
    expect(detail.bestAttachment).toBeUndefined()
  })
})
