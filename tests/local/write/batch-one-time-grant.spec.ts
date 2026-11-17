/** Native keyed updates spend one grant and preserve per-object commit proof. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'
import { writeKeyedItems } from '../../../src/local/write-keyed-batch.js'
import { withWriteKey } from '../../../src/local/write-domain.js'
import { parseRef } from '../../../src/refs.js'
import {
  batchHeaders,
  itemJson,
  SERVER_ID,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import { deferred } from '../../helpers/sync.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
  let grant = 0
  mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
    h.json({ key: String(++grant).repeat(32), remember: false }, { 'Zotero-Server-ID': SERVER_ID }),
  )
})
afterEach(async () => {
  await mock.close()
})

it('updates three items with one single-use grant and per-object version preconditions', async () => {
  const { deps } = writeDeps(mock)
  const keys = ['BATCH001', 'BATCH002', 'BATCH003']
  for (const key of keys)
    serveItemRead(mock, { key, version: 4, data: { tags: [{ tag: 'kept', type: 1 }] } })
  mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
    const entries = JSON.parse(mock.requests.at(-1)!.body) as {
      key: string
      version: number
      tags: unknown[]
    }[]
    expect(entries).toEqual(
      keys.map((key) => ({ key, version: 4, tags: [{ tag: 'kept', type: 1 }, { tag: 'new' }] })),
    )
    h.json(
      {
        successful: Object.fromEntries(
          entries.map((entry, index) => [
            index,
            itemJson(entry.key, 5 + index, { tags: entry.tags }),
          ]),
        ),
        success: {},
        unchanged: {},
        failed: {},
      },
      batchHeaders(7),
    )
  })
  const result = await batchItems(deps, {
    update: keys.map((key) => ({ ref: parseRef(`zotero://user/0/item/${key}`), addTags: ['new'] })),
  })
  expect(result.failed).toEqual([])
  expect(result.unverified).toEqual([])
  expect(result.updated.map((item) => item.version)).toEqual([5, 6, 7])
  expect(
    mock.requests.filter((request) => request.pathname === '/api/local/authorize'),
  ).toHaveLength(1)
  expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0)
})

it('does not dispatch a create when duplicate updates invalidate the reviewed batch', async () => {
  const { deps } = writeDeps(mock)
  await expect(
    batchItems(deps, {
      create: [{ itemType: 'book', title: 'New' }],
      update: [
        { ref: parseRef('zotero://user/0/item/BATCH001'), addTags: ['a'] },
        { ref: parseRef('zotero://user/0/item/BATCH001'), addTags: ['b'] },
      ],
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  expect(mock.requests.filter((request) => request.method === 'POST')).toEqual([])
})

it.each([
  'wrong-key',
  'wrong-field',
  'stale-version',
  'duplicate-key',
  'contradictory',
  'bad-index',
  'missing',
] as const)('keeps a %s receipt unverified without resending', async (fault) => {
  const { deps } = writeDeps(mock)
  mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
    const row = itemJson(
      fault === 'wrong-key' ? 'OTHER001' : 'BATCH001',
      fault === 'stale-version' ? 4 : 5,
      { tags: [{ tag: fault === 'wrong-field' ? 'other' : 'new' }] },
    )
    h.json(
      {
        successful: fault === 'missing' ? {} : { '0': row },
        success: fault === 'duplicate-key' ? { '1': 'BATCH001' } : {},
        unchanged: fault === 'contradictory' ? { '0': 'BATCH001' } : {},
        failed:
          fault === 'bad-index' ? { '03': { key: 'BATCH001', code: 400, message: 'bad' } } : {},
      },
      batchHeaders(5),
    )
  })
  const result = await writeKeyedItems(
    deps,
    [
      { key: 'BATCH001', version: 4, fields: { tags: [{ tag: 'new' }] } },
      { key: 'BATCH002', version: 4, fields: { tags: [] } },
    ],
    SERVER_ID,
  )
  expect(result.verdicts[0]).toEqual({ kind: 'unverified' })
  expect(mock.requests.filter((request) => request.pathname.endsWith('/items'))).toHaveLength(1)
})

it('leases one-time authorizations exclusively until their send settles', async () => {
  const { deps } = writeDeps(mock)
  const entered = deferred()
  const finish = deferred()
  const keys: string[] = []
  const first = withWriteKey(deps, SERVER_ID, undefined, async (key) => {
    keys.push(key)
    entered.resolve()
    await finish.promise
  })
  await entered.promise
  const second = withWriteKey(deps, SERVER_ID, undefined, async (key) => {
    keys.push(key)
  })
  expect(
    mock.requests.filter((request) => request.pathname === '/api/local/authorize'),
  ).toHaveLength(1)
  finish.resolve()
  await Promise.all([first, second])
  expect(keys).toEqual(['1'.repeat(32), '2'.repeat(32)])
})

it('accepts reordered tags in keyed-batch response as applied', async () => {
  const { deps } = writeDeps(mock)
  mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
    const row = itemJson('BATCH001', 5, {
      tags: [{ tag: 'b' }, { tag: 'a' }],
    })
    h.json(
      {
        successful: { '0': row },
        success: {},
        unchanged: {},
        failed: {},
      },
      batchHeaders(5),
    )
  })
  const result = await writeKeyedItems(
    deps,
    [{ key: 'BATCH001', version: 4, fields: { tags: [{ tag: 'a' }, { tag: 'b' }] } }],
    SERVER_ID,
  )
  expect(result.verdicts[0]).toEqual({
    kind: 'applied',
    key: 'BATCH001',
    version: 5,
    unchanged: false,
  })
})
