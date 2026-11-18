import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
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
import { deferred } from '../../helpers/sync.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('saved-search writes', () => {
  it.each(['before-patch', 'during-patch', 'after-acknowledgment'] as const)(
    'preserves the %s cancellation boundary',
    async (phase) => {
      grantAuthorize(mock)
      const key = 'SEARCH01'
      const path = `/api/users/0/searches/${key}`
      const address = `zotero://user/0/search/${key}`
      const signal = new AbortController()
      const hold = deferred()
      const arrived = deferred()
      let reads = 0
      mock.route('GET', path, async (_req, _res, helpers) => {
        reads += 1
        if (phase === 'before-patch' || reads === 2) {
          arrived.resolve()
          await hold.promise
        }
        helpers.json(
          {
            key,
            version: 12,
            data: {
              key,
              name: 'Old',
              conditions: [{ condition: 'title', operator: 'contains', value: 'review' }],
            },
          },
          { 'Zotero-Server-ID': SERVER_ID },
        )
      })
      mock.route('PATCH', path, async (_req, _res, helpers) => {
        if (phase === 'during-patch') {
          arrived.resolve()
          await hold.promise
        }
        helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '30' }, '')
      })
      const pending = updateSavedSearch(
        writeDeps(mock).deps,
        { search: parseRef(address), name: 'New' },
        signal.signal,
      )
      try {
        await arrived.promise
        signal.abort()
        await expect(pending).rejects.toMatchObject({
          code: TOOL_ABORTED,
          ...(phase === 'after-acknowledgment'
            ? {
                message: expect.stringContaining('Do not retry'),
                receipt: {
                  ref: `${address}?server=${SERVER_ID}`,
                  libraryVersion: 30,
                  kind: 'committed-unverified',
                  retryable: false,
                },
              }
            : {}),
        })
        if (phase === 'during-patch')
          await expect(pending).rejects.toMatchObject({ name: 'ZoteroWriteCommitUnknownError' })
        if (phase === 'before-patch') await expect(pending).rejects.not.toHaveProperty('receipt')
        expect(mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(
          phase === 'before-patch' ? 0 : 1,
        )
      } finally {
        hold.resolve()
      }
    },
  )

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

  it('returns unverified receipts for update and delete without version headers', async () => {
    grantAuthorize(mock)
    const ref = parseRef('zotero://user/0/search/SEARCH01')
    const conditions = [{ condition: 'title', operator: 'contains', value: 'review' }]
    mock.route('GET', '/api/users/0/searches/SEARCH01', (_req, _res, helpers) =>
      helpers.json(
        {
          key: 'SEARCH01',
          version: 12,
          data: { key: 'SEARCH01', name: 'Old name', conditions },
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' },
      ),
    )
    mock.route('PATCH', '/api/users/0/searches/SEARCH01', (_req, _res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID }, ''),
    )
    mock.route('DELETE', '/api/users/0/searches/SEARCH01', (_req, _res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID }, ''),
    )
    const { deps } = writeDeps(mock)
    await expect(updateSavedSearch(deps, { search: ref, name: 'New name' })).resolves.toMatchObject(
      {
        kind: 'committed-unverified',
        reason: 'receipt-unknown',
        key: 'SEARCH01',
        retryable: false,
      },
    )
    await expect(deleteSavedSearch(deps, { search: ref })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'receipt-unknown',
      key: 'SEARCH01',
      retryable: false,
    })
    expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1)
    expect(mock.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
  })
})
