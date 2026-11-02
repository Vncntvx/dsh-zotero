/** Child reads reject contradictory pages and honor backpressure and target parameters. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  getRequest,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'
import { attachment, item, noteRow, versionHeaders } from '../helpers/server/objects.ts'
import { serveItemGraph, serveJson } from '../helpers/server/serve.ts'
import { childPages } from '../../src/local/children-wire.ts'
import { ZoteroHttpClient } from '../../src/http-client.ts'
let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})
it.each(['missing', 'invalid', 'empty', 'overflow', 'duplicate', 'total-change'])(
  'refuses %s page facts instead of returning complete data',
  async (failure) => {
    serveJson(harness.mock, '/api/users/0/items/ABCD1234', item(), versionHeaders())
    harness.mock.route('GET', '/api/users/0/items/ABCD1234/children', (_req, _res, helpers, q) => {
      const later = Number(q.get('start')) > 0
      const total =
        failure === 'invalid'
          ? 'NaN'
          : failure === 'overflow'
            ? '0'
            : failure === 'total-change' && later
              ? '3'
              : '2'
      helpers.json(failure === 'empty' ? [] : [noteRow()], {
        ...versionHeaders(),
        ...(failure === 'missing' ? {} : { 'Total-Results': total }),
      })
    })
    await expect(harness.provider.getItem(getRequest(['notes']))).rejects.toMatchObject({
      code: 'ZOTERO_UNEXPECTED',
    })
  },
)
it('requests the next raw page only when the consumer advances', async () => {
  harness.mock.route('GET', '/api/users/0/items/ABCD1234/children', (_req, _res, helpers, q) =>
    helpers.json([noteRow({ key: Number(q.get('start')) === 0 ? 'NOTE1111' : 'NOTE2222' })], {
      ...versionHeaders(),
      'Total-Results': '2',
    }),
  )
  const client = new ZoteroHttpClient({
    baseUrl: harness.mock.baseUrl,
    timeoutMs: 1000,
    maxResponseBytes: 100000,
    maxInFlight: 4,
  })
  const pages = childPages(
    { client },
    { key: 'ABCD1234', library: { type: 'user', id: 0 }, serverId: 'S1', kind: 'notes' },
  )
  expect((await pages.next()).value).toMatchObject({ offset: 0, nextOffset: 1 })
  expect(harness.mock.requests).toHaveLength(1)
  expect((await pages.next()).value).toMatchObject({ offset: 1 })
  expect(harness.mock.requests).toHaveLength(2)
  await pages.return(undefined)
})
it.each([
  { include: new Set(['notes'] as const), locations: 'included' as const },
  { include: new Set<never>(), childPages: { notes: { offset: 0, limit: 1 } } },
])('rejects a meaningless parameter combination before reading', async (patch) => {
  await expect(harness.provider.getItem({ ...getRequest(), ...patch })).rejects.toMatchObject({
    code: 'ZOTERO_INVALID_ARGUMENT',
  })
  expect(harness.mock.requests).toHaveLength(0)
})
it('reuses an included PDF candidate when the parent has no attachment link', async () => {
  serveItemGraph(harness.mock, {
    parent: item(),
    children: [
      attachment({ data: { linkMode: 'linked_url', url: 'https://example.org/paper.pdf' } }),
    ],
  })
  const result = await harness.provider.getItem({
    ...getRequest(['attachments']),
    locations: 'best',
  })
  expect(result.location).toEqual({ kind: 'url', url: 'https://example.org/paper.pdf' })
  expect(harness.mock.requests).toHaveLength(2)
})
it('reports the absence of a best attachment explicitly', async () => {
  serveItemGraph(harness.mock, { parent: item(), children: [] })
  expect(
    (await harness.provider.getItem({ ...getRequest(), locations: 'best' })).location,
  ).toMatchObject({ kind: 'unavailable' })
})
