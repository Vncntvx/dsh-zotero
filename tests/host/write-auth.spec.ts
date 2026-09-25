import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { WRITE_APP_NAME, WRITE_KEY_RECORD, WriteAuthorizer } from '../../src/write-auth.js'
import { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { WRITE_AUTH_DENIED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED } from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { deferred } from '../helpers/sync.js'

const SERVER_ID = 'srv-auth-spec-0001'
const OTHER_SERVER_ID = 'srv-other-00002'
const ISSUED_KEY = 'K'.repeat(32)
const AUTHORIZE_PATH = '/api/local/authorize'

/**
 * The smallest real credentials seam: an in-memory record map, so the spec
 * observes exactly what the authorizer persists and deletes.
 */
class MemoryCredentials extends CredentialProvider {
  readonly records = new Map<string, CredentialRecord>()
  readonly deletions: string[] = []

  constructor(ctx: Context) {
    super(ctx)
  }

  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return undefined
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: false, writable: true }
  }

  async set(_ref: CredentialRef, _value: string): Promise<void> {}

  async unset(_ref: CredentialRef): Promise<void> {}

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.records.get(String(key))
  }

  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return { configured: false, writable: true }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return []
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(String(key)))
    if (next === undefined) return this.records.get(String(key))
    this.records.set(String(key), next)
    return next
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    this.deletions.push(String(key))
    this.records.delete(String(key))
  }
}

function grantBody(key: string, remember: boolean): string {
  return JSON.stringify({ key, remember })
}

function storedGrant(key: string, serverId = SERVER_ID): CredentialRecord {
  return {
    kind: 'grant',
    payload: { key, serverId, appName: WRITE_APP_NAME, authorizedAt: '2026-09-13T00:00:00.000Z' },
  }
}

/** Register the authorize dialog answer the current test needs. */
function authorizeOnce(remember: boolean): void {
  mock.route('POST', AUTHORIZE_PATH, (_req, res, helpers) => {
    authorizeCalls += 1
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, grantBody(ISSUED_KEY, remember))
  })
}

let mock: MockZotero
let client: ZoteroWriteHttpClient
let credentials: MemoryCredentials
let authorizeCalls: number

function authorizer(persistKey = true): WriteAuthorizer {
  return new WriteAuthorizer({
    client,
    credentials,
    persistKey: () => persistKey,
  })
}

function authorizerWithoutSeam(): WriteAuthorizer {
  return new WriteAuthorizer({ client, persistKey: () => true })
}

beforeEach(async () => {
  mock = await MockZotero.start()
  client = new ZoteroWriteHttpClient({
    baseUrl: mock.baseUrl,
    timeoutMs: 5000,
    maxResponseBytes: 1024 * 1024,
  })
  const ctx = new Context()
  const fiber: Fiber = ctx.plugin(MemoryCredentials)
  await fiber
  credentials = ctx.get('credentials') as MemoryCredentials
  authorizeCalls = 0
})

afterEach(async () => {
  await mock.close()
})

describe('persisted grants', () => {
  beforeEach(() => authorizeOnce(true))

  it('persists an Always-Allow grant and reuses it without another dialog', async () => {
    const writer = authorizer()
    const first = await writer.keyFor(SERVER_ID)
    expect(first).toEqual({ key: ISSUED_KEY, oneTime: false })
    expect(authorizeCalls).toBe(1)
    const stored = credentials.records.get(String(WRITE_KEY_RECORD))
    expect(stored).toMatchObject({
      kind: 'grant',
      payload: { key: ISSUED_KEY, serverId: SERVER_ID },
    })
    const second = await writer.keyFor(SERVER_ID)
    expect(second.key).toBe(ISSUED_KEY)
    expect(authorizeCalls).toBe(1)
    expect(mock.requests).toHaveLength(1)
  })

  it('reuses a grant the user already stored without consulting Zotero', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('stored-key-01'))
    const writer = authorizer()
    const key = await writer.keyFor(SERVER_ID)
    expect(key).toEqual({ key: 'stored-key-01', oneTime: false })
    expect(authorizeCalls).toBe(0)
    expect(mock.requests).toHaveLength(0)
  })

  it('does not persist when the setting is off, and still reuses the grant in-process', async () => {
    const writer = authorizer(false)
    await writer.keyFor(SERVER_ID)
    expect(credentials.records.size).toBe(0)
    const second = await writer.keyFor(SERVER_ID)
    expect(second.key).toBe(ISSUED_KEY)
    expect(authorizeCalls).toBe(1)
  })

  it('does not rewrite an identical persisted grant while persisting a retry', async () => {
    const fakeClient = {
      authorize: async () => {
        credentials.records.set(String(WRITE_KEY_RECORD), storedGrant(ISSUED_KEY))
        return { key: ISSUED_KEY, remember: true }
      },
    } as unknown as ZoteroWriteHttpClient
    const writer = new WriteAuthorizer({ client: fakeClient, credentials, persistKey: () => true })
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({ key: ISSUED_KEY })
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toMatchObject({
      kind: 'grant',
      payload: { key: ISSUED_KEY, serverId: SERVER_ID },
    })
  })

  it('preserves a newer persisted grant instead of overwriting it', async () => {
    const newer = {
      kind: 'grant' as const,
      payload: {
        key: 'newer-key-01',
        serverId: SERVER_ID,
        appName: WRITE_APP_NAME,
        authorizedAt: '2999-01-01T00:00:00.000Z',
      },
    }
    const fakeClient = {
      authorize: async () => {
        credentials.records.set(String(WRITE_KEY_RECORD), newer)
        return { key: ISSUED_KEY, remember: true }
      },
    } as unknown as ZoteroWriteHttpClient
    const writer = new WriteAuthorizer({ client: fakeClient, credentials, persistKey: () => true })
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({ key: ISSUED_KEY })
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toEqual(newer)
  })

  it('accepts a valid persisted grant without optional audit fields', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), {
      kind: 'grant',
      payload: { key: 'minimal-key-01', serverId: SERVER_ID },
    })
    const writer = authorizer()
    expect((await writer.keyFor(SERVER_ID)).key).toBe('minimal-key-01')
    expect(authorizeCalls).toBe(0)
  })

  it('keeps working when no credentials service is composed', async () => {
    const writer = authorizerWithoutSeam()
    const first = await writer.keyFor(SERVER_ID)
    expect(first.oneTime).toBe(false)
    const second = await writer.keyFor(SERVER_ID)
    expect(second.key).toBe(first.key)
    expect(authorizeCalls).toBe(1)
  })

  it('persists a remembered grant after the credentials seam appears', async () => {
    let seam: MemoryCredentials | undefined
    const writer = new WriteAuthorizer({
      client,
      credentials: () => seam,
      persistKey: () => true,
    })
    const first = await writer.keyFor(SERVER_ID)
    expect(first).toEqual({ key: ISSUED_KEY, oneTime: false })
    expect(credentials.records.size).toBe(0)

    seam = credentials
    const second = await writer.keyFor(SERVER_ID)
    expect(second).toEqual({ key: ISSUED_KEY, oneTime: false })
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toMatchObject({
      kind: 'grant',
      payload: { key: ISSUED_KEY, serverId: SERVER_ID },
    })
    expect(authorizeCalls).toBe(1)
  })

  it('honors a persist setting that turns off before the deferred write starts', async () => {
    let reads = 0
    const writer = new WriteAuthorizer({
      client,
      credentials,
      persistKey: () => {
        reads += 1
        return reads < 3
      },
    })
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({
      key: ISSUED_KEY,
      oneTime: false,
    })
    expect(credentials.records.size).toBe(0)
  })

  it('coalesces concurrent persistence of one remembered grant', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const originalModify = credentials.modifyRecord.bind(credentials)
    const modify = vi.spyOn(credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
      entered.resolve()
      await release.promise
      return await originalModify(key, mutate)
    })
    const writer = authorizer()
    const first = writer.keyFor(SERVER_ID)
    await entered.promise
    const second = writer.keyFor(SERVER_ID)
    await new Promise<void>((resolve) => setImmediate(resolve))
    release.resolve()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(modify).toHaveBeenCalledTimes(1)
  })

  it('tombstones a revoked persisted grant so the next call re-authorizes', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('revoked-key-01'))
    const writer = authorizer()
    expect((await writer.keyFor(SERVER_ID)).key).toBe('revoked-key-01')
    await writer.invalidate(SERVER_ID, 'revoked-key-01')
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toMatchObject({
      kind: 'grant',
      payload: { revoked: true, serverId: SERVER_ID },
    })
    expect((await writer.keyFor(SERVER_ID)).key).toBe(ISSUED_KEY)
    expect(authorizeCalls).toBe(1)
  })

  it('does not tombstone a newer grant when invalidating an older key', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('newer-key-01'))
    const writer = authorizer()
    await writer.invalidate(SERVER_ID, 'older-key-01')
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toMatchObject({
      kind: 'grant',
      payload: { key: 'newer-key-01', serverId: SERVER_ID },
    })
    expect(credentials.deletions).toEqual([])
  })

  it('serializes persistence per grant rather than sharing one global task', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const originalModify = credentials.modifyRecord.bind(credentials)
    let modifyCalls = 0
    vi.spyOn(credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
      modifyCalls += 1
      if (modifyCalls === 1) {
        entered.resolve()
        await release.promise
      }
      return await originalModify(key, mutate)
    })
    const fakeClient = {
      authorize: async (_app: string, options: { serverId: string }) => ({
        key: options.serverId === SERVER_ID ? 'A'.repeat(32) : 'B'.repeat(32),
        remember: true,
      }),
    } as unknown as ZoteroWriteHttpClient
    const writer = new WriteAuthorizer({ client: fakeClient, credentials, persistKey: () => true })
    const first = writer.keyFor(SERVER_ID)
    await entered.promise
    const second = writer.keyFor(OTHER_SERVER_ID)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(modifyCalls).toBe(2)
    release.resolve()
    await expect(first).resolves.toMatchObject({ key: 'A'.repeat(32) })
    await expect(second).resolves.toMatchObject({ key: 'B'.repeat(32) })
  })

  it('does not return a pending grant after its caller cancels during persistence', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const originalModify = credentials.modifyRecord.bind(credentials)
    vi.spyOn(credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
      entered.resolve()
      await release.promise
      return await originalModify(key, mutate)
    })
    authorizeOnce(true)
    const controller = new AbortController()
    const pending = authorizer().keyFor(SERVER_ID, controller.signal)
    await entered.promise
    controller.abort()
    release.resolve()
    await expect(pending).rejects.toMatchObject({ code: TOOL_ABORTED })
  })

  it('fails closed on a persistence error but retries the pending grant later', async () => {
    const originalModify = credentials.modifyRecord.bind(credentials)
    let attempts = 0
    vi.spyOn(credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
      attempts += 1
      if (attempts === 1) throw new Error('credentials offline')
      return await originalModify(key, mutate)
    })
    const writer = authorizer()
    await expect(writer.keyFor(SERVER_ID)).rejects.toThrow('credentials offline')
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({
      key: ISSUED_KEY,
      oneTime: false,
    })
    expect(authorizeCalls).toBe(1)
  })

  it('tombstones a stored grant for another instance before re-authorizing', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('stale-key-999', OTHER_SERVER_ID))
    const writer = authorizer()
    const key = await writer.keyFor(SERVER_ID)
    expect(key.key).toBe(ISSUED_KEY)
    expect(credentials.deletions).toEqual([])
    const rebound = credentials.records.get(String(WRITE_KEY_RECORD))
    expect(rebound).toMatchObject({
      kind: 'grant',
      payload: { key: ISSUED_KEY, serverId: SERVER_ID },
    })
  })
})

describe('one-time keys', () => {
  it('reuses the one-time key inside the process but never persists it', async () => {
    authorizeOnce(false)
    const writer = authorizer()
    const first = await writer.keyFor(SERVER_ID)
    expect(first.oneTime).toBe(true)
    const second = await writer.keyFor(SERVER_ID)
    expect(second.key).toBe(ISSUED_KEY)
    expect(credentials.records.size).toBe(0)
  })

  it('forgets a one-time key when the domain settles the write', async () => {
    authorizeOnce(false)
    const writer = authorizer()
    const first = await writer.keyFor(SERVER_ID)
    writer.forget(first.key)
    await writer.keyFor(SERVER_ID)
    expect(authorizeCalls).toBe(2)
  })

  it('authorizes once for concurrent callers', async () => {
    const release = deferred<void>()
    mock.route('POST', AUTHORIZE_PATH, async (_req, res, helpers) => {
      authorizeCalls += 1
      await release.promise
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, grantBody(ISSUED_KEY, false))
    })
    const writer = authorizer()
    const first = writer.keyFor(SERVER_ID)
    const second = writer.keyFor(SERVER_ID)
    release.resolve()
    const [a, b] = await Promise.all([first, second])
    expect(authorizeCalls).toBe(1)
    expect(a.key).toBe(b.key)
  })

  it('starts a fresh operation when the previous shared authorization was aborted', async () => {
    const firstStarted = deferred<void>()
    const secondStarted = deferred<void>()
    const firstGrant = deferred<{ key: string; remember: boolean }>()
    const secondGrant = deferred<{ key: string; remember: boolean }>()
    let calls = 0
    const fakeClient = {
      authorize: async () => {
        calls += 1
        if (calls === 1) {
          firstStarted.resolve()
          return await firstGrant.promise
        }
        secondStarted.resolve()
        return await secondGrant.promise
      },
    } as unknown as ZoteroWriteHttpClient
    const writer = new WriteAuthorizer({ client: fakeClient, persistKey: () => false })
    const controller = new AbortController()
    const first = writer.keyFor(SERVER_ID, controller.signal)
    await firstStarted.promise
    controller.abort()
    const second = writer.keyFor(SERVER_ID)
    await secondStarted.promise
    firstGrant.resolve({ key: ISSUED_KEY, remember: false })
    secondGrant.resolve({ key: ISSUED_KEY, remember: false })
    await expect(first).rejects.toMatchObject({ code: TOOL_ABORTED })
    await expect(second).resolves.toMatchObject({ key: ISSUED_KEY, oneTime: true })
    expect(calls).toBe(2)
  })

  it('rechecks cancellation after shared authorization work has been started', async () => {
    const controller = new AbortController()
    const fakeClient = {
      authorize: async () => {
        controller.abort()
        return { key: ISSUED_KEY, remember: false }
      },
    } as unknown as ZoteroWriteHttpClient
    const writer = new WriteAuthorizer({ client: fakeClient, persistKey: () => false })
    await expect(writer.keyFor(SERVER_ID, controller.signal)).rejects.toMatchObject({
      code: TOOL_ABORTED,
    })
  })

  it('refuses an already-aborted caller without opening the authorization dialog', async () => {
    authorizeOnce(true)
    const controller = new AbortController()
    controller.abort()
    await expect(authorizer().keyFor(SERVER_ID, controller.signal)).rejects.toMatchObject({
      code: TOOL_ABORTED,
    })
    expect(authorizeCalls).toBe(0)
  })

  it('handles cancellation between the signal check and listener attachment', async () => {
    authorizeOnce(false)
    const controller = new AbortController()
    const addEventListener = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        addEventListener(type, listener, options)
        controller.abort()
      },
    )
    await expect(authorizer().keyFor(SERVER_ID, controller.signal)).rejects.toMatchObject({
      code: TOOL_ABORTED,
    })
    expect(authorizeCalls).toBe(0)
  })

  it('honors cancellation while the stored-grant lookup is in flight', async () => {
    authorizeOnce(true)
    const entered = deferred<void>()
    const release = deferred<CredentialRecord | undefined>()
    vi.spyOn(credentials, 'readRecord').mockImplementation(async () => {
      entered.resolve()
      return await release.promise
    })
    const controller = new AbortController()
    const pending = authorizer().keyFor(SERVER_ID, controller.signal)
    await entered.promise
    controller.abort()
    release.resolve(undefined)
    await expect(pending).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(authorizeCalls).toBe(0)
  })

  it('aborts the underlying authorization when its only waiter cancels', async () => {
    const release = deferred<void>()
    const started = deferred<void>()
    const finished = deferred<void>()
    mock.route('POST', AUTHORIZE_PATH, async (_req, res, helpers) => {
      try {
        authorizeCalls += 1
        started.resolve()
        await release.promise
        helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, grantBody(ISSUED_KEY, false))
      } finally {
        finished.resolve()
      }
    })
    const controller = new AbortController()
    const writer = authorizer()
    const pending = writer.keyFor(SERVER_ID, controller.signal)
    await started.promise
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: TOOL_ABORTED })
    release.resolve()
    await finished.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(authorizeCalls).toBe(1)
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({
      key: ISSUED_KEY,
      oneTime: true,
    })
    expect(authorizeCalls).toBe(2)
  })

  it('does not let one cancelled caller abort another live authorization waiter', async () => {
    const release = deferred<void>()
    const started = deferred<void>()
    mock.route('POST', AUTHORIZE_PATH, async (_req, res, helpers) => {
      authorizeCalls += 1
      started.resolve()
      await release.promise
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, grantBody(ISSUED_KEY, false))
    })
    const writer = authorizer()
    const firstController = new AbortController()
    const first = writer.keyFor(SERVER_ID, firstController.signal)
    await started.promise
    const second = writer.keyFor(SERVER_ID)
    await new Promise<void>((resolve) => setImmediate(resolve))
    firstController.abort()
    await expect(first).rejects.toMatchObject({ code: TOOL_ABORTED })
    release.resolve()
    await expect(second).resolves.toMatchObject({ key: ISSUED_KEY, oneTime: true })
    expect(authorizeCalls).toBe(1)
  })
})

describe('hasGrant (status fact)', () => {
  it('reports the in-memory grant for the connected instance', async () => {
    authorizeOnce(true)
    const writer = authorizer()
    await writer.keyFor(SERVER_ID)
    expect(await writer.hasGrant(SERVER_ID)).toBe(true)
    expect(await writer.hasGrant(OTHER_SERVER_ID)).toBe(false)
  })

  it('reports a persisted grant bound to the asking instance only', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('stored-key-02'))
    const writer = authorizer()
    expect(await writer.hasGrant(SERVER_ID)).toBe(true)
    expect(await writer.hasGrant(OTHER_SERVER_ID)).toBe(false)
  })

  it('reports no grant for a stored record without a usable key', async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), {
      kind: 'grant',
      payload: { serverId: SERVER_ID },
    })
    const writer = authorizer()
    expect(await writer.hasGrant(SERVER_ID)).toBe(false)
    authorizeOnce(true)
    await expect(writer.keyFor(SERVER_ID)).resolves.toMatchObject({ key: ISSUED_KEY })
    expect(authorizeCalls).toBe(1)
  })

  it('reports no grant without a credentials seam or an in-process key', async () => {
    const authorizer = authorizerWithoutSeam()
    expect(await authorizer.hasGrant(SERVER_ID)).toBe(false)
  })
})

describe('authorization refusals', () => {
  it('surfaces a declined dialog as the typed unauthorized error', async () => {
    mock.route('POST', AUTHORIZE_PATH, (_req, res, helpers) =>
      helpers.raw(403, { 'Content-Type': 'application/json' }, '{"denied": true}'),
    )
    let thrown: unknown
    try {
      await authorizer().keyFor(SERVER_ID)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(WRITE_AUTH_DENIED_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_UNAUTHORIZED)
  })

  it('does not offer a memory key that belongs to another instance', async () => {
    mock.route('POST', AUTHORIZE_PATH, (req, res, helpers) => {
      authorizeCalls += 1
      const serverId = String(req.headers['zotero-server-id'])
      helpers.raw(200, { 'Zotero-Server-ID': serverId }, grantBody(ISSUED_KEY, true))
    })
    const writer = authorizer()
    await writer.keyFor(SERVER_ID)
    writer.forget(ISSUED_KEY)
    await writer.keyFor(OTHER_SERVER_ID)
    expect(authorizeCalls).toBe(2)
  })
})
