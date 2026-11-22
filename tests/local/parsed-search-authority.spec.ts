/** Live wire semantics with an isolated scripted Local API. */
import { expect, it } from 'vitest'
import { setupProvider, teardownProvider } from '../helpers/provider-harness.ts'
import { serveJson } from '../helpers/server/serve.ts'
import { attachment, versionHeaders } from '../helpers/server/objects.ts'
import { ATTACHMENT_KEY, ITEM_KEY } from '../helpers/server/keys.ts'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZOTERO_UNEXPECTED,
} from '../../src/errors.ts'

const ref = `zotero://user/0/attachment/${ATTACHMENT_KEY}?server=S1`
const signal = new AbortController().signal
const personal = { type: 'user', id: 0 } as const
const prefix = '/api/users/0'
const attachmentPath = `${prefix}/items/${ATTACHMENT_KEY}`
const parentPath = `${prefix}/items/${ITEM_KEY}`
const collection = 'COLL0001'
const parent = (data: Record<string, unknown> = {}) => ({
  key: ITEM_KEY,
  data: {
    key: ITEM_KEY,
    itemType: 'journalArticle',
    title: 'Evidence',
    collections: [collection],
    ...data,
  },
})

it('validates the current server for library and collection scopes', async () => {
  const harness = await setupProvider()
  try {
    serveJson(harness.mock, `${prefix}/collections`, [], versionHeaders())
    serveJson(
      harness.mock,
      `${prefix}/collections/${collection}`,
      { key: collection },
      versionHeaders(),
    )
    expect(
      await harness.provider.parsedSearchAuthority(personal, undefined, undefined, signal),
    ).toBe('S1')
    expect(await harness.provider.parsedSearchAuthority(personal, collection, 'S1', signal)).toBe(
      'S1',
    )
    await expect(
      harness.provider.parsedSearchAuthority(personal, 'MISSING1', 'S1', signal),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
    serveJson(harness.mock, '/api/groups/42/collections', [], { 'Zotero-API-Version': '3' })
    await expect(
      harness.provider.parsedSearchAuthority(
        { type: 'group', id: 42 },
        undefined,
        undefined,
        signal,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_PROVIDER_UNAVAILABLE })
  } finally {
    await teardownProvider(harness)
  }
})

it.each([
  { where: 'attachment', data: { deleted: true }, code: ZOTERO_NOT_FOUND },
  { where: 'parent', data: { deleted: 1 }, code: ZOTERO_NOT_FOUND },
  { where: 'parent', data: { collections: ['broken'] }, code: ZOTERO_UNEXPECTED },
] as const)('rejects unusable $where collection authority', async ({ where, data, code }) => {
  const harness = await setupProvider()
  try {
    serveJson(
      harness.mock,
      attachmentPath,
      attachment({ data: { parentItem: ITEM_KEY, ...(where === 'attachment' ? data : {}) } }),
      versionHeaders(),
    )
    serveJson(harness.mock, parentPath, parent(where === 'parent' ? data : {}), versionHeaders())
    await expect(harness.provider.parsedSearchAttachment(ref, signal)).rejects.toMatchObject({
      code,
    })
  } finally {
    await teardownProvider(harness)
  }
})

it.each([true, false])('resolves live membership for a child attachment: %s', async (child) => {
  const harness = await setupProvider()
  try {
    serveJson(
      harness.mock,
      attachmentPath,
      attachment({ data: child ? { parentItem: ITEM_KEY } : { collections: [collection] } }),
      versionHeaders(),
    )
    serveJson(harness.mock, parentPath, parent(), versionHeaders())
    expect(await harness.provider.parsedSearchAttachment(ref, signal)).toMatchObject({
      serverId: 'S1',
      attachmentRef: ref,
      collectionKeys: [collection],
      ...(child ? { item: { ref: `zotero://user/0/item/${ITEM_KEY}?server=S1` } } : {}),
    })
  } finally {
    await teardownProvider(harness)
  }
})
