/** Page folding releases raw rows before sibling requests settle and refuses impossible totals. */
import { expect, it, vi } from 'vitest'
import {
  MAX_LISTING_PAGES,
  MAX_LISTING_ROWS,
  readAllPages,
  readPagesConcurrentlyFolded,
} from '../../src/local/pagination.js'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { deferred } from '../helpers/sync.js'

const what = { body: 'bounded listing', page: 'bounded listing' }
function response(json: unknown, total: number, version = 7) {
  return {
    json,
    headers: new Headers({
      'Zotero-Server-ID': 'server',
      'Last-Modified-Version': String(version),
      'Total-Results': String(total),
    }),
  }
}

it('folds a completed page while another request still owns its raw response', async () => {
  const entered = deferred()
  const finish = deferred()
  const secondFolded = deferred()
  const getJson = vi.fn(async (_path: string, query: URLSearchParams) => {
    const offset = Number(query.get('start'))
    if (offset === 200) {
      entered.resolve()
      await finish.promise
    }
    return response(
      Array.from({ length: 100 }, (_unused, index) => ({
        key: offset + index,
        largeUnused: 'metadata'.repeat(100),
      })),
      300,
    )
  })
  const client = { getJson } as unknown as ZoteroHttpClient
  const pending = readPagesConcurrentlyFolded(
    client,
    'users/0/items',
    new URLSearchParams(),
    undefined,
    undefined,
    what,
    2,
    (rows, offset, serverId) => {
      expect(serverId).toBe('server')
      if (offset === 100) secondFolded.resolve()
      return rows.map((row) => (row as { key: number }).key)
    },
  )
  await entered.promise
  await secondFolded.promise
  finish.resolve()
  const result = await pending
  expect(result.pages.map((page) => page.value.length)).toEqual([100, 100, 100])
  expect(result.pages.flatMap((page) => page.value)).toEqual(
    Array.from({ length: 300 }, (_unused, index) => index),
  )
})

it.each([MAX_LISTING_ROWS + 1, Number.MAX_SAFE_INTEGER])(
  'refuses total %s before scheduling more pages',
  async (total) => {
    const getJson = vi.fn(async () => response([{ key: 'one' }], total))
    const client = { getJson } as unknown as ZoteroHttpClient
    await expect(
      readPagesConcurrentlyFolded(
        client,
        'items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (rows) => rows.length,
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
    expect(getJson).toHaveBeenCalledTimes(1)
  },
)

it('refuses an implausible tiny-page walk without materializing all its windows', async () => {
  const getJson = vi.fn(async () => response([{ key: 'one' }], MAX_LISTING_PAGES + 1))
  const client = { getJson } as unknown as ZoteroHttpClient
  await expect(
    readPagesConcurrentlyFolded(
      client,
      'items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
      (rows) => rows.length,
    ),
  ).rejects.toThrow(`${MAX_LISTING_PAGES}-page limit`)
  expect(getJson).toHaveBeenCalledTimes(1)
})

it.each(['total', 'version', 'overlong'] as const)(
  'refuses a sequential listing with a changed %s',
  async (fault) => {
    let reads = 0
    const getJson = vi.fn(async () =>
      ++reads === 1
        ? response([{ key: 'one' }], 2)
        : response(
            fault === 'overlong' ? [{ key: 'two' }, { key: 'three' }] : [{ key: 'two' }],
            fault === 'total' ? 3 : 2,
            fault === 'version' ? 8 : 7,
          ),
    )
    const client = { getJson } as unknown as ZoteroHttpClient
    await expect(
      readAllPages(client, 'items', {}, 'server', undefined, what, undefined, () => {}),
    ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
    expect(getJson).toHaveBeenCalledTimes(2)
  },
)
