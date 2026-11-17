/** Invalid listing metadata and input fail before normalization or ancestor I/O. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  request,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { collectionRow, searchHit } from '../helpers/server/objects.js'

let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})

it('refuses a collection page without its library fence before fetching ancestors', async () => {
  harness.mock.route('GET', '/api/users/0/collections/top', (_req, _res, h) =>
    h.json([collectionRow({ data: { parentCollection: 'PARENT01' } })], { 'Total-Results': '1' }),
  )
  await expect(
    harness.provider.browse({ kind: 'collections', offset: 0, limit: 10 }),
  ).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
    message: expect.stringContaining('Last-Modified-Version'),
  })
  expect(harness.mock.requests).toHaveLength(1)
})

it('refuses missing saved-search version metadata before parsing malformed conditions', async () => {
  harness.mock.route('GET', '/api/users/0/searches', (_req, _res, h) =>
    h.json([{ key: 'SEARCH01', data: { name: 'Invalid', conditions: 'malformed' } }], {
      'Total-Results': '1',
    }),
  )
  await expect(
    harness.provider.browse({ kind: 'savedSearches', offset: 0, limit: 10 }),
  ).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
    message: expect.stringContaining('Last-Modified-Version'),
  })
  expect(harness.mock.requests).toHaveLength(1)
})

it('rejects inverted years before resolving a collection name', async () => {
  await expect(
    harness.provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'Unresolved' },
        yearFrom: 2025,
        yearTo: 2024,
      }),
      undefined,
      { includeSupplemental: false },
    ),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  expect(harness.mock.requests).toHaveLength(0)
})

it('rejects search rows exceeding the requested window even when the total permits them', async () => {
  harness.mock.route('GET', '/api/users/0/items/top', (_req, _res, h) =>
    h.json([searchHit({ key: 'ITEM0001' }), searchHit({ key: 'ITEM0002' })], {
      'Total-Results': '2',
    }),
  )
  await expect(
    harness.provider.search(request({ limit: 1 }), undefined, { includeSupplemental: false }),
  ).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
    message: expect.stringContaining('reported window'),
  })
})
