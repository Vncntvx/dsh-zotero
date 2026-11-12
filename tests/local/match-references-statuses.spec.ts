/**
 * `matchReferences` scoring and status arms: citation-key selection (with a
 * decoy candidate), venue-scaled title matches, candidates without a year,
 * a field diff with no differences, a DOI sweep that reads a DOI-less row,
 * and the truncation reason on every ambiguous/conflict status.
 * @module tests/local/match-references-statuses
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { matchReferences } from '../../src/local/match-references-domain.js'
import type { ZoteroSearchItem, ZoteroSearchResult } from '../../src/types.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { searchHit } from '../helpers/server/objects.js'

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

function result(items: ZoteroSearchItem[], total = items.length): ZoteroSearchResult {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items,
    total,
    offset: 0,
    returned: items.length,
    ...(total > items.length ? { nextOffset: items.length } : {}),
  }
}

type SearchFn = Parameters<typeof matchReferences>[0]['search']

function deps(search: SearchFn, client: ZoteroHttpClient = {} as ZoteroHttpClient) {
  return { search, client, limits: PROVIDER_LIMITS }
}

describe('matchReferences candidate selection', () => {
  it('selects a citation key when no DOI is present and ignores a non-matching decoy', async () => {
    const decoy = hit({
      ref: 'zotero://user/0/item/BBBB1234',
      title: 'An Unrelated Paper',
      citationKey: 'other-key',
    })
    const output = await matchReferences(
      deps(async () => result([hit({ citationKey: 'native-key' }), decoy])),
      { references: [{ inputId: 'key', bibKey: 'native-key', title: 'A Reference Title' }] },
    )
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: {
        ref: 'zotero://user/0/item/ABCD1234',
        matchMethod: 'citationKey',
        confidence: 'high',
      },
    })
  })

  it('prefers the candidate whose venue agrees when title, year, and authors tie', async () => {
    const sameVenue = hit({ citationKey: 'same' })
    const otherVenue = hit({
      ref: 'zotero://user/0/item/BBBB1234',
      venue: 'Other Journal',
      citationKey: 'other',
    })
    const output = await matchReferences(
      deps(async () => result([otherVenue, sameVenue])),
      {
        references: [
          {
            inputId: 'venue',
            title: 'A Reference Title',
            authors: ['Tri Dao'],
            year: 2024,
            venue: 'Journal of Tests',
          },
        ],
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { ref: 'zotero://user/0/item/ABCD1234', confidence: 'high' },
    })
  })

  it('omits the year from a candidate row that carries none', async () => {
    const output = await matchReferences(
      deps(async () => result([hit({ year: undefined, authors: undefined })])),
      { references: [{ inputId: 'no-year', title: 'A Reference Title' }] },
    )
    expect(output.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          confidence: 'medium',
        },
      ],
    })
    const candidate = (output.items[0] as { candidates: { year?: number }[] }).candidates[0]!
    expect('year' in candidate).toBe(false)
  })

  it('omits the field diff when every compared field agrees', async () => {
    const output = await matchReferences(
      deps(async () => result([hit()])),
      {
        references: [
          {
            inputId: 'same',
            title: 'A Reference Title',
            authors: ['Tri Dao'],
            year: 2024,
            venue: 'Journal of Tests',
          },
        ],
        includeFieldDiff: true,
      },
    )
    expect(output.items[0]).toMatchObject({ status: 'matched' })
    expect(output.items[0]).not.toHaveProperty('fieldDiff')
  })
})

describe('matchReferences DOI sweep', () => {
  it('skips a listing row that carries no DOI while retaining the DOI hit', async () => {
    const client = {
      getJson: async () => ({
        json: [
          searchHit({ key: 'NODOI001', data: { title: 'No DOI Here' } }),
          searchHit({ key: 'ABCD1234', data: { DOI: '10.1000/found' } }),
        ],
        headers: new Headers({
          'Total-Results': '2',
          'Zotero-Server-ID': 'S1',
          'Last-Modified-Version': '7',
        }),
      }),
    } as unknown as ZoteroHttpClient
    const output = await matchReferences(
      deps(async () => result([]), client),
      { references: [{ inputId: 'found', doi: '10.1000/found' }] },
    )
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: {
        ref: 'zotero://user/0/item/ABCD1234?server=S1',
        matchMethod: 'doi',
      },
    })
  })
})

describe('matchReferences truncation reason', () => {
  it('marks a truncated search with no candidates as ambiguous', async () => {
    const output = await matchReferences(
      deps(async () => result([], 10)),
      { references: [{ inputId: 'empty-truncated', title: 'No candidate' }] },
    )
    expect(output.items[0]).toMatchObject({
      status: 'ambiguous',
      reason: expect.stringContaining('truncated'),
    })
  })

  it('keeps the truncation reason beside tied candidates', async () => {
    const second = hit({ ref: 'zotero://user/0/item/BBBB1234' })
    const output = await matchReferences(
      deps(async () => result([hit(), second], 10)),
      {
        references: [
          {
            inputId: 'tied-truncated',
            title: 'A Reference Title',
            authors: ['Tri Dao'],
            year: 2024,
          },
        ],
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'ambiguous',
      reason: expect.stringContaining('truncated'),
    })
    expect((output.items[0] as { candidates: unknown[] }).candidates).toHaveLength(2)
  })

  it('keeps the truncation reason on a citation-key conflict', async () => {
    const conflicting = hit({
      citationKeyConflict: { native: 'native', extra: 'extra' },
    })
    const output = await matchReferences(
      deps(async () => result([conflicting], 10)),
      {
        references: [
          { inputId: 'conflict', title: 'A Reference Title', authors: ['Tri Dao'], year: 2024 },
        ],
      },
    )
    expect(output.items[0]).toMatchObject({
      status: 'conflict',
      reason: expect.stringContaining('truncated'),
      candidates: [{ citationKeyConflict: { native: 'native', extra: 'extra' } }],
    })
  })
})
