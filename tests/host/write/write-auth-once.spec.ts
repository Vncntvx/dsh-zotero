import {
  WRITE_SERVER_ID as SERVER_ID,
  SECOND_SERVER_ID as OTHER_SERVER_ID,
} from '../../helpers/server/keys.js'
import { describe, expect, it, vi } from 'vitest'

import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { WriteAuthorizer } from '../../../src/write-auth.js'

import { ZoteroWriteHttpClient } from '../../../src/write-http.js'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { WRITE_AUTH_DENIED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED } from '../../../src/errors.js'

import { deferred } from '../../helpers/sync.js'

import {
  ISSUED_KEY,
  AUTHORIZE_PATH,
  grantBody,
  authorizeOnce,
  mock,
  credentials,
  authorizeCalls,
  authorizer,
  recordAuthorization,
} from './support/write-auth.js'

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
      recordAuthorization()
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
        recordAuthorization()
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
      recordAuthorization()
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
      recordAuthorization()
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
