/**
 * The write transport's cancellation and bounds seam, split from
 * `write-http.spec.ts` along the same line: how a write settles when the
 * caller or the deadline interrupts it, and how the response bound holds.
 * The post-dispatch cancellation cases here pin the commit-unknown honesty
 * the deadline cases already carried.
 * @module tests/host/write/write-http-cancellation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import {
  UNPARSEABLE_RESPONSE_MESSAGE,
  requestTimeoutMessage,
  responseTooLargeMessage,
} from '../../../src/http-client.js'
import { ZoteroWriteHttpClient } from '../../../src/write-http.js'
import { TOOL_ABORTED_MESSAGE } from '../../../src/abort.js'
import {
  WRITE_ABORTED_AFTER_DISPATCH_MESSAGE,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
  ZoteroWriteCommitUnknownError,
  writeBatchShapeMessage,
} from '../../../src/errors.js'
import { expectZoteroError } from '../../helpers/error-expectations.js'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { testWriteClient } from '../../helpers/test-clients.js'
import { progress } from '../../helpers/sync.js'

let mock: MockZotero
let client: ZoteroWriteHttpClient

const SERVER_ID = 'srv-cancel-tests-01'
const API_KEY = 'placeholder-local-write-key'

/** A documented-shape batch answer for one created note. */
function batchBody(): Record<string, unknown> {
  return {
    successful: {
      '0': { key: 'NEWKEY123', version: 12, data: { itemType: 'note', note: '<div>x</div>' } },
    },
    success: { '0': 'NEWKEY123' },
    unchanged: {},
    failed: {},
  }
}

/** Write-response headers carrying the identity and the library version. */
function batchResponseHeaders(version = 42): Record<string, string> {
  return { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }
}

function writeOptions(): { serverId: string; apiKey: string } {
  return { serverId: SERVER_ID, apiKey: API_KEY }
}

beforeEach(async () => {
  mock = await MockZotero.start()
  client = testWriteClient(mock.baseUrl)
})

afterEach(async () => {
  await mock.close()
})

describe('cancellation and bounds', () => {
  it('reports the provider deadline as a timeout', async () => {
    const short = testWriteClient(mock.baseUrl, { timeoutMs: 20 })
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.delayJson(batchBody(), 2000),
    )
    await expectZoteroError(
      short.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_TIMEOUT,
      requestTimeoutMessage(20),
    )
  })

  it('carries caller cancellation through the single flight slot as commit-unknown after dispatch', async () => {
    const controller = new AbortController()
    const sync = progress()
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      sync.notify()
      helpers.delayJson(batchBody(), 2000)
    })
    const pending = client.batch('users/0/items', [{ itemType: 'note' }], {
      ...writeOptions(),
      signal: controller.signal,
    })
    await sync.when(() => mock.requests.length === 1)
    controller.abort()
    // The request reached the mock, so the write may have committed: the
    // abort must not read as a clean cancellation.
    const error = await expectZoteroError(
      pending,
      TOOL_ABORTED,
      WRITE_ABORTED_AFTER_DISPATCH_MESSAGE,
    )
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
  })

  it('translates a queued abort into the same cancellation error', async () => {
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const sync = progress()
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      sync.notify()
      helpers.delayJson(batchBody(), 2000)
    })
    const first = client.batch('users/0/items', [{ itemType: 'note' }], {
      ...writeOptions(),
      signal: firstAbort.signal,
    })
    await sync.when(() => mock.requests.length === 1)
    const second = client.batch('users/0/items', [{ itemType: 'note' }], {
      ...writeOptions(),
      signal: secondAbort.signal,
    })
    // The queued call never dispatched: its cancellation stays clean.
    secondAbort.abort()
    await expectZoteroError(second, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
    // The in-flight call dispatched: its cancellation is commit-unknown.
    firstAbort.abort()
    const error = await expectZoteroError(first, TOOL_ABORTED, WRITE_ABORTED_AFTER_DISPATCH_MESSAGE)
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
  })

  it('refuses a batch body that is not a JSON record', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(42), JSON.stringify([1, 2, 3])),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      UNPARSEABLE_RESPONSE_MESSAGE,
    )
  })

  it('enforces the response byte bound on write responses', async () => {
    const small = testWriteClient(mock.baseUrl, { maxResponseBytes: 16 })
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), JSON.stringify(batchBody())),
    )
    await expectZoteroError(
      small.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_RESPONSE_TOO_LARGE,
      responseTooLargeMessage(16),
    )
  })

  it('refuses a batch response whose successful entry is not an object', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchResponseHeaders(42),
        JSON.stringify({ ...batchBody(), successful: { '0': 'not an object' } }),
      ),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      writeBatchShapeMessage('successful'),
    )
  })

  it('refuses a batch response whose failed entry is not an object', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchResponseHeaders(42),
        JSON.stringify({ ...batchBody(), failed: { '0': 'not an object' } }),
      ),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      writeBatchShapeMessage('failed'),
    )
  })

  it('marks a patch write as commit-unknown when the connection drops', async () => {
    mock.route('PATCH', '/api/users/0/items/ITEM1234', (_req, res) => {
      res.destroy()
    })
    await expect(
      client.patch(
        'users/0/items/ITEM1234',
        { tags: [] },
        {
          ...writeOptions(),
          ifUnmodifiedSinceVersion: 1,
        },
      ),
    ).rejects.toBeInstanceOf(ZoteroWriteCommitUnknownError)
  })
})
