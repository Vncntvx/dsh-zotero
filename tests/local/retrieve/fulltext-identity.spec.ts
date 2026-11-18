/** Parent attribution is proved over the Local API, including group and failure boundaries. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MockZotero } from '../../helpers/mock-zotero.ts'
import { testHttpClient } from '../../helpers/test-clients.ts'
import { fulltextIdentityOf } from '../../../src/local/fulltext-identity.ts'
import { attachment, item, versionHeaders } from '../../helpers/server/objects.ts'
import { serveJson } from '../../helpers/server/serve.ts'
import {
  ATTACHMENT_KEY,
  ITEM_KEY,
  apiPath,
  attachmentRef,
  refOf,
} from '../../helpers/server/keys.ts'
let mock: MockZotero
beforeEach(async () => {
  mock = await MockZotero.start()
})
afterEach(async () => {
  await mock.close()
})

it.each([
  { type: 'user' as const, id: 0 as const },
  { type: 'group' as const, id: 42 },
])(
  'proves parent metadata and binds both refs to the serving instance in $type/$id',
  async (library) => {
    serveJson(
      mock,
      `${apiPath(library)}/items/${ATTACHMENT_KEY}`,
      attachment({ data: { parentItem: ITEM_KEY } }),
      versionHeaders('S1'),
    )
    serveJson(
      mock,
      `${apiPath(library)}/items/${ITEM_KEY}`,
      item({
        data: {
          itemType: 'journalArticle',
          title: 'Verified title',
          date: '2026',
          publicationTitle: 'Verified venue',
        },
        meta: { parsedDate: '2026-01-01' },
      }),
      versionHeaders('S1'),
    )
    const result = await fulltextIdentityOf(
      testHttpClient(mock.baseUrl),
      refOf('attachment', ATTACHMENT_KEY, library),
    )
    expect(result).toMatchObject({
      attachmentRef: `${refOf('attachment', ATTACHMENT_KEY, library)}?server=S1`,
      attachmentContentType: 'application/pdf',
      item: {
        ref: `${refOf('item', ITEM_KEY, library)}?server=S1`,
        title: 'Verified title',
        year: 2026,
        venue: 'Verified venue',
      },
    })
    expect(mock.requests[1]?.headers['zotero-server-id']).toBe('S1')
  },
)

it.each([undefined, false, ''])(
  'keeps a standalone attachment without inventing a parent (%s)',
  async (parentItem) => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment({ data: { parentItem } }))
    expect(
      await fulltextIdentityOf(testHttpClient(mock.baseUrl), attachmentRef()),
    ).not.toHaveProperty('item')
    expect(mock.requests).toHaveLength(1)
  },
)

it.each([
  { label: 'different attachment key', row: attachment({ key: 'OTHER123' }) },
  { label: 'malformed parent key', row: attachment({ data: { parentItem: 'bad' } }) },
])('rejects $label instead of guessing an identity', async ({ row }) => {
  serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, row)
  await expect(
    fulltextIdentityOf(testHttpClient(mock.baseUrl), attachmentRef()),
  ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
})

it.each([
  item({ key: 'OTHER123' }),
  attachment({ key: ITEM_KEY }),
  item({ data: { itemType: '' } }),
])('refuses a contradictory parent response', async (row) => {
  serveJson(
    mock,
    `${apiPath()}/items/${ATTACHMENT_KEY}`,
    attachment({ data: { parentItem: ITEM_KEY } }),
  )
  serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, row)
  await expect(
    fulltextIdentityOf(testHttpClient(mock.baseUrl), attachmentRef()),
  ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
})

it('preserves a missing attachment failure rather than inventing a source', async () => {
  await expect(
    fulltextIdentityOf(testHttpClient(mock.baseUrl), attachmentRef()),
  ).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
})
