/** A real 409 wire response carries the stable range-unsupported discriminator. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { isRangeUnsupportedError, ZoteroError, ZOTERO_RANGE_UNSUPPORTED } from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { testHttpClient } from '../helpers/test-clients.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await MockZotero.start()
})
afterEach(async () => {
  await mock.close()
})

it('translates HTTP 409 to the exact code recognized by changes reconciliation', async () => {
  mock.route('GET', '/api/users/0/deleted', (_req, _res, helpers) =>
    helpers.raw(409, { 'Content-Type': 'text/plain' }, 'Conflict'),
  )
  let failure: unknown
  try {
    await testHttpClient(mock.baseUrl).getJson(
      'users/0/deleted',
      new URLSearchParams({ since: '1' }),
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(ZoteroError)
  expect(failure).toMatchObject({ code: ZOTERO_RANGE_UNSUPPORTED })
  expect(isRangeUnsupportedError(failure)).toBe(true)
  expect(isRangeUnsupportedError(new ZoteroError('other', 'ZOTERO_NOT_FOUND'))).toBe(false)
  expect(isRangeUnsupportedError({ code: ZOTERO_RANGE_UNSUPPORTED })).toBe(false)
})
