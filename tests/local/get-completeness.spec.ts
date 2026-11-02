/** get shares normalization, reads complete bodies, and resolves locations only on request. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  getRequest,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'
import {
  annotationRow,
  attachment,
  item,
  noteRow,
  versionHeaders,
} from '../helpers/server/objects.ts'
import { serveItemGraph, serveJson } from '../helpers/server/serve.ts'
import { ATTACHMENT_KEY, ITEM_KEY, apiPath } from '../helpers/server/keys.ts'
import { parseRef } from '../../src/refs.ts'

let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})

it('retains all 51 note bodies and 101 annotations beyond display caps', async () => {
  const notes = Array.from({ length: 51 }, (_, index) =>
    noteRow({
      key: `NOTE${String(index).padStart(4, '0')}`,
      data: { note: '字'.repeat(2500) + 'END' },
    }),
  )
  const annotations = Array.from({ length: 101 }, (_, index) =>
    annotationRow({ key: `ANNO${String(index).padStart(4, '0')}` }),
  )
  serveItemGraph(harness.mock, { parent: item(), children: notes, annotations })
  const result = await harness.provider.getItem(getRequest(['notes', 'annotations']))
  expect(result.notes).toMatchObject({ total: 51, returned: 51, completeness: 'complete' })
  expect(
    result.notes!.items.every(
      (note) => note.text.length === 2503 && note.text.endsWith('END') && !note.truncated,
    ),
  ).toBe(true)
  expect(result.annotations).toMatchObject({ total: 101, returned: 101, completeness: 'complete' })
})

it('limits only the explicitly paged kind', async () => {
  serveItemGraph(harness.mock, {
    parent: item(),
    children: [noteRow(), noteRow({ key: 'NOTE2222' })],
    annotations: [annotationRow(), annotationRow({ key: 'ANNO2222' })],
  })
  const result = await harness.provider.getItem({
    ...getRequest(['notes', 'annotations']),
    childPages: { notes: { offset: 0, limit: 1 } },
  })
  expect(result.notes).toMatchObject({ returned: 1, completeness: 'page', nextOffset: 1 })
  expect(result.annotations).toMatchObject({ returned: 2, completeness: 'complete' })
})

it('pages annotations on an attachment and preserves direct children count zero', async () => {
  serveItemGraph(harness.mock, {
    annotations: [annotationRow(), annotationRow({ key: 'ANNO2222' })],
  })
  const result = await harness.provider.getItem({
    ref: parseRef(`zotero://user/0/attachment/${ATTACHMENT_KEY}`),
    include: new Set(['annotations']),
    childPages: { annotations: { offset: 0, limit: 1 } },
  })
  expect(result.annotations).toMatchObject({
    total: 2,
    returned: 1,
    nextOffset: 1,
    completeness: 'page',
  })
  expect(result.children.total).toBe(0)
  expect(harness.mock.requests.some((request) => request.pathname.includes('/file/'))).toBe(false)
})

it('normalizes attachment and item refs identically apart from the requested ref kind', async () => {
  serveJson(
    harness.mock,
    `${apiPath()}/items/${ATTACHMENT_KEY}`,
    attachment({
      data: {
        extra: 'extra',
        relations: { 'dc:relation': 'https://example.org' },
        repository: 'archive',
      },
    }),
    versionHeaders(),
  )
  const target = { include: new Set<never>(), fields: 'all' as const }
  const byAttachment = await harness.provider.getItem({
    ...target,
    ref: parseRef(`zotero://user/0/attachment/${ATTACHMENT_KEY}`),
  })
  const byItem = await harness.provider.getItem({
    ...target,
    ref: parseRef(`zotero://user/0/item/${ATTACHMENT_KEY}`),
  })
  expect({ ...byAttachment, ref: byItem.ref }).toEqual(byItem)
  expect(byAttachment.extra).toBe('extra')
  expect(byAttachment.relations).toHaveLength(1)
  expect(byAttachment.extraFields).toMatchObject({ repository: 'archive' })
  expect(harness.mock.requests).toHaveLength(2)
})

it('reads 50 linked attachments with two requests even when resolving all locations', async () => {
  const rows = Array.from({ length: 50 }, (_, index) =>
    attachment({
      key: `ATTA${String(index).padStart(4, '0')}`,
      data: { linkMode: 'linked_url', url: `https://example.org/${index}` },
    }),
  )
  serveItemGraph(harness.mock, { parent: item(), children: rows })
  const result = await harness.provider.getItem({
    ...getRequest(['attachments']),
    locations: 'included',
  })
  expect(result.attachments!.items.every((row) => row.location?.kind === 'url')).toBe(true)
  expect(harness.mock.requests).toHaveLength(2)
})

it('reports missing files only for an explicit location request', async () => {
  serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment(), versionHeaders())
  harness.mock.route(
    'GET',
    `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
    (_req, _res, helpers) => helpers.text('file:///missing-zotero-test-file', versionHeaders()),
  )
  const request = {
    ref: parseRef(`zotero://user/0/attachment/${ATTACHMENT_KEY}`),
    include: new Set<never>(),
  }
  expect((await harness.provider.getItem(request)).location).toBeUndefined()
  expect(harness.mock.requests).toHaveLength(1)
  expect(
    (await harness.provider.getItem({ ...request, locations: 'best' })).location,
  ).toMatchObject({ kind: 'unavailable' })
  expect(harness.mock.requests).toHaveLength(3)
})

it('fails when a later child page changes version', async () => {
  serveJson(harness.mock, `${apiPath()}/items/${ITEM_KEY}`, item(), versionHeaders())
  harness.mock.route(
    'GET',
    `${apiPath()}/items/${ITEM_KEY}/children`,
    (_req, _res, helpers, query) => {
      const offset = Number(query.get('start'))
      helpers.json([noteRow({ key: offset === 0 ? 'NOTE1111' : 'NOTE2222' })], {
        ...versionHeaders('S1', offset + 1),
        'Total-Results': '2',
      })
    },
  )
  await expect(harness.provider.getItem(getRequest(['notes']))).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
  })
})
