/** Library-wide tag deletion proves membership before counting completed writes. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteLibraryTags } from '../../../src/local/write-library-maintenance.js'
import {
  WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  writeNonBlankMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
} from '../../../src/errors.js'
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

describe('deleteLibraryTags', () => {
  /** Serve the library-version read and record the DELETE it precedes. */
  function serveLibraryVersion(version: number | undefined, serverId = SERVER_ID): void {
    const headers: Record<string, string> = { 'Zotero-Server-ID': serverId }
    if (version !== undefined) headers['Last-Modified-Version'] = String(version)
    mock.route('GET', '/api/users/0/items/top', (_req, res, helpers) =>
      helpers.raw(200, headers, JSON.stringify([])),
    )
  }

  function serveTagSnapshot(version: number | undefined, serverId = SERVER_ID): void {
    serveLibraryVersion(version, serverId)
    const headers = {
      'Zotero-Server-ID': serverId,
      ...(version === undefined ? {} : { 'Last-Modified-Version': String(version) }),
    }
    const tags = ['legacy', 'methods', 'to read', 'a|b']
    mock.route('GET', '/api/users/0/tags', (_req, _res, helpers) =>
      helpers.json(
        tags.map((tag) => ({ tag })),
        { ...headers, 'Total-Results': String(tags.length) },
      ),
    )
  }

  it('proves a tag beyond the first page and excludes every absent name from its receipt', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(88)
    const tags = [
      ...Array.from({ length: 100 }, (_, index) => ({ tag: `unrelated-${index}` })),
      { tag: 'selected' },
    ]
    mock.route('GET', '/api/users/0/tags', (_req, _res, h, query) => {
      const start = Number(query.get('start'))
      h.json(tags.slice(start, start + 100), {
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '88',
        'Total-Results': '101',
      })
    })
    mock.route('DELETE', '/api/users/0/tags', (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['selected', 'ghost'] })).resolves.toMatchObject({
      kind: 'deleted',
      deletedTags: ['selected'],
      absentTags: ['ghost'],
    })
    expect(mock.requests.find((request) => request.method === 'DELETE')?.search.get('tag')).toBe(
      'selected',
    )
    expect(
      mock.requests.some(
        (request) => request.pathname.endsWith('/tags') && request.search.get('start') === '100',
      ),
    ).toBe(true)
  })

  it('settles an all-absent selection without asking Zotero for a grant or sending a deletion', async () => {
    serveTagSnapshot(88)
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['ghost'] })).resolves.toMatchObject({
      kind: 'deleted',
      deletedTags: [],
      absentTags: ['ghost'],
      libraryVersion: 88,
    })
    expect(mock.requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it.each(['changed-version', 'missing-version', 'missing-name'] as const)(
    'refuses an unproven %s tag snapshot before requesting a grant',
    async (fault) => {
      serveLibraryVersion(88)
      mock.route('GET', '/api/users/0/tags', (_req, _res, h) =>
        h.json(fault === 'missing-name' ? [{}] : [{ tag: 'legacy' }], {
          'Zotero-Server-ID': SERVER_ID,
          'Total-Results': '1',
          ...(fault === 'missing-version'
            ? {}
            : { 'Last-Modified-Version': fault === 'changed-version' ? '89' : '88' }),
        }),
      )
      const { deps } = writeDeps(mock)
      await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
        code: fault === 'changed-version' ? ZOTERO_WRITE_CONFLICT : ZOTERO_UNEXPECTED,
      })
      expect(mock.requests.every((request) => request.method === 'GET')).toBe(true)
    },
  )

  it('refuses an empty or blank selection before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: [] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: 'tags must carry at least one item.',
    })
    await expect(deleteLibraryTags(deps, { tags: ['  '] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('tags'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('reads the library version, then deletes the tag query under that precondition', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const { deps } = writeDeps(mock)
    const result = await deleteLibraryTags(deps, { tags: ['legacy', 'methods'] })
    expect(result).toEqual({
      kind: 'deleted',
      deletedTags: ['legacy', 'methods'],
      libraryVersion: 89,
      serverId: SERVER_ID,
    })
    const versionRead = mock.requests.find(
      (request) => request.method === 'GET' && request.pathname === '/api/users/0/items/top',
    )
    expect(versionRead?.search.get('limit')).toBe('1')
    const deleted = mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.pathname).toBe('/api/users/0/tags')
    expect(deleted?.search.get('tag')).toBe('legacy||methods')
    expect(deleted?.headers['if-unmodified-since-version']).toBe('88')
  })

  it('encodes each tag name so spaces and operators survive the query', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(12)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, ''),
    )
    const { deps } = writeDeps(mock)
    const result = await deleteLibraryTags(deps, { tags: ['to read', 'a|b'] })
    if (result.kind !== 'deleted') throw new Error(`unexpected write outcome: ${result.kind}`)
    expect(result.deletedTags).toEqual(['a|b', 'to read'])
    const deleted = mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.search.getAll('tag')).toEqual(['to read||a|b'])
    expect(deleted?.pathname).toBe('/api/users/0/tags')
  })

  it('reports a missing tag as absent and excludes it from the delete query', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const { deps } = writeDeps(mock)
    // The delete is a tag query: a requested name no item carries is skipped
    // rather than refused, so a rerun answers with the identical receipt.
    const first = await deleteLibraryTags(deps, { tags: ['gone', 'legacy'] })
    const second = await deleteLibraryTags(deps, { tags: ['gone', 'legacy'] })
    if (first.kind !== 'deleted' || second.kind !== 'deleted')
      throw new Error(`unexpected write outcome: ${first.kind}/${second.kind}`)
    expect(second).toEqual(first)
    expect(first.deletedTags).toEqual(['legacy'])
    expect(first.absentTags).toEqual(['gone'])
    expect(
      mock.requests
        .filter((request) => request.method === 'DELETE')
        .every((request) => request.search.get('tag') === 'legacy'),
    ).toBe(true)
    expect(mock.requests.filter((request) => request.method === 'DELETE')).toHaveLength(2)
  })

  it('fails loud when the library-version read carries no version', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(undefined)
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('rejects a library-version read served by a different Zotero instance', async () => {
    serveTagSnapshot(88, 'OTHER1234')
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
      message: SERVER_MISMATCH_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('maps a lost precondition onto the write conflict', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(
        412,
        { 'Content-Type': 'text/plain' },
        'item has been modified since specified version (expected 88, found 89)',
      ),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_WRITE_CONFLICT,
    })
  })

  it('returns an unverified receipt when library tag deletion omits its version', async () => {
    grantAuthorize(mock)
    serveTagSnapshot(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, _res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID }, ''),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'receipt-unknown',
      serverId: SERVER_ID,
      retryable: false,
    })
    expect(mock.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
  })
})
