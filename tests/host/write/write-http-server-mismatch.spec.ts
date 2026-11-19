/**
 * A 2xx write answered by a different instance is commit-state unknown: the
 * request was dispatched, so the failure must carry the commit-unknown
 * marking while keeping the mismatch code and message.
 * @module tests/host/write/write-http-server-mismatch
 */

import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  SERVER_MISMATCH_MESSAGE,
  ZoteroWriteCommitUnknownError,
  ZOTERO_SERVER_MISMATCH,
} from '../../../src/errors.js'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { WRITE_SERVER_ID as SERVER_ID } from '../../helpers/server/keys.js'
import { testWriteClient } from '../../helpers/test-clients.js'

const API_KEY = 'placeholder-local-write-key'

let mock: MockZotero
let client: ReturnType<typeof testWriteClient>
beforeEach(async () => {
  mock = await MockZotero.start()
  client = testWriteClient(mock.baseUrl)
})
afterEach(async () => {
  await mock.close()
})

it('marks a successful response from another instance as commit-unknown', async () => {
  mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': 'srv-other', 'Last-Modified-Version': '42' },
      JSON.stringify({ successful: {}, success: {}, unchanged: {}, failed: {} }),
    ),
  )
  const write = client.batch('users/0/items', [{ itemType: 'note', note: '<div>x</div>' }], {
    serverId: SERVER_ID,
    apiKey: API_KEY,
  })
  await expect(write).rejects.toBeInstanceOf(ZoteroWriteCommitUnknownError)
  await expect(write).rejects.toMatchObject({
    code: ZOTERO_SERVER_MISMATCH,
    message: SERVER_MISMATCH_MESSAGE,
  })
})

it('keeps a 412 from a different instance as a pre-commit refusal', async () => {
  mock.route('POST', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.raw(412, { 'Zotero-Server-ID': 'srv-other' }, ''),
  )
  const write = client.batch('users/0/items', [{ itemType: 'note', note: '<div>x</div>' }], {
    serverId: SERVER_ID,
    apiKey: API_KEY,
  })
  await expect(write).rejects.not.toBeInstanceOf(ZoteroWriteCommitUnknownError)
  await expect(write).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
})
