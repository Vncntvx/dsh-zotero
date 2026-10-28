/** Concurrent listing pagination: window discovery and short-page gap repair. */
import { describe, expect, it } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { readPagesConcurrently, readPagesConcurrentlyFolded } from '../../src/local/pagination.js'

function rowsOf(total: number): { key: string }[] {
  return Array.from({ length: total }, (_, index) => ({
    key: `K${String(index).padStart(4, '0')}`,
  }))
}

function clientOf(
  rows: readonly { key: string }[],
  options: {
    readonly pageCap?: number
    readonly shortAt?: Map<number, number>
    readonly overlongAt?: Set<number>
    readonly versionAt?: Map<number, number>
    readonly serverId?: string
  } = {},
): ZoteroHttpClient {
  return {
    getJson: async (_path: string, params: URLSearchParams) => {
      const start = Number(params.get('start') ?? '0')
      const limit = Number(params.get('limit') ?? '100')
      const capped = Math.min(limit, options.pageCap ?? limit)
      const short = options.shortAt?.get(start)
      const overlong = options.overlongAt?.has(start) === true
      const pageSize = overlong ? limit + 1 : (short ?? capped)
      const version = options.versionAt?.get(start) ?? 7
      return {
        json: rows.slice(start, start + pageSize),
        headers: new Headers({
          'Zotero-Server-ID': options.serverId ?? 'S1',
          'Last-Modified-Version': String(version),
          'Total-Results': String(rows.length),
        }),
      }
    },
  } as unknown as ZoteroHttpClient
}

const what = { body: 'listing', page: 'listing' }

describe('readPagesConcurrentlyFolded', () => {
  it('walks full pages at the configured window', async () => {
    const rows = rowsOf(250)
    const result = await readPagesConcurrentlyFolded(
      clientOf(rows),
      '/items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
      (page) => page,
    )
    expect(result.total).toBe(250)
    expect(result.pages.map((page) => page.offset)).toEqual([0, 100, 200])
    expect(result.pages.flatMap((page) => page.value)).toHaveLength(250)
  })

  it('uses the first page cap as the stride instead of skipping rows', async () => {
    const rows = rowsOf(100)
    const result = await readPagesConcurrentlyFolded(
      clientOf(rows, { pageCap: 40 }),
      '/items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
      (page) => page,
    )
    expect(result.pages.map((page) => page.offset)).toEqual([0, 40, 80])
    expect(result.pages.flatMap((page) => page.value)).toHaveLength(100)
  })

  it('repairs a short middle page at the exact missing offset', async () => {
    const rows = rowsOf(120)
    const result = await readPagesConcurrentlyFolded(
      clientOf(rows, { shortAt: new Map([[100, 10]]) }),
      '/items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
      (page) => page,
    )
    expect(result.pages.map((page) => page.offset)).toEqual([0, 100, 110])
    expect(result.pages.flatMap((page) => page.value)).toHaveLength(120)
  })

  it('refuses an overlong page', async () => {
    const rows = rowsOf(120)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, { overlongAt: new Set([0]) }),
        '/items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('refuses an empty in-range page', async () => {
    const rows = rowsOf(120)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, { shortAt: new Map([[100, 0]]) }),
        '/items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('refuses a repair page from a different library version', async () => {
    const rows = rowsOf(120)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, {
          shortAt: new Map([[100, 10]]),
          versionAt: new Map([[110, 8]]),
        }),
        '/items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('refuses an answer from a different instance', async () => {
    const rows = rowsOf(10)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, { serverId: 'S2' }),
        '/items',
        new URLSearchParams(),
        'S1',
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_SERVER_MISMATCH' })
  })

  it('returns one empty page when the listing reports zero rows', async () => {
    const result = await readPagesConcurrentlyFolded(
      clientOf([]),
      '/items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
      (page) => page,
    )
    expect(result.total).toBe(0)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]?.value).toEqual([])
  })

  it('refuses a later window that returns more rows than requested', async () => {
    const rows = rowsOf(250)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, { overlongAt: new Set([100]) }),
        '/items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('refuses a repair page that cannot fill its gap', async () => {
    const rows = rowsOf(120)
    await expect(
      readPagesConcurrentlyFolded(
        clientOf(rows, {
          shortAt: new Map([
            [100, 10],
            [110, 0],
          ]),
        }),
        '/items',
        new URLSearchParams(),
        undefined,
        undefined,
        what,
        4,
        (page) => page,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('keeps the raw-row wrapper in listing order', async () => {
    const rows = rowsOf(120)
    const result = await readPagesConcurrently(
      clientOf(rows, { shortAt: new Map([[100, 10]]) }),
      '/items',
      new URLSearchParams(),
      undefined,
      undefined,
      what,
      4,
    )
    expect(result.rows.map((row) => (row as { key: string }).key)).toEqual(
      rows.map((row) => row.key),
    )
  })
})
