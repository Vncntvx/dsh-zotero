/**
 * `zotero_match_references`: the DOI sweep lists the whole top-level library
 * once through the shared concurrent page walker, so its cases drive the
 * provider over the mocked Local API and inherit the walker's per-page
 * fences; the title-fallback scoring cases that never carry a DOI keep the
 * search-stub lane. The sweep can no longer see a server-declared cursor
 * (the walker derives windows arithmetically), so the old cursor-fence case
 * is covered by the walker's own pagination spec instead.
 * @module tests/local/match-references
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { MATCH_REFERENCES_MAX, matchReferences } from '../../src/local/match-references-domain.js'
import type { ZoteroSearchItem, ZoteroSearchResult } from '../../src/types.js'
import {
  PROVIDER_LIMITS,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { searchHit } from '../helpers/server/objects.js'
import { SERVER_ID } from '../helpers/server/keys.js'
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

type SearchFn = Parameters<typeof matchReferences>[0]['search']

/** Domain-lane deps: the DOI sweep never runs for title-only inputs. */
function domainDeps(search: SearchFn) {
  return { search, client: {} as ZoteroHttpClient, limits: PROVIDER_LIMITS }
}

/** One listing wire row; Zotero keys are eight alphanumerics. */
function doiRow(key: string, doi: string | undefined, extra: Record<string, unknown> = {}) {
  return searchHit({ key, data: { ...(doi === undefined ? {} : { DOI: doi }), ...extra } })
}

/**
 * Serve the top-level listing the walker reads: rows are windowed by the
 * request's own `start`/`limit`, and the callback picks the page version so
 * a drift case can move it mid-walk.
 */
function serveListing(
  harness: ProviderHarness,
  rows: unknown[],
  total = rows.length,
  versionAt: (start: number) => string = () => '3',
): void {
  harness.mock.route('GET', /^\/api\/users\/0\/items\/top$/, (req, res, helpers, search) => {
    const start = Number(search.get('start') ?? '0')
    const limit = Number(search.get('limit') ?? '100')
    helpers.json(rows.slice(start, start + limit), {
      'Total-Results': String(total),
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': versionAt(start),
    })
  })
}

describe('matchReferences: DOI sweep over the library listing', () => {
  let harness: ProviderHarness

  beforeEach(async () => {
    harness = await setupProvider()
  })

  afterEach(async () => {
    await teardownProvider(harness)
  })

  it('prefers an exact normalized DOI and returns a stable mapped ref', async () => {
    serveListing(harness, [
      doiRow('ABCD1234', '10.1000/example', {
        citationKey: 'native-key',
        title: 'A Reference Title',
      }),
    ])
    const output = await harness.provider.matchReferences({
      references: [
        { inputId: 'entry-a', doi: 'https://doi.org/10.1000/EXAMPLE', title: 'Different title' },
      ],
      includeFieldDiff: true,
    })
    expect(output.items[0]).toMatchObject({
      inputId: 'entry-a',
      status: 'matched',
      selected: {
        ref: `zotero://user/0/item/ABCD1234?server=${SERVER_ID}`,
        citationKey: 'native-key',
        matchMethod: 'doi',
        confidence: 'high',
      },
    })
    // One listing request; an exact DOI hit never falls back to a search.
    expect(harness.mock.requests).toHaveLength(1)
  })

  it('finds a DOI-only reference by scanning local DOI metadata', async () => {
    serveListing(harness, [doiRow('ABCD1234', '10.1000/doi-only')])
    const output = await harness.provider.matchReferences({
      references: [{ inputId: 'doi-only', doi: '10.1000/doi-only' }],
    })
    expect(output.items[0]).toMatchObject({ status: 'matched', selected: { matchMethod: 'doi' } })
  })

  it('finds DOI across multiple library pages', async () => {
    serveListing(harness, [
      ...Array.from({ length: 100 }, (_, index) =>
        doiRow(`PAGE1${String(index).padStart(3, '0')}`, `10.1000/page1_${index}`),
      ),
      doiRow('MATCHED1', '10.1000/target-multi-page'),
      ...Array.from({ length: 99 }, (_, index) =>
        doiRow(`PAGE2${String(index).padStart(3, '0')}`, `10.1000/page2_${index}`),
      ),
    ])
    const output = await harness.provider.matchReferences({
      references: [{ inputId: 'multi', doi: '10.1000/target-multi-page' }],
    })
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { ref: `zotero://user/0/item/MATCHED1?server=${SERVER_ID}`, matchMethod: 'doi' },
    })
    expect(harness.mock.requests).toHaveLength(2)
  })

  it('keeps a citekey disagreement on an exact DOI hit in conflict status', async () => {
    serveListing(harness, [
      doiRow('ABCD1234', '10.1000/exact', { citationKey: 'native', extra: 'citekey: extra' }),
    ])
    const conflict = await harness.provider.matchReferences({
      references: [{ inputId: 'entry-d', doi: '10.1000/exact' }],
    })
    expect(conflict.items[0]).toMatchObject({
      status: 'conflict',
      candidates: [{ citationKeyConflict: { native: 'native', extra: 'extra' } }],
    })
  })

  it('scans every library page before selecting an exact DOI match', async () => {
    serveListing(harness, [
      doiRow('EXACT001', '10.1000/exact'),
      ...Array.from({ length: 124 }, (_, index) =>
        doiRow(`OTHE${String(index).padStart(4, '0')}`, `10.1000/other-${index}`),
      ),
    ])
    const output = await harness.provider.matchReferences({
      references: [{ inputId: 'entry-window', doi: '10.1000/exact' }],
    })
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { ref: `zotero://user/0/item/EXACT001?server=${SERVER_ID}`, confidence: 'high' },
    })
    expect(harness.mock.requests.map((request) => request.search.get('start'))).toEqual([
      '0',
      '100',
    ])
  })

  it('falls back to a normalized title when the DOI is absent and reports field differences', async () => {
    harness.mock.route('GET', /^\/api\/users\/0\/items\/top$/, (req, res, helpers, search) => {
      const q = search.get('q')
      const rows =
        q === 'A Reference: Title!'
          ? [
              searchHit({
                data: {
                  title: 'A Reference Title',
                  creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
                },
                meta: { parsedDate: '2024-05-01' },
              }),
            ]
          : []
      helpers.json(rows, {
        'Total-Results': String(rows.length),
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '3',
      })
    })
    const output = await harness.provider.matchReferences({
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
    })
    expect(output.items[0]).toMatchObject({
      status: 'matched',
      selected: { matchMethod: 'titleFingerprint', confidence: 'high' },
      fieldDiff: { title: { input: 'A Reference: Title!', zotero: 'A Reference Title' } },
    })
  })

  it('fails the sweep when the library version moves between pages', async () => {
    serveListing(
      harness,
      [
        ...Array.from({ length: 100 }, (_, index) =>
          doiRow(`CHNG${String(index).padStart(4, '0')}`, undefined),
        ),
        doiRow('EXACT001', '10.1000/exact'),
      ],
      101,
      (start) => (start === 0 ? '3' : '4'),
    )
    await expect(
      harness.provider.matchReferences({
        references: [{ inputId: 'changing', doi: '10.1000/exact' }],
      }),
    ).rejects.toThrow('library version changed during the DOI lookup')
    expect(harness.mock.requests).toHaveLength(2)
  })

  it('marks a DOI the sweep never sees as notFound', async () => {
    serveListing(harness, [doiRow('ABCD1234', '10.1000/other')])
    const output = await harness.provider.matchReferences({
      references: [{ inputId: 'missing-doi', doi: '10.1000/absent' }],
    })
    expect(output.items[0]).toEqual({ inputId: 'missing-doi', status: 'notFound' })
  })

  it('fails loud when an in-range page of the sweep comes back empty', async () => {
    serveListing(harness, [], 5)
    await expect(
      harness.provider.matchReferences({
        references: [{ inputId: 'truncated-page', doi: '10.1000/needed' }],
      }),
    ).rejects.toThrow('empty page for DOI lookup at offset 0 but Total-Results is 5')
  })
})

describe('matchReferences: title-fallback scoring', () => {
  it('keeps equal candidates ambiguous', async () => {
    const second = hit({ ref: 'zotero://user/0/item/BBBB1234' })
    const ambiguous = await matchReferences(
      domainDeps(async () => result([hit(), second])),
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
  })

  it('marks unmatched inputs and rejects invalid or duplicate inputs', async () => {
    const empty = await matchReferences(
      domainDeps(async () => result([])),
      {
        references: [{ inputId: 'missing', title: 'No local match' }],
      },
    )
    expect(empty.items[0]).toEqual({ inputId: 'missing', status: 'notFound' })
    await expect(
      matchReferences(
        domainDeps(async () => result([])),
        { references: [] },
      ),
    ).rejects.toThrow(`1-${MATCH_REFERENCES_MAX}`)
    await expect(
      matchReferences(
        domainDeps(async () => result([])),
        {
          references: [
            { inputId: 'x', title: 'Title' },
            { inputId: 'x', title: 'Title 2' },
          ],
        },
      ),
    ).rejects.toThrow('unique')
    await expect(
      matchReferences(
        domainDeps(async () => result([])),
        { references: [{ inputId: 'x' }] },
      ),
    ).rejects.toThrow('DOI or title')
  })

  it('marks low and medium confidence matches as ambiguous', async () => {
    const low = await matchReferences(
      domainDeps(async () => result([hit({ year: 2024, authors: ['Tri Dao'] })])),
      { references: [{ inputId: 'low', title: 'A Reference Title', year: 1999 }] },
    )
    expect(low.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [{ ref: 'zotero://user/0/item/ABCD1234', confidence: 'low' }],
    })

    const medium = await matchReferences(
      domainDeps(async () => result([hit({ year: 2024, authors: ['Tri Dao'] })])),
      { references: [{ inputId: 'medium', title: 'A Reference Title' }] },
    )
    expect(medium.items[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [{ ref: 'zotero://user/0/item/ABCD1234', confidence: 'medium' }],
    })
  })

  it('marks truncated candidate searches as ambiguous with an explanatory reason', async () => {
    const output = await matchReferences(
      domainDeps(async () => ({
        scope: { kind: 'library', library: { type: 'user', id: 0 } } as const,
        items: [hit({ year: 2024, authors: ['Tri Dao'] })],
        total: 10,
        offset: 0,
        returned: 1,
        nextOffset: 1,
      })),
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

  it('limits concurrent searches to eight and preserves every input id at the domain maximum', async () => {
    const references = Array.from({ length: MATCH_REFERENCES_MAX }, (_, index) => ({
      inputId: `entry-${index}`,
      title: `Reference title ${index}`,
    }))
    const release = deferred<void>()
    const eightStarted = deferred<void>()
    let active = 0
    let maximumActive = 0
    const outputPromise = matchReferences(
      domainDeps(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (active === 8) eightStarted.resolve()
        await release.promise
        active -= 1
        return result([])
      }),
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
