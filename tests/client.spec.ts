import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ZoteroHttpClient } from '../src/http-client.js'
import {
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_RUNNING,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
} from '../src/errors.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero
let client: ZoteroHttpClient

beforeEach(async () => {
  mock = await MockZotero.start()
  client = new ZoteroHttpClient({
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
  it('serializes repeated params and handles a base URL with a trailing slash', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.json([]))
    const slashed = new ZoteroHttpClient({
      baseUrl: `${mock.baseUrl}/`,
      timeoutMs: 5000,
      maxResponseBytes: 1024,
    })
    await slashed.getJson(
      'users/0/items',
      new URLSearchParams([
        ['tag', 'a'],
        ['tag', 'b'],
        ['q', 'x y'],
      ]),
    )
    const request = mock.requests[0]!
    expect(request.pathname).toBe('/api/users/0/items')
    expect(request.headers['zotero-api-version']).toBe('3')
    expect(request.search.getAll('tag')).toEqual(['a', 'b'])
    expect(request.search.get('q')).toBe('x y')
  })

  it('does not send a server id before one is known (pre-Zotero-10 responses carry none)', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-API-Version': '3' }),
    )
    await client.getJson('')
    expect(mock.requests[0]!.headers['zotero-server-id']).toBeUndefined()
    expect(client.serverId).toBeUndefined()
  })

  it('records the server id from responses and echoes it on later requests', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([], { 'Zotero-Server-ID': 'sPMHtLD6HHBd' }),
    )
    await client.getJson('users/0/items')
    expect(client.serverId).toBe('sPMHtLD6HHBd')
    await client.getJson('users/0/items')
    expect(mock.requests[1]!.headers['zotero-server-id']).toBe('sPMHtLD6HHBd')
  })

  it('lets a caller-supplied server id override the remembered one', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([], { 'Zotero-Server-ID': 'KNOWN' }),
    )
    await client.getJson('users/0/items')
    await client.getJson('users/0/items', undefined, { serverId: 'EXPLICIT' })
    expect(mock.requests[1]!.headers['zotero-server-id']).toBe('EXPLICIT')
  })
})

describe('identity protection', () => {
  /** Route the original request as an instance-identity mismatch; each test then varies the refresh arm. */
  function routeServerMismatch(): void {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(
        412,
        { 'Content-Type': 'text/plain' },
        'Zotero-Server-ID does not match this server',
      ),
    )
  }

  it('refreshes identity on 412 but never replays the original request', async () => {
    let rootHits = 0
    mock.route('GET', '/api/', (req, res, helpers) => {
      rootHits += 1
      helpers.json({}, { 'Zotero-API-Version': '3', 'Zotero-Server-ID': 'NEWID' })
    })
    routeServerMismatch()
    await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_SERVER_MISMATCH,
      'database changed',
    )
    expect(
      mock.requests.filter((request) => request.pathname === '/api/users/0/items'),
    ).toHaveLength(1)
    expect(rootHits).toBe(1)
    expect(client.serverId).toBe('NEWID')
  })

  it('keeps SERVER_MISMATCH when the identity refresh fails with a non-2xx status', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    routeServerMismatch()
    const error = await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_SERVER_MISMATCH,
      'database changed',
    )
    expect(error.cause).toBeInstanceOf(HarnessError)
    expect((error.cause as HarnessError).code).toBe(ZOTERO_UNEXPECTED)
  })

  it('keeps SERVER_MISMATCH when the identity refresh times out', async () => {
    const fast = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 50,
      maxResponseBytes: 1024,
    })
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    routeServerMismatch()
    const error = await expectZoteroError(fast.getJson('users/0/items'), ZOTERO_SERVER_MISMATCH)
    expect((error.cause as HarnessError).code).toBe(ZOTERO_TIMEOUT)
  })

  it('keeps SERVER_MISMATCH when the identity refresh hits a dead connection', async () => {
    mock.route('GET', '/api/', (req, res) => {
      res.destroy()
    })
    routeServerMismatch()
    const error = await expectZoteroError(client.getJson('users/0/items'), ZOTERO_SERVER_MISMATCH)
    expect(error.cause).toBeInstanceOf(HarnessError)
  })

  it('propagates caller cancellation during the identity refresh', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    routeServerMismatch()
    const controller = new AbortController()
    const pending = client.getJson('users/0/items', undefined, { signal: controller.signal })
    setTimeout(() => controller.abort(), 30).unref()
    await expectZoteroError(pending, TOOL_ABORTED, 'aborted')
  })
})

describe('http status translation', () => {
  it('maps 403 to API_DISABLED', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.raw(403, { 'Content-Type': 'text/plain' }, 'Local API is not enabled'),
    )
    await expectZoteroError(client.getJson(''), ZOTERO_API_DISABLED, 'Settings')
  })

  it('maps a version mismatch (501) to API_VERSION and reports the version', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(
        501,
        { 'Content-Type': 'text/plain', 'Zotero-API-Version': '4' },
        'API version not implemented: 4',
      ),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_API_VERSION, '4')
  })

  it('reports an unknown version when the 501 carries no version header', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(501, { 'Content-Type': 'text/plain' }, 'API version not implemented'),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_API_VERSION, 'unknown')
  })

  it('maps 404 to NOT_FOUND', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_NOT_FOUND)
  })

  it('maps an unexpected 400 to UNEXPECTED', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(400, { 'Content-Type': 'text/plain' }, "Invalid 'sort' value"),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_UNEXPECTED, 'HTTP 400')
  })

  it('refuses to follow redirects, even loopback-issued ones', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(302, { Location: 'http://example.com/steal' }, ''),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_UNEXPECTED, 'redirect')
  })
})

describe('body handling', () => {
  it('parses valid JSON and exposes response headers', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({ version: '10.0' }, { 'Zotero-Schema-Version': '25' }),
    )
    const { json, body, headers } = await client.getJson('')
    expect(json).toEqual({ version: '10.0' })
    expect(body).toBe('{"version":"10.0"}')
    expect(headers.get('zotero-schema-version')).toBe('25')
  })

  it('maps unparseable bodies to UNEXPECTED', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.text('not json', { 'Content-Type': 'application/json' }),
    )
    await expectZoteroError(client.getJson(''), ZOTERO_UNEXPECTED, 'unparseable')
  })

  it('enforces the response byte bound while streaming', async () => {
    const small = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 100,
    })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('x'.repeat(200)))
    await expectZoteroError(small.getJson('users/0/items'), ZOTERO_RESPONSE_TOO_LARGE, '100-byte')
  })

  it('maps a null-body 2xx to an unparseable response', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(204, { 'Content-Type': 'application/json' }, ''),
    )
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_UNEXPECTED, 'unparseable')
  })

  it('translates a mid-body connection reset into a typed failure', async () => {
    mock.route('GET', '/api/users/0/items', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"broken": ')
      res.destroy()
    })
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_UNEXPECTED)
  })
})

describe('failure translation', () => {
  it('maps connection refusal to NOT_RUNNING', async () => {
    const url = mock.baseUrl
    await mock.close()
    const dead = new ZoteroHttpClient({ baseUrl: url, timeoutMs: 5000, maxResponseBytes: 1024 })
    await expectZoteroError(dead.getJson(''), ZOTERO_NOT_RUNNING, 'Settings')
  })

  it('maps the provider deadline to TIMEOUT while the caller signal stays live', async () => {
    const slow = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 50,
      maxResponseBytes: 1024,
    })
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    const signal = new AbortController().signal
    await expectZoteroError(
      slow.getJson('', undefined, { signal }),
      ZOTERO_TIMEOUT,
      'did not respond',
    )
    expect(signal.aborted).toBe(false)
  })

  it('preserves caller cancellation as an abort instead of a timeout', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    const controller = new AbortController()
    const pending = client.getJson('', undefined, { signal: controller.signal })
    setTimeout(() => controller.abort(), 30).unref()
    await expectZoteroError(pending, TOOL_ABORTED, 'aborted')
  })
})
