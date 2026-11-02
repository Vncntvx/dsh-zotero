/** Same-value scalar updates validate every field without obtaining a write key. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { updateItem } from '../../../src/local/write-domain.ts'
import {
  ITEM_REF,
  ITEM_KEY,
  SERVER_ID,
  grantAuthorize,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.ts'
import type { MockZotero } from '../../helpers/mock-zotero.ts'
let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => {
  await mock.close()
})
it('returns the actual version for repeated satisfied updates without authorization or PATCH', async () => {
  serveItemRead(mock, { data: { title: 'Saved' } })
  const { deps } = writeDeps(mock)
  mock.route('GET', '/api/itemTypeFields', (_req, _res, helpers) =>
    helpers.json([{ field: 'title' }]),
  )
  for (let call = 0; call < 2; call++)
    expect(await updateItem(deps, { item: ITEM_REF, set: { title: 'Saved' } })).toMatchObject({
      kind: 'applied',
      unchanged: true,
      changed: [],
      version: 10,
    })
  expect(
    mock.requests.some(
      (request) => request.method === 'PATCH' || request.pathname.includes('authorize'),
    ),
  ).toBe(false)
})
it('rejects an invalid field even when another field already matches', async () => {
  serveItemRead(mock, { data: { itemType: 'book', title: 'Saved' } })
  const { deps } = writeDeps(mock)
  mock.route('GET', '/api/itemTypeFields', (_req, _res, helpers) =>
    helpers.json([{ field: 'title' }]),
  )
  await expect(
    updateItem(deps, { item: ITEM_REF, set: { title: 'Saved', doi: '10.1/new' } }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  expect(
    mock.requests.some(
      (request) => request.method === 'PATCH' || request.pathname.includes('authorize'),
    ),
  ).toBe(false)
})

it('submits only the differing wire fields from a mixed request', async () => {
  serveItemRead(mock, { data: { title: 'Saved', DOI: '10.1/old' } })
  grantAuthorize(mock)
  mock.route('GET', '/api/itemTypeFields', (_req, _res, helpers) =>
    helpers.json([{ field: 'title' }, { field: 'DOI' }]),
  )
  mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
    helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, ''),
  )
  const { deps } = writeDeps(mock)
  expect(
    await updateItem(deps, { item: ITEM_REF, set: { title: 'Saved', doi: '10.1/new' } }),
  ).toMatchObject({ changed: ['doi'], version: 11 })
  expect(JSON.parse(mock.requests.find((request) => request.method === 'PATCH')!.body)).toEqual({
    DOI: '10.1/new',
  })
})
