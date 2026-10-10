import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import {
  OBJECT_NOT_FOUND_MESSAGE,
  REDIRECT_REFUSED_MESSAGE,
  UNPARSEABLE_RESPONSE_MESSAGE,
  ZoteroHttpClient,
  apiVersionMismatchMessage,
  httpStatusMessage,
  notImplementedRequestMessage,
  requestTimeoutMessage,
  responseTooLargeMessage,
  upgradeZoteroRouteMessage,
  NEWER_ZOTERO_ROUTE_MESSAGE,
} from '../../src/http-client.js'
import { ZOTERO_LOCAL_API_VERSION } from '../../src/constants.js'
import {
  API_DISABLED_MESSAGE,
  NOT_RUNNING_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  TOOL_ABORTED_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_IMPLEMENTED,
  ZOTERO_NOT_RUNNING,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
} from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { testHttpClient } from '../helpers/test-clients.js'
import { deferred, progress, type Progress } from '../helpers/sync.js'

let mock: MockZotero
let client: ZoteroHttpClient

beforeEach(async () => {
  mock = await MockZotero.start()
  client = testHttpClient(mock.baseUrl)
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
    const slashed = testHttpClient(`${mock.baseUrl}/`, { maxResponseBytes: 1024 })
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
      SERVER_MISMATCH_MESSAGE,
    )
    expect(
      mock.requests.filter((request) => request.pathname === '/api/users/0/items'),
    ).toHaveLength(1)
    expect(rootHits).toBe(1)
    expect(client.serverId).toBe('NEWID')
  })

  it('fails closed instead of looping when the identity refresh itself 412s', async () => {
    let rootHits = 0
    mock.route('GET', '/api/', (req, res, helpers) => {
      rootHits += 1
      helpers.raw(412, { 'Content-Type': 'text/plain' }, 'no identity to match')
    })
    routeServerMismatch()
    await expectZoteroError(client.getJson('users/0/items'), ZOTERO_SERVER_MISMATCH)
    // One original request plus exactly one guarded refresh: no 412→refresh loop.
    expect(rootHits).toBe(1)
    expect(
      mock.requests.filter((request) => request.pathname === '/api/users/0/items'),
    ).toHaveLength(1)
  })

  it('keeps SERVER_MISMATCH when the identity refresh fails with a non-2xx status', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    routeServerMismatch()
    const error = await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_SERVER_MISMATCH,
      SERVER_MISMATCH_MESSAGE,
    )
    expect(error.cause).toBeInstanceOf(HarnessError)
    expect((error.cause as HarnessError).code).toBe(ZOTERO_UNEXPECTED)
  })

  it('keeps SERVER_MISMATCH when the identity refresh times out', async () => {
    const fast = testHttpClient(mock.baseUrl, { timeoutMs: 50, maxResponseBytes: 1024 })
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
    const refreshing = deferred()
    mock.route('GET', '/api/', (req, res, helpers) => {
      refreshing.resolve()
      helpers.delayJson({}, 5000)
    })
    routeServerMismatch()
    const controller = new AbortController()
    const pending = client.getJson('users/0/items', undefined, { signal: controller.signal })
    // Abort while the refresh is on the wire (the request has reached the
    // server and its response is still outstanding), so this drives the
    // cancellation path instead of racing a delay against it.
    await refreshing.promise
    controller.abort()
    await expectZoteroError(pending, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
  })
})

describe('http status translation', () => {
  it('maps 403 to API_DISABLED', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.raw(403, { 'Content-Type': 'text/plain' }, 'Local API is not enabled'),
    )
    await expectZoteroError(client.getJson(''), ZOTERO_API_DISABLED, API_DISABLED_MESSAGE)
  })

  it('maps a version mismatch (501) to API_VERSION and names both sides', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(
        501,
        { 'Content-Type': 'text/plain', 'Zotero-API-Version': '4' },
        'API version not implemented: 3',
      ),
    )
    const error = await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_API_VERSION,
      apiVersionMismatchMessage('3', '4'),
    )
    // The answering build is newer than this plugin, so the fix is the
    // plugin, not Zotero: the message says which way round it is.
    expect(error.message).toContain('it answers as version 4')
    expect(error.message).toContain(NEWER_ZOTERO_ROUTE_MESSAGE)
  })

  it('tells an older Zotero to upgrade, and names the version it refused', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(
        501,
        { 'Content-Type': 'text/plain', 'Zotero-API-Version': '2' },
        'API version not implemented: 3',
      ),
    )
    const error = await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_API_VERSION,
      apiVersionMismatchMessage('3', '2'),
    )
    expect(error.message).toContain('it answers as version 2')
    expect(error.message).toContain(upgradeZoteroRouteMessage(ZOTERO_LOCAL_API_VERSION))
  })

  it('reads a 501 without a version statement as an unimplemented request', async () => {
    // Zotero refuses an unsupported output format with the same status and its
    // own wording (verified live: `Local API does not support Atom output`).
    // Advising an upgrade for that sent users after the wrong problem.
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(501, { 'Content-Type': 'text/plain' }, 'Local API does not support Atom output'),
    )
    const error = await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_NOT_IMPLEMENTED,
      notImplementedRequestMessage('users/0/items'),
    )
    expect(error.message).not.toContain('Upgrade')
  })

  it('keeps the 501 as the finding when its statement cannot be read', async () => {
    // A body past the byte bound: the statement is unavailable, but the
    // status Zotero chose is still the finding: it is not re-reported as an
    // oversized response.
    const bounded = testHttpClient(mock.baseUrl, { maxResponseBytes: 32 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(501, { 'Content-Type': 'text/plain' }, 'x'.repeat(200)),
    )
    await expectZoteroError(
      bounded.getJson('users/0/items'),
      ZOTERO_NOT_IMPLEMENTED,
      notImplementedRequestMessage('users/0/items'),
    )
  })

  it('lets the deadline win over an unfinished 501 statement', async () => {
    const slow = testHttpClient(mock.baseUrl, { timeoutMs: 40, maxResponseBytes: 1024 })
    mock.route('GET', '/api/users/0/items', (req, res) => {
      res.writeHead(501, { 'Content-Type': 'text/plain' })
      // Headers and a partial statement arrive; the rest never does, so the
      // read ends on the provider deadline and that is what is reported.
      res.write('API version not implemented: 3')
    })
    await expectZoteroError(slow.getJson('users/0/items'), ZOTERO_TIMEOUT)
  })

  it('maps 404 to NOT_FOUND', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_NOT_FOUND,
      OBJECT_NOT_FOUND_MESSAGE,
    )
  })

  it('maps a 400 Bad Request to INVALID_ARGUMENT', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(400, { 'Content-Type': 'text/plain' }, "Invalid 'sort' value"),
    )
    await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_INVALID_ARGUMENT,
      httpStatusMessage(400),
    )
  })

  it('refuses to follow redirects, even loopback-issued ones', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(302, { Location: 'http://example.com/steal' }, ''),
    )
    await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_UNEXPECTED,
      REDIRECT_REFUSED_MESSAGE,
    )
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
    await expectZoteroError(client.getJson(''), ZOTERO_UNEXPECTED, UNPARSEABLE_RESPONSE_MESSAGE)
  })

  it('enforces the response byte bound while streaming', async () => {
    const small = testHttpClient(mock.baseUrl, { maxResponseBytes: 100 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('x'.repeat(200)))
    await expectZoteroError(
      small.getJson('users/0/items'),
      ZOTERO_RESPONSE_TOO_LARGE,
      responseTooLargeMessage(100),
    )
  })

  it('maps a null-body 2xx to an unparseable response', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.raw(204, { 'Content-Type': 'application/json' }, ''),
    )
    await expectZoteroError(
      client.getJson('users/0/items'),
      ZOTERO_UNEXPECTED,
      UNPARSEABLE_RESPONSE_MESSAGE,
    )
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

describe('in-flight bound', () => {
  /** Count requests the mock is serving at once, up to and including the response write. */
  function routeCounting(peak: { value: number }, ms: number): void {
    let active = 0
    mock.route('GET', /^\/api\/users\/0\/items\/[A-Z0-9]+$/, (req, res, helpers) => {
      active += 1
      peak.value = Math.max(peak.value, active)
      res.on('finish', () => {
        active -= 1
      })
      helpers.delayJson({ ok: true }, ms)
    })
  }

  /** A route the test answers itself: every response waits for its release. */
  interface HeldRoute {
    /** Notifications as requests arrive; the test waits on this, never on a delay. */
    readonly arrived: Progress
    /** How many responses the mock is still holding. */
    pending(): number
    /** Answer the oldest held request with a 200 JSON body. */
    release(): void
  }

  /**
   * Hold every matching request's response until the test releases it. The
   * overlap counter above needs a response delay to see several requests at
   * once (a delay long enough that an unbounded client's whole burst lands
   * inside it), while a test that only needs one request on the wire waits for
   * the arrival itself, so nothing in it depends on such a delay.
   */
  function routeHeld(): HeldRoute {
    const held: Array<() => void> = []
    const arrived = progress()
    mock.route('GET', /^\/api\/users\/0\/items\/[A-Z0-9]+$/, (req, res, helpers) => {
      held.push(() => helpers.json({ ok: true }))
      arrived.notify()
    })
    return {
      arrived,
      pending: () => held.length,
      release: () => held.shift()!(),
    }
  }

  it('keeps no more than the configured requests in flight', async () => {
    const gate = testHttpClient(mock.baseUrl, { maxResponseBytes: 1024, maxInFlight: 2 })
    const peak = { value: 0 }
    routeCounting(peak, 20)
    await Promise.all(
      ['AAAA0001', 'AAAA0002', 'AAAA0003', 'AAAA0004', 'AAAA0005'].map((key) =>
        gate.getJson(`users/0/items/${key}`),
      ),
    )
    // Five requests, two slots: the extra three waited instead of all five
    // reaching the local server at once.
    expect(peak.value).toBe(2)
    expect(mock.requests).toHaveLength(5)
  })

  it('cancels a request that is still queued, without sending it', async () => {
    const gate = testHttpClient(mock.baseUrl, { maxResponseBytes: 1024, maxInFlight: 1 })
    const route = routeHeld()
    const controller = new AbortController()
    const holding = gate.getJson('users/0/items/AAAA0001')
    const queued = gate.getJson('users/0/items/AAAA0002', undefined, {
      signal: controller.signal,
    })
    // The first request is on the wire (and holds the only slot) before the
    // queued one is aborted: the abort lands on a waiter the client is already
    // holding, not on a race between a delay and the slot being taken.
    await route.arrived.when(() => route.pending() >= 1)
    controller.abort()
    await expectZoteroError(queued, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
    route.release()
    await holding
    // The aborted request never reached the server, and its slot was not lost:
    // the first request still completed normally.
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/AAAA0001'])
  })

  it('starts the request deadline after the slot, so queueing is not a timeout', async () => {
    const gate = testHttpClient(mock.baseUrl, {
      timeoutMs: 60,
      maxResponseBytes: 1024,
      maxInFlight: 1,
    })
    // The first request holds the only slot past its own deadline; the one
    // queued behind it is answered in 5 ms once it starts.
    mock.route('GET', '/api/users/0/items/AAAA0001', (req, res, helpers) =>
      helpers.delayJson({ ok: true }, 150),
    )
    mock.route('GET', '/api/users/0/items/AAAA0002', (req, res, helpers) =>
      helpers.delayJson({ ok: true }, 5),
    )
    const holding = gate.getJson('users/0/items/AAAA0001')
    const queued = gate.getJson('users/0/items/AAAA0002')
    await expect(holding).rejects.toBeInstanceOf(HarnessError)
    // The queued request has now waited past the 60 ms deadline and still
    // succeeds: its clock starts when Zotero's request does.
    await expect(queued).resolves.toBeDefined()
  })
})

describe('failure translation', () => {
  it('maps connection refusal to NOT_RUNNING', async () => {
    const url = mock.baseUrl
    await mock.close()
    const dead = testHttpClient(url, { maxResponseBytes: 1024 })
    await expectZoteroError(dead.getJson(''), ZOTERO_NOT_RUNNING, NOT_RUNNING_MESSAGE)
  })

  it('maps the provider deadline to TIMEOUT while the caller signal stays live', async () => {
    const slow = testHttpClient(mock.baseUrl, { timeoutMs: 50, maxResponseBytes: 1024 })
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    const signal = new AbortController().signal
    await expectZoteroError(
      slow.getJson('', undefined, { signal }),
      ZOTERO_TIMEOUT,
      requestTimeoutMessage(50),
    )
    expect(signal.aborted).toBe(false)
  })

  it('preserves caller cancellation as an abort instead of a timeout', async () => {
    const outstanding = deferred()
    mock.route('GET', '/api/', (req, res, helpers) => {
      outstanding.resolve()
      helpers.delayJson({}, 5000)
    })
    const controller = new AbortController()
    const pending = client.getJson('', undefined, { signal: controller.signal })
    // Abort with the response still outstanding (long before the 5 s provider
    // deadline), so the failure below is the caller's cancellation, never a
    // timeout that arrived first.
    await outstanding.promise
    controller.abort()
    await expectZoteroError(pending, TOOL_ABORTED, TOOL_ABORTED_MESSAGE)
  })
})
