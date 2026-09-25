import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import {
  OBJECT_NOT_FOUND_MESSAGE,
  REDIRECT_REFUSED_MESSAGE,
  UNPARSEABLE_RESPONSE_MESSAGE,
  httpStatusMessage,
  requestTimeoutMessage,
  responseTooLargeMessage,
} from '../../src/http-client.js'
import { ZoteroWriteHttpClient, ZoteroWriteCommitUnknownError } from '../../src/write-http.js'
import {
  API_DISABLED_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  TOOL_ABORTED_MESSAGE,
  WRITE_AUTH_DENIED_MESSAGE,
  WRITE_BATCH_REFUSED_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_IDENTITY_MISSING_MESSAGE,
  WRITE_LIBRARY_VERSION_MISSING_MESSAGE,
  WRITE_PRECONDITION_REFUSED_MESSAGE,
  WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE,
  WRITE_UNAUTHORIZED_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_NOT_FOUND,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_RATE_LIMITED,
  ZOTERO_WRITE_UNAUTHORIZED,
  writeBatchShapeMessage,
  writeRateLimitedMessage,
} from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { progress } from '../helpers/sync.js'

let mock: MockZotero
let client: ZoteroWriteHttpClient

const SERVER_ID = 'srv-id-for-tests-01'
const API_KEY = 'localwritekey0123456789abcdef'

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
  client = new ZoteroWriteHttpClient({
    baseUrl: mock.baseUrl,
    timeoutMs: 5000,
    maxResponseBytes: 1024 * 1024,
  })
})

afterEach(async () => {
  await mock.close()
})

async function expectZoteroError(
  promise: Promise<unknown>,
  code: string,
  messagePart?: string,
): Promise<HarnessError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(HarnessError)
  const harnessError = thrown as HarnessError
  expect(harnessError.code).toBe(code)
  if (messagePart !== undefined) expect(harnessError.message).toContain(messagePart)
  return harnessError
}

describe('request shaping', () => {
  it('sends the write headers: API version, instance id, API key, write token, JSON body', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), JSON.stringify(batchBody())),
    )
    await client.batch(
      'users/0/items',
      [{ itemType: 'note', note: '<div>x</div>' }],
      writeOptions(),
    )
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.pathname).toBe('/api/users/0/items')
    expect(request.headers['zotero-api-version']).toBe('3')
    expect(request.headers['zotero-server-id']).toBe(SERVER_ID)
    expect(request.headers['zotero-api-key']).toBe(API_KEY)
    expect(request.headers['content-type']).toBe('application/json')
    expect(String(request.headers['zotero-write-token'])).toMatch(/^[a-f0-9]{32}$/)
    expect(JSON.parse(request.body)).toEqual([{ itemType: 'note', note: '<div>x</div>' }])
  })

  it('sends a fresh write token on every attempt', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), JSON.stringify(batchBody())),
    )
    await client.batch('users/0/items', [{ itemType: 'note' }], writeOptions())
    await client.batch('users/0/items', [{ itemType: 'note' }], writeOptions())
    const [first, second] = mock.requests
    expect(String(first!.headers['zotero-write-token'])).toMatch(/^[a-f0-9]{32}$/)
    expect(String(second!.headers['zotero-write-token'])).toMatch(/^[a-f0-9]{32}$/)
    expect(first!.headers['zotero-write-token']).not.toBe(second!.headers['zotero-write-token'])
  })

  it('sends PATCH preconditions instead of a write token, and parses the library version off 204', async () => {
    mock.route('PATCH', '/api/users/0/items/ABCD1234', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '9' }, ''),
    )
    const result = await client.patch(
      'users/0/items/ABCD1234',
      { tags: [{ tag: 'methods' }] },
      { ...writeOptions(), ifUnmodifiedSinceVersion: 4 },
    )
    expect(result).toEqual({ libraryVersion: 9 })
    const request = mock.requests[0]!
    expect(request.method).toBe('PATCH')
    expect(request.headers['if-unmodified-since-version']).toBe('4')
    expect(request.headers['zotero-write-token']).toBeUndefined()
    expect(JSON.parse(request.body)).toEqual({ tags: [{ tag: 'methods' }] })
  })

  it('keeps exactly one write in flight: the second batch waits for the first to finish', async () => {
    let releaseFirst: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const started: string[] = []
    const sync = progress()
    mock.route('POST', '/api/users/0/items', async (_req, res, helpers) => {
      started.push(mock.requests.length === 1 ? 'first' : 'second')
      sync.notify()
      if (started.length === 1) await release
      helpers.raw(200, batchResponseHeaders(), JSON.stringify(batchBody()))
    })
    const first = client.batch('users/0/items', [{ itemType: 'note' }], writeOptions())
    const second = client.batch('users/0/items', [{ itemType: 'note' }], writeOptions())
    await sync.when(() => started.length === 1)
    releaseFirst!()
    await Promise.all([first, second])
    expect(started).toEqual(['first', 'second'])
  })

  it('refuses to hit the network before any read established the instance id', async () => {
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], { serverId: '', apiKey: API_KEY }),
      ZOTERO_UNEXPECTED,
      WRITE_IDENTITY_MISSING_MESSAGE,
    )
    expect(mock.requests).toHaveLength(0)
  })
})

describe('batch outcome buckets', () => {
  it('parses the four buckets with the library version the batch advanced to', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchResponseHeaders(),
        JSON.stringify({
          successful: { '0': { key: 'NEWKEY123', version: 12 } },
          success: { '0': 'NEWKEY123' },
          unchanged: { '1': 'OLDKEY456' },
          failed: { '2': { key: 'OLDBAD789', code: 412, message: 'version mismatch' } },
        }),
      ),
    )
    const result = await client.batch(
      'users/0/items',
      [{ itemType: 'note' }, { key: 'OLDKEY456' }, { key: 'OLDBAD789', version: 3 }],
      writeOptions(),
    )
    expect(result.libraryVersion).toBe(12)
    expect(result.successful['0']).toEqual({ key: 'NEWKEY123', version: 12 })
    expect(result.success['0']).toBe('NEWKEY123')
    expect(result.unchanged['1']).toBe('OLDKEY456')
    expect(result.failed['2']).toEqual({ key: 'OLDBAD789', code: 412, message: 'version mismatch' })
  })

  it('tolerates buckets Zotero omits when empty', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchResponseHeaders(),
        JSON.stringify({ successful: { '0': { key: 'NEWKEY123', version: 12 } } }),
      ),
    )
    const result = await client.batch('users/0/items', [{ itemType: 'note' }], writeOptions())
    expect(result.success).toEqual({})
    expect(result.unchanged).toEqual({})
    expect(result.failed).toEqual({})
  })

  it('fails loud on a non-record successful bucket', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), JSON.stringify({ successful: 'all good' })),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      writeBatchShapeMessage('successful'),
    )
  })

  it('fails loud on a success bucket whose values are not object keys', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), JSON.stringify({ success: { '0': 42 } })),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      writeBatchShapeMessage('success'),
    )
  })

  it('fails loud on a failed entry missing its status or statement', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchResponseHeaders(),
        JSON.stringify({ failed: { '0': { key: 'BROKEN123' } } }),
      ),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      writeBatchShapeMessage('failed'),
    )
  })

  it('refuses an unparseable batch body', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchResponseHeaders(), 'not json'),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      UNPARSEABLE_RESPONSE_MESSAGE,
    )
  })

  it('refuses malformed library-version headers instead of coercing them', async () => {
    let version = ''
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': version },
        JSON.stringify(batchBody()),
      ),
    )
    for (const malformed of ['', '1.5', 'Infinity', '9007199254740992']) {
      version = malformed
      await expectZoteroError(
        client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
        ZOTERO_UNEXPECTED,
        WRITE_LIBRARY_VERSION_MISSING_MESSAGE,
      )
    }
  })

  it('refuses a write answer without the documented library-version header', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify(batchBody())),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      WRITE_LIBRARY_VERSION_MISSING_MESSAGE,
    )
  })
})

describe('write status translations', () => {
  async function expectWriteStatus(
    status: number,
    body: string,
    headers: Record<string, string>,
    code: string,
    messagePart: string,
    path = '/api/users/0/items',
  ): Promise<void> {
    const relative = path.replace(/^\/api\//, '')
    mock.route('POST', path, (_req, res, helpers) => helpers.raw(status, headers, body))
    await expectZoteroError(
      client.batch(relative, [{ itemType: 'note' }], writeOptions()),
      code,
      messagePart,
    )
  }

  it('rejects a successful response served by a different instance', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': 'srv-other', 'Last-Modified-Version': '42' },
        JSON.stringify(batchBody()),
      ),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_SERVER_MISMATCH,
      SERVER_MISMATCH_MESSAGE,
    )
  })

  it('rejects a successful response without the serving instance id', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, { 'Last-Modified-Version': '42' }, JSON.stringify(batchBody())),
    )
    await expectZoteroError(
      client.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_UNEXPECTED,
      WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE,
    )
  })

  it('maps 401 onto the re-authorization path', async () => {
    await expectWriteStatus(
      401,
      'API key required -- POST /api/local/authorize to obtain one',
      { 'Content-Type': 'text/plain' },
      ZOTERO_WRITE_UNAUTHORIZED,
      WRITE_UNAUTHORIZED_MESSAGE,
    )
  })

  it('maps a declined authorization dialog onto the denied message', async () => {
    await expectWriteStatus(
      403,
      '{"denied": true}',
      { 'Content-Type': 'application/json' },
      ZOTERO_WRITE_UNAUTHORIZED,
      WRITE_AUTH_DENIED_MESSAGE,
    )
  })

  it('maps the 403 disabled-API statement onto the API-disabled diagnosis', async () => {
    await expectWriteStatus(
      403,
      'Local API is not enabled',
      { 'Content-Type': 'text/plain' },
      ZOTERO_API_DISABLED,
      API_DISABLED_MESSAGE,
    )
  })

  it('splits the 412 fork: an identity mismatch refuses the instance, not the version', async () => {
    await expectWriteStatus(
      412,
      'Zotero-Server-ID does not match this server',
      { 'Content-Type': 'text/plain' },
      ZOTERO_SERVER_MISMATCH,
      SERVER_MISMATCH_MESSAGE,
    )
  })

  it('splits the 412 fork: a failed version precondition is a re-run, not an identity loss', async () => {
    await expectWriteStatus(
      412,
      'item has been modified since specified version (expected 3, found 5)',
      { 'Content-Type': 'text/plain' },
      ZOTERO_WRITE_CONFLICT,
      WRITE_CONFLICT_MESSAGE,
    )
  })

  it('fails loud on 428 and 413 as protocol drift', async () => {
    await expectWriteStatus(
      428,
      'If-Unmodified-Since-Version not provided',
      { 'Content-Type': 'text/plain' },
      ZOTERO_UNEXPECTED,
      WRITE_PRECONDITION_REFUSED_MESSAGE,
      '/api/users/0/items/precondition',
    )
    await expectWriteStatus(
      413,
      'Cannot add more than 50 items at a time',
      { 'Content-Type': 'text/plain' },
      ZOTERO_UNEXPECTED,
      WRITE_BATCH_REFUSED_MESSAGE,
      '/api/users/0/items/batch-size',
    )
  })

  it('carries Retry-After into the rate-limit message', async () => {
    await expectWriteStatus(
      429,
      'Too many authorization requests',
      { 'Content-Type': 'text/plain', 'Retry-After': '7' },
      ZOTERO_WRITE_RATE_LIMITED,
      writeRateLimitedMessage(7),
    )
  })

  it('reports the rate limit without a header as a minute-scale wait', async () => {
    await expectWriteStatus(
      429,
      'Too many authorization requests',
      { 'Content-Type': 'text/plain' },
      ZOTERO_WRITE_RATE_LIMITED,
      writeRateLimitedMessage(undefined),
    )
  })

  it('maps 404 onto the not-found diagnosis', async () => {
    await expectWriteStatus(
      404,
      'Not found',
      { 'Content-Type': 'text/plain' },
      ZOTERO_NOT_FOUND,
      OBJECT_NOT_FOUND_MESSAGE,
    )
  })

  it('refuses redirects and reports unknown statuses generically', async () => {
    await expectWriteStatus(
      302,
      '',
      { Location: 'http://example.invalid/x' },
      ZOTERO_UNEXPECTED,
      REDIRECT_REFUSED_MESSAGE,
      '/api/users/0/items/redirect',
    )
    await expectWriteStatus(
      500,
      'boom',
      { 'Content-Type': 'text/plain' },
      ZOTERO_UNEXPECTED,
      httpStatusMessage(500),
      '/api/users/0/items/unknown',
    )
  })
})

describe('cancellation and bounds', () => {
  it('reports the provider deadline as a timeout', async () => {
    const short = new ZoteroWriteHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 20,
      maxResponseBytes: 1024 * 1024,
    })
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.delayJson(batchBody(), 2000),
    )
    await expectZoteroError(
      short.batch('users/0/items', [{ itemType: 'note' }], writeOptions()),
      ZOTERO_TIMEOUT,
      requestTimeoutMessage(20),
    )
  })

  it('carries caller cancellation through the single flight slot', async () => {
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
    await expectZoteroError(pending, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
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
    secondAbort.abort()
    await expectZoteroError(second, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
    firstAbort.abort()
    await expectZoteroError(first, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
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
    const small = new ZoteroWriteHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 16,
    })
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

describe('authorize', () => {
  it('POSTs the app name without an API key and returns the grant', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'K'.repeat(32), remember: true }),
      ),
    )
    const grant = await client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID })
    expect(grant).toEqual({ key: 'K'.repeat(32), remember: true })
    const request = mock.requests[0]!
    expect(request.pathname).toBe('/api/local/authorize')
    expect(request.headers['zotero-api-key']).toBeUndefined()
    expect(request.headers['zotero-server-id']).toBe(SERVER_ID)
    expect(JSON.parse(request.body)).toEqual({ appName: 'dsh (Zotero plugin)' })
  })

  it('maps a declined dialog onto the denied message', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(403, { 'Content-Type': 'application/json' }, '{"denied": true}'),
    )
    await expectZoteroError(
      client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID }),
      ZOTERO_WRITE_UNAUTHORIZED,
      WRITE_AUTH_DENIED_MESSAGE,
    )
  })

  it('maps the rate limit with its Retry-After', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        429,
        { 'Content-Type': 'text/plain', 'Retry-After': '12' },
        'Too many authorization requests',
      ),
    )
    await expectZoteroError(
      client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID }),
      ZOTERO_WRITE_RATE_LIMITED,
      writeRateLimitedMessage(12),
    )
  })

  it('rejects a grant response without the serving instance id', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(200, {}, JSON.stringify({ key: 'K'.repeat(32), remember: true })),
    )
    await expectZoteroError(
      client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID }),
      ZOTERO_UNEXPECTED,
      WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE,
    )
  })

  it('fails loud on a grant response without a key', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({ remember: false })),
    )
    await expectZoteroError(
      client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID }),
      ZOTERO_UNEXPECTED,
    )
  })

  it('fails loud when authorization response is unparseable JSON', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, 'not-json'),
    )
    await expectZoteroError(
      client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID }),
      ZOTERO_UNEXPECTED,
      UNPARSEABLE_RESPONSE_MESSAGE,
    )
  })

  it('translates network drops during authorization without commit-unknown', async () => {
    mock.route('POST', '/api/local/authorize', (_req, res) => {
      res.destroy()
    })
    const promise = client.authorize('dsh (Zotero plugin)', { serverId: SERVER_ID })
    await expect(promise).rejects.not.toBeInstanceOf(ZoteroWriteCommitUnknownError)
  })

  it('enforces the response byte bound on authorize responses', async () => {
    const small = new ZoteroWriteHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 16,
    })
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'K'.repeat(32), remember: true }),
      ),
    )
    await expectZoteroError(
      small.authorize('dsh', { serverId: SERVER_ID }),
      ZOTERO_RESPONSE_TOO_LARGE,
      responseTooLargeMessage(16),
    )
  })
})
