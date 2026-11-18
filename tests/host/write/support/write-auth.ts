import { WRITE_SERVER_ID as SERVER_ID } from '../../../helpers/server/keys.js'
import { afterEach, beforeEach } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { WriteAuthorizer } from '../../../../src/write-auth.js'
import { MemoryCredentials, writeGrantRecord } from '../../../helpers/credential-seam.js'
import { ZoteroWriteHttpClient } from '../../../../src/write-http.js'

import { MockZotero } from '../../../helpers/mock-zotero.js'
import { testWriteClient } from '../../../helpers/test-clients.js'

export const ISSUED_KEY = 'K'.repeat(32)
export const AUTHORIZE_PATH = '/api/local/authorize'

export function grantBody(key: string, remember: boolean): string {
  return JSON.stringify({ key, remember })
}

export function storedGrant(key: string, serverId = SERVER_ID): CredentialRecord {
  return writeGrantRecord(key, serverId)
}

/** Register the authorize dialog answer the current test needs. */
export function authorizeOnce(remember: boolean): void {
  mock.route('POST', AUTHORIZE_PATH, (_req, res, helpers) => {
    recordAuthorization()
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, grantBody(ISSUED_KEY, remember))
  })
}

export let mock: MockZotero
export let client: ZoteroWriteHttpClient
export let credentials: MemoryCredentials
export let authorizeCalls: number

export function recordAuthorization(): void {
  authorizeCalls += 1
}

export function authorizer(persistKey = true): WriteAuthorizer {
  return new WriteAuthorizer({
    client,
    credentials: () => credentials,
    persistKey: () => persistKey,
  })
}

export function authorizerWithoutSeam(): WriteAuthorizer {
  return new WriteAuthorizer({ client, persistKey: () => true })
}

beforeEach(async () => {
  mock = await MockZotero.start()
  client = testWriteClient(mock.baseUrl)
  const ctx = new Context()
  const fiber: Fiber = ctx.plugin(MemoryCredentials)
  await fiber
  credentials = ctx.get('credentials') as MemoryCredentials
  authorizeCalls = 0
})

afterEach(async () => {
  await mock.close()
})
