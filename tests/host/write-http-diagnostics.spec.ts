/**
 * The write transport's diagnostics logging: attempt/outcome lines at info,
 * refusals at error with the stable code, our own deadline at warn, and a
 * caller abort at debug. The read transport's counterpart lives in
 * `http-client.spec.ts`.
 * @module tests/host/write-http-diagnostics
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { TOOL_ABORTED_MESSAGE } from '../../src/abort.js'
import { ZOTERO_API_DISABLED, ZOTERO_TIMEOUT } from '../../src/errors.js'
import { expectZoteroError } from '../helpers/error-expectations.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { recordingSink } from '../helpers/recording-sink.js'
import { testWriteClient } from '../helpers/test-clients.js'
import { deferred } from '../helpers/sync.js'
import { SERVER_ID } from '../helpers/server/keys.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await MockZotero.start()
})

afterEach(async () => {
  await mock.close()
})

function writeOptions(): { serverId: string; apiKey: string } {
  return { serverId: SERVER_ID, apiKey: 'key-for-tests' }
}

describe('the write transport diagnostics log', () => {
  it('logs attempt and outcome at info around a successful write', async () => {
    mock.route('PATCH', '/api/users/0/items/ABCD1234', (_req, _res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '9' }, ''),
    )
    const { sink, lines } = recordingSink()
    const observed = testWriteClient(mock.baseUrl, { sink })
    await observed.patch(
      'users/0/items/ABCD1234',
      { tags: [] },
      { ...writeOptions(), ifUnmodifiedSinceVersion: 4 },
    )
    expect(lines.find((candidate) => candidate.event === 'write.attempt')).toMatchObject({
      level: 'info',
      message: 'PATCH users/0/items/ABCD1234',
    })
    const outcome = lines.find((candidate) => candidate.event === 'write.outcome')
    expect(outcome).toMatchObject({ level: 'info', detail: { status: 204 } })
    expect(typeof outcome?.detail?.ms).toBe('number')
  })

  it('logs a refused write at error with the stable code', async () => {
    mock.route('PATCH', '/api/users/0/items/ABCD1234', (_req, _res, helpers) =>
      helpers.raw(403, { 'Content-Type': 'text/plain' }, 'denied'),
    )
    const { sink, lines } = recordingSink()
    const observed = testWriteClient(mock.baseUrl, { sink })
    const error = await expectZoteroError(
      observed.patch(
        'users/0/items/ABCD1234',
        { tags: [] },
        { ...writeOptions(), ifUnmodifiedSinceVersion: 4 },
      ),
      ZOTERO_API_DISABLED,
    )
    const line = lines.find((candidate) => candidate.event === 'write.failure')
    expect(line?.level).toBe('error')
    expect(line?.message).toContain('PATCH users/0/items/ABCD1234')
    expect(line?.detail?.errorCode).toBe(error.code)
  })

  it('logs a write deadline at warn and a caller abort at debug', async () => {
    const { sink, lines } = recordingSink()
    const fast = testWriteClient(mock.baseUrl, { timeoutMs: 50, sink })
    mock.route('PATCH', '/api/users/0/items/ABCD1234', (_req, _res, helpers) =>
      helpers.delayJson({}, 5000),
    )
    await expectZoteroError(
      fast.patch(
        'users/0/items/ABCD1234',
        { tags: [] },
        { ...writeOptions(), ifUnmodifiedSinceVersion: 4 },
      ),
      ZOTERO_TIMEOUT,
    )
    expect(lines.find((candidate) => candidate.event === 'write.timeout')?.level).toBe('warn')

    const outstanding = deferred()
    const controller = new AbortController()
    mock.route('PATCH', '/api/users/0/items/ABCD4321', (_req, _res, helpers) => {
      outstanding.resolve()
      helpers.delayJson({}, 5000)
    })
    const pending = testWriteClient(mock.baseUrl, { sink }).patch(
      'users/0/items/ABCD4321',
      { tags: [] },
      { ...writeOptions(), ifUnmodifiedSinceVersion: 4, signal: controller.signal },
    )
    await outstanding.promise
    controller.abort()
    await expectZoteroError(pending, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
    expect(lines.find((candidate) => candidate.event === 'write.abort')?.level).toBe('debug')
  })
})
