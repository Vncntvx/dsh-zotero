/**
 * The `zotero_get` tool surface: metadata reads with lazy children, notes,
 * annotations, attachments and collection names, the item render, and the
 * ref and argument checks that fail before any request.
 * @module tests/tools/get
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { annotationRow, attachment, collectionRow } from '../helpers/server/objects.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

const GET_PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: {
      href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
      type: 'application/json',
      attachmentType: 'application/pdf',
    },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    publicationTitle: 'ICML',
    DOI: '10.1234/fa2',
    url: 'https://arxiv.org/abs/2307.08691',
    abstractNote: 'FlashAttention is fast.',
    tags: [{ tag: 'attention' }, { tag: 'efficient' }],
    collections: ['COLL1234', 'COLL9999'],
  },
}

describe('zotero_get requested locations', () => {
  it('reads an attachment ref directly with verified file path and annotations', async () => {
    const filePath = __filename
    const fileUrl = `file://${filePath}`
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(
        {
          key: 'WXYZ6789',
          version: 5,
          data: {
            itemType: 'attachment',
            title: 'Full Text PDF',
            contentType: 'application/pdf',
            linkMode: 'imported_file',
            parentItem: 'ABCD1234',
          },
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(fileUrl, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/children', (req, res, helpers, search) => {
      if (search.get('itemType') === 'annotation') {
        return helpers.json(
          [
            annotationRow({
              key: 'ANN00001',
              data: {
                annotationText: 'Important result',
                annotationComment: 'Commentary',
                annotationPageLabel: '12',
                annotationColor: '#ffd400',
                parentItem: 'WXYZ6789',
              },
            }),
          ],
          { 'Total-Results': '1' },
        )
      }
      return helpers.raw(400, {}, '')
    })

    const result = expectValue(
      await runTool('zotero_get', {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        locations: 'best',
        include: ['annotations'],
      }),
      'zotero_get',
    )
    expect(result.value).toMatchObject({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      itemType: 'attachment',
      title: 'Full Text PDF',
      path: filePath,
      contentType: 'application/pdf',
      children: { total: 0 },
      annotations: {
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/annotation/ANN00001?server=S1',
            text: 'Important result',
            comment: 'Commentary',
          },
        ],
      },
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Content type: application/pdf')
    expect(text).toContain(`Path: ${filePath}`)
    expect(text).toContain(
      'Annotation: zotero://user/0/annotation/ANN00001?server=S1 (page 12): Important result [Comment: Commentary]',
    )
  })

  it('populates verified file path for bestAttachment and included attachments', async () => {
    const filePath = __filename
    const fileUrl = `file://${filePath}`
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(GET_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(
        attachment({
          key: 'WXYZ6789',
          data: {
            itemType: 'attachment',
            title: 'Full Text PDF',
            contentType: 'application/pdf',
            linkMode: 'imported_file',
            parentItem: 'ABCD1234',
          },
        }),
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(fileUrl, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([collectionRow({ key: 'COLL1234' }), collectionRow({ key: 'COLL9999' })]),
    )
    mock.route(
      'GET',
      '/api/users/0/items/ABCD1234/children?start=0&limit=100',
      (req, res, helpers) =>
        helpers.json(
          [
            attachment({
              key: 'WXYZ6789',
              data: {
                title: 'Full Text PDF',
                contentType: 'application/pdf',
                linkMode: 'imported_file',
                parentItem: 'ABCD1234',
              },
            }),
          ],
          { 'Total-Results': '1' },
        ),
    )

    const result = expectValue(
      await runTool('zotero_get', {
        ref: 'zotero://user/0/item/ABCD1234',
        include: ['attachments'],
        locations: 'included',
      }),
      'zotero_get',
    )
    expect(result.value).toMatchObject({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        path: filePath,
      },
      attachments: {
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
            title: 'Full Text PDF',
            path: filePath,
          },
        ],
      },
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(
      `Best attachment: zotero://user/0/attachment/WXYZ6789?server=S1 (application/pdf) → ${filePath}`,
    )
    expect(text).toContain(
      `  - Attachment: zotero://user/0/attachment/WXYZ6789?server=S1: Full Text PDF (application/pdf) → ${filePath}`,
    )
  })
})
