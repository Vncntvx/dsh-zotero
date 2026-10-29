/** Every create index settles once, including uncertain commits and authorization renewal. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'
import { WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE } from '../../../src/errors.js'
import {
  batchHeaders,
  grantAuthorize,
  itemJson,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import { testWriteClient } from '../../helpers/test-clients.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => {
  await mock.close()
})
const creates = [
  { itemType: 'book' as const, title: 'Requested one' },
  { itemType: 'book' as const, title: 'Requested two' },
]
function serve(body: unknown): void {
  mock.route('POST', '/api/users/0/items', (_req, _res, h) => h.json(body, batchHeaders(25)))
}
const written = (key: string, title = 'Saved title') =>
  itemJson(key, 25, { itemType: 'book', title })

describe('batch create settlement', () => {
  it('uses saved data and input order for a success alongside a refusal and missing outcome', async () => {
    grantAuthorize(mock)
    serve({
      successful: { '0': written('NEWITEM1') },
      success: { '0': 'NEWITEM1' },
      failed: { '1': { key: '', code: 400, message: 'Invalid field' } },
    })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { create: [...creates, creates[0]] })
    expect(result.created).toEqual([
      {
        index: 0,
        ref: `zotero://user/0/item/NEWITEM1?server=${SERVER_ID}`,
        key: 'NEWITEM1',
        version: 25,
        itemType: 'book',
        title: 'Saved title',
      },
    ])
    expect(result.failed).toMatchObject([
      { op: 'create', index: 1, code: 'ZOTERO_INVALID_ARGUMENT' },
    ])
    expect(result.unverified).toMatchObject([
      { index: 2, reason: 'commit-unknown', retryable: false },
    ])
    expect(result.created.length + result.failed.length + result.unverified.length).toBe(
      result.total,
    )
  })

  it.each([
    ['success only', { success: { '0': 'NEWITEM1' } }, 'saved-state-unverified'],
    ['missing index', {}, 'commit-unknown'],
    ['unchanged only', { unchanged: { '0': 'NEWITEM1' } }, 'saved-state-unverified'],
    [
      'success and failure',
      { success: { '0': 'NEWITEM1' }, failed: { '0': { key: '', code: 400, message: 'no' } } },
      'commit-unknown',
    ],
    [
      'extra index',
      { successful: { '0': written('NEWITEM1'), '9': written('NEWITEM9') } },
      'commit-unknown',
    ],
    ['noncanonical index', { successful: { '00': written('NEWITEM1') } }, 'commit-unknown'],
    [
      'conflicting keys',
      { successful: { '0': written('NEWITEM1') }, success: { '0': 'OTHER001' } },
      'saved-state-unverified',
    ],
    [
      'invalid key',
      { successful: { '0': { key: 'invalid', version: 25 } } },
      'saved-state-unverified',
    ],
    [
      'missing echo',
      { successful: { '0': { key: 'NEWITEM1', version: 25 } } },
      'saved-state-unverified',
    ],
    [
      'missing version',
      { successful: { '0': { key: 'NEWITEM1', data: { key: 'NEWITEM1', itemType: 'book' } } } },
      'saved-state-unverified',
    ],
    [
      'wrong echo key',
      {
        successful: {
          '0': {
            key: 'NEWITEM1',
            version: 25,
            data: { key: 'OTHER001', version: 25, itemType: 'book' },
          },
        },
      },
      'saved-state-unverified',
    ],
    [
      'wrong type',
      { successful: { '0': itemJson('NEWITEM1', 25, { itemType: 'note' }) } },
      'saved-state-unverified',
    ],
  ])('accounts for %s without claiming a verified success', async (_name, body, reason) => {
    grantAuthorize(mock)
    serve(body)
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { create: [creates[0]] })
    expect(result.created).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.unverified).toMatchObject([
      { op: 'create', index: 0, committed: true, retryable: false, reason, serverId: SERVER_ID },
    ])
  })

  it('preserves a usable key/ref when the saved state is unavailable', async () => {
    grantAuthorize(mock)
    serve({ success: { '0': 'NEWITEM1' } })
    const { deps } = writeDeps(mock)
    expect((await batchItems(deps, { create: [creates[0]] })).unverified[0]).toMatchObject({
      key: 'NEWITEM1',
      ref: `zotero://user/0/item/NEWITEM1?server=${SERVER_ID}`,
    })
  })

  it('refuses duplicate keys across two response indices', async () => {
    grantAuthorize(mock)
    serve({ successful: { '0': written('NEWITEM1'), '1': written('NEWITEM1') } })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { create: creates })
    expect(result.created).toEqual([])
    expect(result.unverified.map((entry) => entry.index)).toEqual([0, 1])
  })

  it('keeps saved metadata instead of filling fields from the request', async () => {
    grantAuthorize(mock)
    serve({
      successful: { '1': written('NEWITEM2'), '0': itemJson('NEWITEM1', 25, { itemType: 'book' }) },
    })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { create: creates })
    expect(result.created.map((entry) => entry.index)).toEqual([0, 1])
    expect(result.created[0]).not.toHaveProperty('title')
  })

  it.each(['drop', 'oversize', 'malformed', 'missing-version'])(
    'never retries a %s response',
    async (kind) => {
      grantAuthorize(mock)
      mock.route('POST', '/api/users/0/items', (_req, res, h) => {
        if (kind === 'drop') res.destroy()
        else
          h.raw(
            200,
            kind === 'missing-version' ? { 'Zotero-Server-ID': SERVER_ID } : batchHeaders(25),
            kind === 'oversize' ? 'x'.repeat(2048) : '{',
          )
      })
      const { deps } = writeDeps(mock)
      const boundedDeps =
        kind === 'oversize'
          ? { ...deps, writer: testWriteClient(mock.baseUrl, { maxResponseBytes: 1024 }) }
          : deps
      const result = await batchItems(boundedDeps, { create: creates })
      expect(result.failed).toEqual([])
      expect(result.created).toEqual([])
      expect(result.unverified).toHaveLength(2)
      expect(
        result.unverified.every(
          (entry) => entry.reason === 'commit-unknown' && entry.retryable === false,
        ),
      ).toBe(true)
      expect(mock.requests.filter((r) => r.pathname === '/api/users/0/items')).toHaveLength(1)
    },
  )
})

describe('batch create authorization', () => {
  it.each([false, true])(
    'renews an expired grant and handles a second refusal (%s)',
    async (refuseAgain) => {
      let grants = 0
      mock.route('POST', '/api/local/authorize', (_req, _res, h) => {
        grants++
        h.json(
          { key: String(grants).repeat(32), remember: true },
          { 'Zotero-Server-ID': SERVER_ID },
        )
      })
      mock.route('POST', '/api/users/0/items', (req, _res, h) => {
        if (req.headers['zotero-api-key'] === '1'.repeat(32) || refuseAgain)
          h.raw(401, { 'Zotero-Server-ID': SERVER_ID }, 'Expired key')
        else h.json({ successful: { '0': written('NEWITEM1') } }, batchHeaders(25))
      })
      const { deps } = writeDeps(mock)
      const run = batchItems(deps, { create: [creates[0]] })
      if (refuseAgain)
        await expect(run).rejects.toMatchObject({
          code: 'ZOTERO_WRITE_UNAUTHORIZED',
          message: WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
        })
      else expect((await run).created).toHaveLength(1)
      expect(grants).toBe(2)
      expect(mock.requests.filter((r) => r.pathname === '/api/users/0/items')).toHaveLength(2)
    },
  )
})
