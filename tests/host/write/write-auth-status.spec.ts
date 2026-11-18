import {
  WRITE_SERVER_ID as SERVER_ID,
  SECOND_SERVER_ID as OTHER_SERVER_ID,
} from '../../helpers/server/keys.js'
import { describe, expect, it, vi } from 'vitest'

import { WRITE_KEY_RECORD } from '../../../src/write-auth.js'

import { deferred } from '../../helpers/sync.js'

import {
  ISSUED_KEY,
  storedGrant,
  authorizeOnce,
  client,
  credentials,
  authorizeCalls,
  authorizer,
  authorizerWithoutSeam,
} from './support/write-auth.js'

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

describe('user revocation', () => {
  it("atomically tombstones this plugin's grant and forgets the process copy", async () => {
    credentials.records.set(String(WRITE_KEY_RECORD), storedGrant('stored-key-02'))
    credentials.records.set('sentinel-record', { kind: 'api-key', key: 'other' })
    const writer = authorizer()
    expect(await writer.hasGrant(SERVER_ID)).toBe(true)

    expect(await writer.revoke()).toEqual({ removed: true })
    expect(credentials.deletions).toEqual([])
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toMatchObject({
      kind: 'grant',
      payload: { revoked: true },
    })
    expect(JSON.stringify(credentials.records.get(String(WRITE_KEY_RECORD)))).not.toContain(
      'stored-key-02',
    )
    expect(await writer.revoke()).toEqual({ removed: false })
    expect(credentials.records.has('sentinel-record')).toBe(true)
    expect(await writer.hasGrant(SERVER_ID)).toBe(false)
  })

  it('reports nothing removed when no record is stored', async () => {
    const writer = authorizer()
    expect(await writer.revoke()).toEqual({ removed: false })
    expect(credentials.records.size).toBe(0)
  })

  it('works without the credentials seam', async () => {
    expect(await authorizerWithoutSeam().revoke()).toEqual({ removed: false })
  })

  it('invalidates a dialog that was open when the user revoked', async () => {
    const gate = deferred<{ key: string; remember: boolean }>()
    const entered = deferred<void>()
    vi.spyOn(client, 'authorize').mockImplementation(async () => {
      entered.resolve()
      return await gate.promise
    })
    const writer = authorizer()
    const pending = writer.keyFor(SERVER_ID)
    await entered.promise

    await writer.revoke()
    gate.resolve({ key: ISSUED_KEY, remember: true })
    await expect(pending).resolves.toEqual({ key: ISSUED_KEY, oneTime: true })
    expect(credentials.records.size).toBe(0)
    expect(await writer.hasGrant(SERVER_ID)).toBe(false)
  })
})
