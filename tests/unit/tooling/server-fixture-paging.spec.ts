/** Shared Local API fixtures honor explicit pagination without inventing a server default. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { serveSearchPage } from '../../helpers/server/serve.js'
import { searchHit } from '../../helpers/server/objects.js'
import { testHttpClient } from '../../helpers/test-clients.js'

let server: MockZotero
beforeEach(async () => {
  server = await MockZotero.start()
})
afterEach(async () => {
  await server.close()
})
const rows = Array.from({ length: 30 }, (_, index) =>
  searchHit({ key: `ITEM${String(index).padStart(4, '0')}` }),
)

it('returns distinct explicit windows and keeps Total-Results tied to the corpus', async () => {
  serveSearchPage(server, { items: rows })
  const client = testHttpClient(server.baseUrl)
  const first = await client.getJson<unknown[]>(
    'users/0/items/top',
    new URLSearchParams({ start: '0', limit: '2' }),
  )
  const second = await client.getJson<unknown[]>(
    'users/0/items/top',
    new URLSearchParams({ start: '2', limit: '2' }),
  )
  expect(first.json).toEqual(rows.slice(0, 2))
  expect(second.json).toEqual(rows.slice(2, 4))
  expect(first.headers.get('Total-Results')).toBe('30')
  expect(second.headers.get('Total-Results')).toBe('30')
})
it('returns the remaining corpus when no limit is supplied, matching the live API observation', async () => {
  serveSearchPage(server, { items: rows })
  const result = await testHttpClient(server.baseUrl).getJson<unknown[]>(
    'users/0/items/top',
    new URLSearchParams({ start: '3' }),
  )
  expect(result.json).toEqual(rows.slice(3))
})
it('anchors an intentionally partial fixture at its documented response offset', async () => {
  serveSearchPage(server, { items: rows.slice(20, 25), offset: 20, total: 30 })
  const result = await testHttpClient(server.baseUrl).getJson<unknown[]>(
    'users/0/items/top',
    new URLSearchParams({ start: '21', limit: '2' }),
  )
  expect(result.json).toEqual(rows.slice(21, 23))
  expect(result.headers.get('Total-Results')).toBe('30')
})
