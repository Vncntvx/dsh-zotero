/** Acknowledging a commit does not prove that Zotero saved the submitted content. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submittedFieldsMatch } from '../../../src/local/write-content-proof.js'
import { createItem } from '../../../src/local/write-domain.js'
import { createNote } from '../../../src/local/write-notes.js'
import { createSavedSearch, updateSavedSearch } from '../../../src/local/write-saved-searches.js'
import { parseRef } from '../../../src/refs.js'
import {
  batchHeaders,
  grantAuthorize,
  itemJson,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

describe('Zotero save normalization', () => {
  it('accepts the note envelope, HTML entity spelling and attribute order', () => {
    expect(
      submittedFieldsMatch(
        {
          note: '<div class="zotero-note znv1"><p><a title="A" href="https://example.org">A &#38; B</a></p></div>',
        },
        { note: '\u0000<p><a href="https://example.org" title="A">A &amp; B</a></p>\n' },
      ),
    ).toBe(true)
  })

  it.each([
    ['emphasis', '<p>A <em>study</em></p>', '<p>A <strong>study</strong></p>'],
    [
      'link target',
      '<p><a href="https://wrong.example">Study</a></p>',
      '<p><a href="https://example.org">Study</a></p>',
    ],
    ['paragraph boundary', '<p>A</p><p>B</p>', '<p>AB</p>'],
  ])('rejects changed %s even when visible text matches', (_name, saved, submitted) => {
    expect(submittedFieldsMatch({ note: saved }, { note: submitted })).toBe(false)
  })

  it('accepts creator empty fields and personal relation URI normalization', () => {
    expect(
      submittedFieldsMatch(
        {
          creators: [{ creatorType: 'author', firstName: '', lastName: 'Wu' }],
          relations: { 'dc:relation': 'http://zotero.org/users/987654/items/SOURCE01' },
        },
        {
          creators: [{ creatorType: 'author', lastName: 'Wu' }],
          relations: { 'dc:relation': ['http://zotero.org/users/0/items/SOURCE01'] },
        },
      ),
    ).toBe(true)
  })

  it('preserves group identity and arbitrary relation targets', () => {
    for (const saved of ['http://zotero.org/groups/42/items/SOURCE01', 'https://example.org/other'])
      expect(
        submittedFieldsMatch(
          { relations: { 'dc:relation': [saved] } },
          { relations: { 'dc:relation': ['http://zotero.org/users/0/items/SOURCE01'] } },
        ),
      ).toBe(false)
  })

  it('accepts reordered tags and collections sets', () => {
    expect(
      submittedFieldsMatch(
        { tags: [{ tag: 'b' }, { tag: 'a' }], collections: ['COLL_B', 'COLL_A'] },
        { tags: ['a', 'b'], collections: ['COLL_A', 'COLL_B'] },
      ),
    ).toBe(true)
  })

  it('accepts deleted boolean equivalents', () => {
    expect(submittedFieldsMatch({ deleted: 1 }, { deleted: true })).toBe(true)
    expect(submittedFieldsMatch({ deleted: 0 }, { deleted: false })).toBe(true)
    expect(submittedFieldsMatch({ deleted: 1 }, { deleted: false })).toBe(false)
  })
})

let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => {
  await mock.close()
})

describe('submitted content verification through the Local API', () => {
  it.each(['wrong DOI', 'missing DOI'])(
    'retains the commit identity without retrying a %s',
    async (scenario) => {
      grantAuthorize(mock)
      mock.route('POST', '/api/users/0/items', (_req, _res, h) =>
        h.json(
          {
            successful: {
              '0': itemJson('NEWITEM1', 25, {
                itemType: 'book',
                title: 'Study',
                ...(scenario === 'wrong DOI' ? { DOI: '10.1000/other' } : {}),
              }),
            },
          },
          batchHeaders(25),
        ),
      )
      const { deps } = writeDeps(mock)
      expect(
        await createItem(deps, { itemType: 'book', title: 'Study', doi: '10.1000/requested' }),
      ).toMatchObject({
        kind: 'committed-unverified',
        key: 'NEWITEM1',
        reason: 'saved-state-unverified',
        retryable: false,
      })
      expect(
        mock.requests.filter((r) => r.pathname.endsWith('/items') && r.method === 'POST'),
      ).toHaveLength(1)
    },
  )

  it('refuses a saved note with different formatting and the same text', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, _res, h) =>
      h.json(
        {
          successful: {
            '0': itemJson('NEWNOTE1', 25, { itemType: 'note', note: '<p><em>Study</em></p>' }),
          },
        },
        batchHeaders(25),
      ),
    )
    const { deps } = writeDeps(mock)
    expect(await createNote(deps, { markdown: '**Study**' })).toMatchObject({
      kind: 'committed-unverified',
      key: 'NEWNOTE1',
      reason: 'saved-state-unverified',
      retryable: false,
    })
    expect(
      mock.requests.filter((r) => r.pathname.endsWith('/items') && r.method === 'POST'),
    ).toHaveLength(1)
  })

  const conditions = [{ condition: 'title', operator: 'contains', value: 'study' }]
  it('does not accept a created search with different conditions', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/searches', (_req, _res, h) =>
      h.json(
        {
          successful: {
            '0': {
              key: 'SEARCH01',
              version: 25,
              data: {
                key: 'SEARCH01',
                version: 25,
                name: 'Study',
                conditions: [{ ...conditions[0], value: 'other' }],
              },
            },
          },
        },
        batchHeaders(25),
      ),
    )
    const { deps } = writeDeps(mock)
    expect(await createSavedSearch(deps, { name: 'Study', conditions })).toMatchObject({
      kind: 'committed-unverified',
      key: 'SEARCH01',
      reason: 'saved-state-unverified',
      retryable: false,
    })
    expect(
      mock.requests.filter((r) => r.pathname.endsWith('/searches') && r.method === 'POST'),
    ).toHaveLength(1)
  })

  it.each(['stale name', 'stale conditions', 'read failure', 'older version'])(
    'does not retry an acknowledged search update after %s',
    async (scenario) => {
      grantAuthorize(mock)
      let patched = false
      mock.route('GET', '/api/users/0/searches/SEARCH01', (_req, _res, h) => {
        if (patched && scenario === 'read failure') return h.raw(500, batchHeaders(25), 'Failed')
        const version = patched ? (scenario === 'older version' ? 6 : 25) : 7
        h.json(
          {
            key: 'SEARCH01',
            version,
            data: {
              key: 'SEARCH01',
              version,
              name: patched && scenario !== 'stale name' ? 'Study 2' : 'Study',
              conditions:
                patched && scenario === 'stale conditions'
                  ? [{ ...conditions[0], value: 'other' }]
                  : conditions,
            },
          },
          batchHeaders(version),
        )
      })
      mock.route('PATCH', '/api/users/0/searches/SEARCH01', (_req, _res, h) => {
        patched = true
        h.raw(204, batchHeaders(25), '')
      })
      const { deps } = writeDeps(mock)
      expect(
        await updateSavedSearch(deps, {
          search: parseRef(`zotero://user/0/search/SEARCH01?server=${SERVER_ID}`),
          name: 'Study 2',
        }),
      ).toMatchObject({
        kind: 'committed-unverified',
        key: 'SEARCH01',
        reason: 'saved-state-unverified',
        retryable: false,
      })
      expect(mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1)
    },
  )
})
