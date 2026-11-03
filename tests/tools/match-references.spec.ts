import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { searchHit } from '../helpers/server/objects.js'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane()
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_match_references', () => {
  it('matches DOI against the local metadata listing and returns its stable ref and citekey', async () => {
    lane.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      const query = search.get('q')
      const unfiltered = query === null || query === ''
      const doiProbe = query === '10.1000/example'
      helpers.json(
        doiProbe || unfiltered
          ? [
              searchHit({
                data: {
                  itemType: 'journalArticle',
                  title: 'A Paper',
                  DOI: '10.1000/example',
                  citationKey: 'doe2024',
                  creators: [{ creatorType: 'author', firstName: 'Jane', lastName: 'Doe' }],
                },
              }),
            ]
          : [],
        { 'Total-Results': doiProbe || unfiltered ? '1' : '0' },
      )
    })
    const result = expectValue(
      await lane.runTool('zotero_match_references', {
        references: [
          {
            inputId: 'ref-1',
            bibKey: 'doe2024',
            doi: '10.1000/example',
            title: 'A Paper',
            authors: ['Jane Doe'],
            year: 2024,
          },
        ],
      }),
      'zotero_match_references',
    )
    expect((result.value as { items: unknown[] }).items).toMatchObject([
      {
        inputId: 'ref-1',
        status: 'matched',
        selected: {
          ref: 'zotero://user/0/item/ABCD1234',
          citationKey: 'doe2024',
          citationKeySource: 'native',
          matchMethod: 'doi',
          confidence: 'high',
        },
      },
    ])
    expect(lane.mock.requests).toHaveLength(1)
    expect(lane.mock.requests[0]!.search.get('q')).toBeNull()
  })

  it('returns competing title candidates as ambiguous for explicit review', async () => {
    lane.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json(
        [
          searchHit({
            key: 'ABCD1234',
            data: {
              itemType: 'journalArticle',
              title: 'A Paper',
              creators: [{ creatorType: 'author', firstName: 'Jane', lastName: 'Doe' }],
            },
          }),
          searchHit({
            key: 'BBBB2222',
            data: {
              itemType: 'journalArticle',
              title: 'A Paper',
              creators: [{ creatorType: 'author', firstName: 'Jane', lastName: 'Doe' }],
            },
          }),
        ],
        { 'Total-Results': '2' },
      ),
    )
    const result = expectValue(
      await lane.runTool('zotero_match_references', {
        references: [{ inputId: 'ambiguous', title: 'A Paper', authors: ['Jane Doe'], year: 2024 }],
      }),
      'zotero_match_references',
    )
    expect((result.value as { items: unknown[] }).items).toMatchObject([
      {
        status: 'ambiguous',
        candidates: [
          { ref: 'zotero://user/0/item/ABCD1234' },
          { ref: 'zotero://user/0/item/BBBB2222' },
        ],
      },
    ])
  })
})
