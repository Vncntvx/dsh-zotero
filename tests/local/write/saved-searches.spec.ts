import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSavedSearch,
  deleteSavedSearch,
  updateSavedSearch,
} from '../../../src/local/write-saved-searches.js'
import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { parseRef } from '../../../src/refs.js'
import {
  grantAuthorize,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('saved-search writes', () => {
  it('refuses empty conditions before contacting Zotero', async () => {
    const { deps } = writeDeps(mock)
    await expect(createSavedSearch(deps, { name: 'Review', conditions: [] })).rejects.toMatchObject(
      {
        code: ZOTERO_INVALID_ARGUMENT,
      },
    )
    expect(mock.requests).toHaveLength(0)
  })

  it('reports the saved state only from Zotero’s verified create echo', async () => {
    grantAuthorize(mock)
    const conditions = [{ condition: 'title', operator: 'contains', value: 'review' }]
    mock.route('POST', '/api/users/0/searches', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '30' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'SEARCH01',
              version: 30,
              data: { key: 'SEARCH01', version: 30, name: 'Review', conditions },
            },
          },
          success: { '0': 'SEARCH01' },
          failed: {},
          unchanged: {},
        }),
      ),
    )
    const { deps } = writeDeps(mock)

    const result = await createSavedSearch(deps, { name: 'Review', conditions })

    expect(result).toMatchObject({
      kind: 'applied',
      ref: 'zotero://user/0/search/SEARCH01?server=srv-write-domain-1',
      name: 'Review',
      conditions,
      libraryVersion: 30,
    })
  })

  it('uses the read version for update and delete preconditions', async () => {
    grantAuthorize(mock)
    const ref = parseRef('zotero://user/0/search/SEARCH01')
    const conditions = [{ condition: 'title', operator: 'contains', value: 'review' }]
    mock.route('GET', '/api/users/0/searches/SEARCH01', (_req, res, helpers) =>
      helpers.json(
        {
          key: 'SEARCH01',
          version: 12,
          data: { key: 'SEARCH01', name: 'Old name', conditions },
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' },
      ),
    )
    mock.route('PATCH', '/api/users/0/searches/SEARCH01', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, ''),
    )
    mock.route('DELETE', '/api/users/0/searches/SEARCH01', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '14' }, ''),
    )
    const { deps } = writeDeps(mock)

    await updateSavedSearch(deps, { search: ref, name: 'New name' })
    const patch = mock.requests.find((request) => request.method === 'PATCH')
    expect(patch?.headers['if-unmodified-since-version']).toBe('12')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ name: 'New name' })

    await deleteSavedSearch(deps, { search: ref })
    const deletion = mock.requests.find((request) => request.method === 'DELETE')
    expect(deletion?.headers['if-unmodified-since-version']).toBe('12')
  })
})
