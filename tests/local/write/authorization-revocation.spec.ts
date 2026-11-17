/** Credential-store failures preserve the original unauthorized write and never dispatch again. */
import { Context } from '@deepseek-ai/cordis'
import { asRecord } from '../../../src/json.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials, writeGrantRecord } from '../../helpers/credential-seam.js'
import { WriteAuthorizer, WRITE_KEY_RECORD } from '../../../src/write-auth.js'
import { withWriteKey } from '../../../src/local/write-domain.js'
import { ZoteroError, ZOTERO_WRITE_UNAUTHORIZED } from '../../../src/errors.js'
import { SERVER_ID, startWriteDomainMock, writeDeps } from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero
let ctx: Context
beforeEach(async () => {
  mock = await startWriteDomainMock()
  ctx = new Context()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await ctx.fiber.dispose()
  await mock.close()
})

describe('refused write grant revocation', () => {
  it.each([1, 2])(
    'preserves unauthorized semantics if revocation fails after write %i',
    async (failAt) => {
      const credentials = new MemoryCredentials(ctx)
      credentials.records.set(String(WRITE_KEY_RECORD), writeGrantRecord('K'.repeat(32), SERVER_ID))
      const storageError = new Error('Credential backend unavailable')
      const modify = credentials.modifyRecord.bind(credentials)
      let revocations = 0
      vi.spyOn(credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
        // Persisting a renewed reusable grant succeeds; only its tombstone write fails.
        const current = credentials.records.get(String(key))
        const next = await mutate(current)
        if (
          next?.kind === 'grant' &&
          asRecord(next.payload)?.revoked === true &&
          ++revocations === failAt
        )
          throw storageError
        return await modify(key, async () => next)
      })
      mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
        h.json({ key: 'N'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
      )
      mock.route('PATCH', '/api/users/0/items/TARGET01', (_req, _res, h) =>
        h.raw(401, { 'Zotero-Server-ID': SERVER_ID }, 'Rejected'),
      )
      const { deps } = writeDeps(mock)
      const authorizer = new WriteAuthorizer({
        client: deps.writer,
        credentials: () => credentials,
        persistKey: () => true,
      })
      const error = await withWriteKey({ ...deps, authorizer }, SERVER_ID, undefined, (apiKey) =>
        deps.writer.patch(
          '/api/users/0/items/TARGET01',
          { title: 'Requested' },
          { apiKey, serverId: SERVER_ID, ifUnmodifiedSinceVersion: 1 },
        ),
      ).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ZoteroError)
      expect(error).toMatchObject({
        code: ZOTERO_WRITE_UNAUTHORIZED,
        message: expect.stringContaining('credentials storage could not revoke'),
      })
      if (!(error instanceof Error) || !(error.cause instanceof AggregateError))
        throw new Error('Expected both failure causes')
      expect(error.cause.errors[0]).toMatchObject({ code: ZOTERO_WRITE_UNAUTHORIZED })
      expect(error.cause.errors[1]).toBe(storageError)
      expect(error.cause.cause).toBe(error.cause.errors[0])
      expect(mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(failAt)
      expect(mock.requests.filter((r) => r.pathname.endsWith('/authorize'))).toHaveLength(
        failAt - 1,
      )
    },
  )
})
