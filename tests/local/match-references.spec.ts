import { describe, expect, it } from 'vitest'
import { matchReferences } from '../../src/local/match-references-domain.js'
import type { ZoteroSearchItem, ZoteroSearchResult } from '../../src/types.js'
import { deferred } from '../helpers/sync.js'

const hit = (overrides: Partial<ZoteroSearchItem> = {}): ZoteroSearchItem => ({
  ref: 'zotero://user/0/item/ABCD1234',
  title: 'A Reference Title',
  creatorSummary: 'Dao, Tri',
  authors: ['Tri Dao'],
  year: 2024,
  venue: 'Journal of Tests',
  itemType: 'journalArticle',
  ...overrides,
})

function result(items: ZoteroSearchItem[], total = items.length, offset = 0): ZoteroSearchResult {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items,
    total,
    offset,
    returned: items.length,
    ...(total > offset + items.length ? { nextOffset: offset + items.length } : {}),
  }
}

describe('matchReferences', () => {
  it('prefers an exact normalized DOI and returns a stable mapped ref', async () => {
    const requests: Array<{ query?: string; mode: string }> = []
    const output = await matchReferences(
      {
        search: async (request) => {
          requests.push({ query: request.query, mode: request.mode })
          return result([
            hit({ doi: '10.1000/example', citationKey: 'native-key', citationKeySource: 'native' }),
          ])
        },
      },
      {
        references: [
          { inputId: 'entry-a', doi: 'https://doi.org/10.1000/EXAMPLE', title: 'Different title' },
        ],
        includeFieldDiff: true,
      },
    )
    expect(output.items[0]).toMatchObject({
      inputId: 'entry-a',
      status: 'matched',
      selected: {
        ref: 'zotero://user/0/item/ABCD1234',
        citationKey: 'native-key',
        matchMethod: 'doi',
        confidence: 'high',
      },
    })
    expect(requests).toEqual([{ query: '', mode: 'metadata' }])
  })

  it('finds a DOI-only reference by scanning local DOI metadata', async () => {
    const requests: Array<{ query?: string; mode: string }> = []
    const output = await matchReferences(
      {
        search: async (request) => {
          requests.push({ query: request.query, mode: request.mode })
          return result([hit({ doi: '10.1000/doi-only' })])
        },
      },
      { references: [{ inputId: 'doi-only', doi: '10.1000/doi-only' }] },
    )
    expect(output.items[0]).toMatchObject({ status: 'matched', selected: { matchMethod: 'doi' } })
    expect(requests).toEqual([{ query: '', mode: 'metadata' }])
  })

  it('falls back to a normalized title and reports field differences', async () => {
    const output = await matchReferences(
      {
        search: async (request) => result(request.query === '10.1000/missing' ? [] : [hit()]),
      },
      {
        references: [
          {
            inputId: 'entry-b',
            doi: '10.1000/missing',
            title: 'A Reference: Title!',
            authors: ['Tri Dao'],
            year: 2024,
          },
        ],
        includeFieldDiff: true,
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { matchMethod: 'titleFingerprint', confidence: 'high' },
      fieldDiff: { title: { input: 'A Reference: Title!', zotero: 'A Reference Title' } },
    })
  })

  it('keeps equal candidates ambiguous and citekey disagreements in conflict status', async () => {
    const second = hit({ ref: 'zotero://user/0/item/BBBB1234' })
    const ambiguous = await matchReferences(
      { search: async () => result([hit(), second]) },
      {
        references: [
          { inputId: 'entry-c', title: 'A Reference Title', authors: ['Tri Dao'], year: 2024 },
        ],
      },
    )
    expect(ambiguous.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [
        { ref: 'zotero://user/0/item/ABCD1234' },
        { ref: 'zotero://user/0/item/BBBB1234' },
      ],
    })

    const conflict = await matchReferences(
      {
        search: async () =>
          result([
            hit({
              doi: '10.1000/exact',
              citationKey: 'native',
              citationKeySource: 'native',
              citationKeyConflict: { native: 'native', extra: 'extra' },
            }),
          ]),
      },
      {
        references: [{ inputId: 'entry-d', doi: '10.1000/exact' }],
      },
    )
    expect(conflict.items[0]).toMatchObject({
      status: 'conflict',
      candidates: [{ citationKeyConflict: { native: 'native', extra: 'extra' } }],
    })
  })

  it('scans every library page before selecting an exact DOI match', async () => {
    const library = [
      hit({ doi: '10.1000/exact' }),
      ...Array.from({ length: 124 }, (_, index) =>
        hit({
          ref: `zotero://user/0/item/${String(index).padStart(8, '0')}`,
          doi: `10.1000/other-${index}`,
        }),
      ),
    ]
    const offsets: number[] = []
    const output = await matchReferences(
      {
        search: async (request) => {
          offsets.push(request.offset)
          return result(
            library.slice(request.offset, request.offset + request.limit),
            library.length,
            request.offset,
          )
        },
      },
      {
        references: [{ inputId: 'entry-window', doi: '10.1000/exact' }],
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { ref: 'zotero://user/0/item/ABCD1234', confidence: 'high' },
    })
    expect(offsets).toEqual([0, 100])
  })

  it('fails the DOI reconciliation if the library total changes during pagination', async () => {
    const pages = [
      result(
        Array.from({ length: 100 }, (_, index) =>
          hit({
            ref: `zotero://user/0/item/${String(index).padStart(8, '0')}`,
          }),
        ),
        101,
      ),
      result([hit({ doi: '10.1000/exact' })], 102, 100),
    ]
    let calls = 0
    await expect(
      matchReferences(
        { search: async (request) => (request.query === '' ? pages[calls++]! : result([], 0)) },
        { references: [{ inputId: 'changing', doi: '10.1000/exact' }] },
      ),
    ).rejects.toThrow('library changed during DOI lookup')
    expect(calls).toBe(2)
  })

  it('marks unmatched inputs and rejects invalid or duplicate inputs', async () => {
    const empty = await matchReferences(
      { search: async () => result([]) },
      {
        references: [{ inputId: 'missing', title: 'No local match' }],
      },
    )
    expect(empty.items[0]).toEqual({ inputId: 'missing', status: 'notFound' })
    await expect(
      matchReferences({ search: async () => result([]) }, { references: [] }),
    ).rejects.toThrow('1-50')
    await expect(
      matchReferences(
        { search: async () => result([]) },
        {
          references: [
            { inputId: 'x', title: 'Title' },
            { inputId: 'x', title: 'Title 2' },
          ],
        },
      ),
    ).rejects.toThrow('unique')
    await expect(
      matchReferences({ search: async () => result([]) }, { references: [{ inputId: 'x' }] }),
    ).rejects.toThrow('DOI or title')
  })

  it('marks low and medium confidence matches as ambiguous', async () => {
    const low = await matchReferences(
      { search: async () => result([hit({ year: 2024, authors: ['Tri Dao'] })]) },
      { references: [{ inputId: 'low', title: 'A Reference Title', year: 1999 }] },
    )
    expect(low.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [{ ref: 'zotero://user/0/item/ABCD1234', confidence: 'low' }],
    })

    const medium = await matchReferences(
      { search: async () => result([hit({ year: 2024, authors: ['Tri Dao'] })]) },
      { references: [{ inputId: 'medium', title: 'A Reference Title' }] },
    )
    expect(medium.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [{ ref: 'zotero://user/0/item/ABCD1234', confidence: 'medium' }],
    })
  })

  it('marks truncated candidate searches as ambiguous with an explanatory reason', async () => {
    const output = await matchReferences(
      {
        search: async () => ({
          scope: { kind: 'library', library: { type: 'user', id: 0 } },
          items: [hit({ year: 2024, authors: ['Tri Dao'] })],
          total: 10,
          offset: 0,
          returned: 1,
          nextOffset: 1,
        }),
      },
      {
        references: [
          { inputId: 'truncated', title: 'A Reference Title', authors: ['Tri Dao'], year: 2024 },
        ],
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'ambiguous',
      reason: expect.stringContaining('truncated'),
    })
  })

  it('fails if DOI paging returns an invalid cursor or unexpected end', async () => {
    await expect(
      matchReferences(
        {
          search: async () => ({
            scope: { kind: 'library', library: { type: 'user', id: 0 } },
            items: [hit({ doi: '10.1000/other' })],
            total: 1,
            offset: 0,
            returned: 1,
            nextOffset: 1,
          }),
        },
        { references: [{ inputId: 'cursor-past-total', doi: '10.1000/needed' }] },
      ),
    ).rejects.toThrow('cursor beyond its total')

    await expect(
      matchReferences(
        {
          search: async () => ({
            scope: { kind: 'library', library: { type: 'user', id: 0 } },
            items: [],
            total: 5,
            offset: 0,
            returned: 0,
          }),
        },
        { references: [{ inputId: 'truncated-page', doi: '10.1000/needed' }] },
      ),
    ).rejects.toThrow('did not return every library page')
  })

  it('limits concurrent searches to eight and preserves the fifty input ids', async () => {
    const references = Array.from({ length: 50 }, (_, index) => ({
      inputId: `entry-${index}`,
      title: `Reference title ${index}`,
    }))
    const release = deferred<void>()
    const eightStarted = deferred<void>()
    let active = 0
    let maximumActive = 0
    const outputPromise = matchReferences(
      {
        search: async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          if (active === 8) eightStarted.resolve()
          await release.promise
          active -= 1
          return result([])
        },
      },
      { references },
    )
    await eightStarted.promise
    expect(active).toBe(8)
    release.resolve()
    const output = await outputPromise
    expect(maximumActive).toBe(8)
    expect(output.items.map((item) => item.inputId)).toEqual(references.map((item) => item.inputId))
  })
})
