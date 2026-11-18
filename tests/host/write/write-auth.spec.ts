import {
  WRITE_SERVER_ID as SERVER_ID,
  SECOND_SERVER_ID as OTHER_SERVER_ID,
} from '../../helpers/server/keys.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WRITE_APP_NAME, WRITE_KEY_RECORD, WriteAuthorizer } from '../../../src/write-auth.js'
import { MemoryCredentials } from '../../helpers/credential-seam.js'
import { ZoteroWriteHttpClient } from '../../../src/write-http.js'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'

import { deferred } from '../../helpers/sync.js'

import {
  ISSUED_KEY,
  storedGrant,
  authorizeOnce,
  mock,
  client,
  credentials,
  authorizeCalls,
  authorizer,
  authorizerWithoutSeam,
} from './support/write-auth.js'

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
    const writer = new WriteAuthorizer({
      client: fakeClient,
      credentials: () => credentials,
      persistKey: () => true,
    })
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
    const writer = new WriteAuthorizer({
      client: fakeClient,
      credentials: () => credentials,
      persistKey: () => true,
    })
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
      credentials: () => credentials,
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
    const writer = new WriteAuthorizer({
      client: fakeClient,
      credentials: () => credentials,
      persistKey: () => true,
    })
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
