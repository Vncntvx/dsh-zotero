import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { batchItems } from '../../../src/local/write-batch.js'
import {
  WRITE_ABORTED_AFTER_DISPATCH_MESSAGE,
  ZoteroWriteCommitUnknownError,
} from '../../../src/errors.js'
import {
  batchHeaders,
  grantAuthorize,
  itemJson,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'

import { progress, deferred } from '../../helpers/sync.js'
import { expectZoteroError } from '../../helpers/error-expectations.js'
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
const written = (key: string, title = 'Requested one') =>
  itemJson(key, 25, { itemType: 'book', title })

describe('batch create cancellation', () => {
  it('rethrows a commit-unknown write when the caller already aborted', async () => {
    // The buckets this domain would otherwise build can never reach the
    // model: the pipeline masks a settled result of an aborted call with the
    // canonical cancellation. The commit state has to travel as the thrown
    // error instead, so the re-issue decision carries it.
    grantAuthorize(mock)
    const sync = progress()
    mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      sync.notify()
      h.delayJson(
        { successful: { '0': written('NEWITEM1') }, success: { '0': 'NEWITEM1' } },
        2000,
        batchHeaders(25),
      )
    })
    const { deps } = writeDeps(mock)
    const controller = new AbortController()
    const pending = batchItems(deps, { create: creates }, controller.signal)
    await sync.when(
      () => mock.requests.filter((r) => r.pathname === '/api/users/0/items').length === 1,
    )
    controller.abort()
    const error = await expectZoteroError(
      pending,
      TOOL_ABORTED,
      WRITE_ABORTED_AFTER_DISPATCH_MESSAGE,
    )
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
  })

  it('preserves completed receipts in commit-unknown when aborted during later operations', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      h.json(
        {
          successful: { '0': written('NEWITEM1') },
          success: { '0': 'NEWITEM1' },
          unchanged: {},
          failed: {},
        },
        batchHeaders(25),
      )
    })
    const controller = new AbortController()
    mock.route('GET', '/api/users/0/items/EXISTIN1', (_req, _res, h) => {
      controller.abort()
      h.delayJson(itemJson('EXISTIN1', 25, { itemType: 'journalArticle', tags: [] }), 100)
    })
    const { deps } = writeDeps(mock)
    const request = {
      create: [creates[0]],
      update: [
        {
          ref: {
            library: { type: 'user' as const, id: 0 },
            kind: 'item' as const,
            key: 'EXISTIN1',
            serverId: SERVER_ID,
          },
          addTags: ['test'],
        },
      ],
    }
    const pending = batchItems(deps, request, controller.signal)
    const error = await expectZoteroError(pending, TOOL_ABORTED)
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
    const unknownError = error as ZoteroWriteCommitUnknownError
    expect(unknownError.completedRefs).toEqual([
      `zotero://user/0/item/NEWITEM1?server=${SERVER_ID}`,
    ])
    expect(unknownError.partial).toMatchObject({
      kind: 'partial',
      total: 2,
      created: [
        expect.objectContaining({ ref: `zotero://user/0/item/NEWITEM1?server=${SERVER_ID}` }),
      ],
    })
  })

  it('names an unverified create when a later operation aborts', async () => {
    grantAuthorize(mock)
    serve({
      successful: {},
      success: {},
      unchanged: {},
      failed: { '0': { code: 400, message: 'bad' } },
    })
    const controller = new AbortController()
    mock.route('GET', '/api/users/0/items/EXISTIN1', (_req, _res, h) => {
      controller.abort()
      h.delayJson(itemJson('EXISTIN1', 25, { itemType: 'journalArticle', tags: [] }), 100)
    })
    const { deps } = writeDeps(mock)
    const pending = batchItems(
      deps,
      {
        create: [creates[0]!],
        update: [
          {
            ref: {
              library: { type: 'user' as const, id: 0 },
              kind: 'item' as const,
              key: 'EXISTIN1',
              serverId: SERVER_ID,
            },
            addTags: ['test'],
          },
        ],
      },
      controller.signal,
    )
    const error = await expectZoteroError(pending, TOOL_ABORTED)
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
    // A failed receipt without a key cannot prove the create was refused, so
    // it settles as unverified; the message must say that.
    expect((error as ZoteroWriteCommitUnknownError).message).toContain(
      'Unverified operations: create index 0',
    )
  })

  it('names a settled failure when a later delete aborts', async () => {
    grantAuthorize(mock)
    mock.route('GET', '/api/users/0/items/UPDITEM1', (_req, _res, h) => {
      h.json(itemJson('UPDITEM1', 9, { itemType: 'journalArticle', tags: [] }), batchHeaders(9))
    })
    mock.route('PATCH', '/api/users/0/items/UPDITEM1', (_req, _res, h) => {
      h.raw(412, { 'Zotero-Server-ID': SERVER_ID }, 'Changed')
    })
    const root = 'DELROOT1'
    mock.route('GET', `/api/users/0/items/${root}`, (_req, _res, h) => {
      h.json(itemJson(root, 9, { itemType: 'journalArticle', deleted: 0 }), batchHeaders(9))
    })
    mock.route('GET', `/api/users/0/items/${root}/children`, (_req, _res, h) => {
      h.json([], { ...batchHeaders(9), 'Total-Results': '0' })
    })
    const rootPatch = deferred<void>()
    mock.route('PATCH', `/api/users/0/items/${root}`, (_req, _res, h) => {
      rootPatch.resolve()
      h.delayRaw(204, batchHeaders(10), '', 2_000)
    })

    const { deps } = writeDeps(mock)
    const controller = new AbortController()
    const pending = batchItems(
      deps,
      {
        update: [
          {
            ref: {
              library: { type: 'user' as const, id: 0 },
              kind: 'item' as const,
              key: 'UPDITEM1',
              serverId: SERVER_ID,
            },
            addTags: ['test'],
          },
        ],
        delete: [
          {
            library: { type: 'user' as const, id: 0 },
            kind: 'item' as const,
            key: root,
            serverId: SERVER_ID,
          },
        ],
      },
      controller.signal,
    )
    await rootPatch.promise
    controller.abort()
    const error = await expectZoteroError(pending, TOOL_ABORTED)
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
    const message = (error as ZoteroWriteCommitUnknownError).message
    expect(message).toContain('Failed operations:')
    expect(message).toContain('ZOTERO_WRITE_CONFLICT')
  })
})
