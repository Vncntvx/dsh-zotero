/** Unusable credentials are neither accepted as grants nor destructively revoked. */
import { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { afterEach, expect, it } from 'vitest'
import {
  persistedGrantBoundTo,
  revokePersistedGrant,
  WRITE_KEY_RECORD,
} from '../../../src/write-auth.js'
import { MemoryCredentials } from '../../helpers/credential-seam.js'

let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

const malformed: [string, CredentialRecord][] = [
  ['API key from another consumer', { kind: 'api-key', key: 'unrelated' }],
  ['non-object grant', { kind: 'grant', payload: null }],
  ['empty secret', { kind: 'grant', payload: { key: '', serverId: 'server' } }],
  ['missing server identity', { kind: 'grant', payload: { key: 'secret' } }],
]
it.each(malformed)(
  'refuses a %s without deleting another consumer record',
  async (_label, record) => {
    ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    const credentials = ctx.get('credentials') as MemoryCredentials
    credentials.records.set(String(WRITE_KEY_RECORD), record)
    expect(await persistedGrantBoundTo(credentials, 'server')).toBe(false)
    expect(await revokePersistedGrant(credentials)).toEqual({ removed: false })
    expect(credentials.records.get(String(WRITE_KEY_RECORD))).toEqual(record)
  },
)

it('reports no grant when the credentials service is absent', async () => {
  expect(await persistedGrantBoundTo(undefined, 'server')).toBe(false)
  expect(await revokePersistedGrant(undefined)).toEqual({ removed: false })
})
