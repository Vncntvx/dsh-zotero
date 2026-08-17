/**
 * The session corpus: ref normalization, per-family attribution, cross-call
 * dedup and metadata merge, the funnel gate, export artifacts, and the BibTeX
 * key helpers — pure over frozen blocks.
 * @module tests/client/corpus
 */

import { describe, expect, it } from 'vitest'
import {
  bibTexKeysOf,
  buildCorpus,
  citeCommandOf,
  normalizeRefKey,
} from '../../src/client/corpus.ts'
import { running, settled } from './helpers/blocks.ts'

const REF = 'zotero://user/0/item/ABCD1234'

/** The snapshot type is irrelevant to the corpus; a cast keeps factories honest. */
const asBlocks = (blocks: object[]): Parameters<typeof buildCorpus>[0] =>
  blocks as unknown as Parameters<typeof buildCorpus>[0]

describe('normalizeRefKey', () => {
  it('strips the query and lowercases the identity', () => {
    expect(normalizeRefKey(`${REF}?server=Cq1f76x70ESV`)).toBe('zotero://user/0/item/abcd1234')
    expect(normalizeRefKey(REF)).toBe('zotero://user/0/item/abcd1234')
  })
})

describe('buildCorpus attribution', () => {
  it('folds a search row and a get on the same item into one record', () => {
    const search = settled({
      seq: 1,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      meta: {
        returned: 1,
        total: 5,
        displayed: 1,
        omitted: 0,
        items: [
          {
            ref: REF,
            title: 'Search title',
            creatorSummary: 'Dao',
            year: 2023,
            itemType: 'conferencePaper',
          },
        ],
      },
    })
    const get = settled({
      seq: 3,
      callId: 'g',
      call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}?server=X"}` },
      meta: {
        title: 'Full title',
        creators: 'Di Pan; Chen Zhang',
        year: 2022,
        venue: 'ESPR',
        notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'note body' }],
        annotationsPreview: [],
      },
    })
    const corpus = buildCorpus(asBlocks([search, get]))
    expect(corpus.items).toHaveLength(1)
    const item = corpus.items[0]!
    // The get projection wins; the search row is the base layer.
    expect(item.title).toBe('Full title')
    expect(item.creators).toBe('Di Pan; Chen Zhang')
    expect(item.venue).toBe('ESPR')
    expect(item.year).toBe(2022)
    expect(item.itemType).toBe('conferencePaper')
    expect(item.usage).toEqual({ searched: true, read: true, cited: false })
    expect(item.calls.map((call) => call.callId)).toEqual(['s', 'g'])
    expect(item.notesPreview).toHaveLength(1)
    expect(item.ref).toBe(REF)
  })

  it('keeps first-seen metadata when a later call is poorer', () => {
    const search = settled({
      seq: 1,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{}' },
      meta: {
        items: [{ ref: REF, title: 'Rich', creatorSummary: 'A', itemType: 'report' }],
        total: 1,
      },
    })
    const get = settled({
      seq: 2,
      callId: 'g',
      call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
      meta: { title: 'Thin', creators: '', notesPreview: [], annotationsPreview: [] },
    })
    const corpus = buildCorpus(asBlocks([search, get]))
    const item = corpus.items[0]!
    expect(item.title).toBe('Thin')
    expect(item.creators).toBe('') // the get projection wins outright, even thin
    expect(item.itemType).toBe('report')
  })

  it('attaches retrieve evidence and counts passages into the funnel', () => {
    const retrieve = settled({
      seq: 1,
      callId: 'r',
      call: { name: 'zotero_retrieve', argsRaw: `{"ref":"${REF}"}` },
      meta: {
        count: 2,
        sources: ['annotation'],
        truncated: false,
        sourcesSkipped: [],
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'claim one',
            previewTruncated: false,
            pageLabel: '7',
          },
          {
            source: 'fulltext',
            sourceRef: 'zotero://user/0/item/ABCD1234',
            preview: 'claim two',
            previewTruncated: true,
          },
        ],
      },
    })
    const search = settled({
      seq: 2,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{}' },
      meta: {
        total: 3,
        returned: 3,
        displayed: 1,
        omitted: 2,
        items: [{ ref: REF, title: 'T', creatorSummary: 'C', itemType: 'report' }],
      },
    })
    const corpus = buildCorpus(asBlocks([retrieve, search]))
    const item = corpus.items[0]!
    expect(item.usage.cited).toBe(true)
    expect(item.evidence).toHaveLength(2)
    expect(item.evidence[0]!.pageLabel).toBe('7')
    // The funnel counts listed items per stage: one cited item here,
    // regardless of how many passages it contributed.
    expect(corpus.funnel).toEqual({ searched: 1, read: 0, cited: 1 })
    expect(corpus.searched).toBe(1)
    expect(corpus.searchOmitted).toBe(2)
  })

  it('resolves attachment locations from the projection', () => {
    const file = settled({
      seq: 1,
      callId: 'a',
      call: { name: 'zotero_attachment', argsRaw: `{"ref":"${REF}"}` },
      meta: { kind: 'file', title: 'a.pdf', contentType: 'application/pdf', path: '/tmp/a.pdf' },
    })
    const url = settled({
      seq: 2,
      callId: 'u',
      call: { name: 'zotero_attachment', argsRaw: '{"ref":"zotero://user/0/item/FFFF1111"}' },
      meta: { kind: 'url', title: 'link', contentType: 'text/html', url: 'https://example.com' },
    })
    const corpus = buildCorpus(asBlocks([file, url]))
    expect(corpus.items[0]!.attachment).toEqual({
      kind: 'file',
      contentType: 'application/pdf',
      title: 'a.pdf',
      location: '/tmp/a.pdf',
    })
    expect(corpus.items[1]!.attachment?.location).toBe('https://example.com')
    // A running attachment call attributes through args alone, but without a
    // resolved location the item is not a target yet and stays out of the list.
    const live = buildCorpus(
      asBlocks([running({ name: 'zotero_attachment', argsRaw: `{"ref":"${REF}"}` })]),
    )
    expect(live.items).toHaveLength(0)
  })

  it('marks export refs, keeps the artifact, and prefers the requested count', () => {
    const other = 'zotero://user/0/item/EEEE2222'
    const exportBlock = settled({
      seq: 4,
      callId: 'e',
      call: {
        name: 'zotero_export',
        argsRaw: `{"refs":["${REF}","${other}",""],"format":"bibtex"}`,
      },
      meta: { format: 'bibtex', requested: 2, style: 'apa' },
      content: [{ type: 'text', text: '@book{x1,\n  title={T}\n}\n@book{x2,\n}' }],
    })
    const search = settled({
      seq: 1,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{}' },
      meta: {
        total: 2,
        items: [
          { ref: REF, title: 'A', creatorSummary: 'B', itemType: 'report' },
          { ref: other, title: 'C', creatorSummary: 'D', itemType: 'report' },
        ],
      },
    })
    const corpus = buildCorpus(asBlocks([search, exportBlock]))
    expect(corpus.exports).toHaveLength(1)
    expect(corpus.exports[0]).toMatchObject({ callId: 'e', format: 'bibtex', style: 'apa' })
    for (const item of corpus.items) {
      expect(item.usage.cited).toBe(true)
      expect(item.exports).toHaveLength(1)
    }
    expect(corpus.funnel).toEqual({ searched: 2, read: 0, cited: 2 })
  })

  it('counts a running export into the funnel without an artifact', () => {
    const live = buildCorpus(
      asBlocks([
        running({
          name: 'zotero_export',
          argsRaw: `{"refs":["${REF}"],"format":"bibtex"}`,
          callId: 'x',
        }),
        settled({
          seq: 1,
          callId: 's',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            total: 1,
            items: [{ ref: REF, title: 'A', creatorSummary: 'B', itemType: 'report' }],
          },
        }),
      ]),
    )
    expect(live.exports).toHaveLength(0)
    expect(live.funnel).toEqual({ searched: 1, read: 0, cited: 1 })
    expect(live.items[0]!.usage.cited).toBe(true)
  })

  it('covers the degenerate attachment and export arms', () => {
    const fileNoPath = settled({
      seq: 1,
      callId: 'a1',
      call: { name: 'zotero_attachment', argsRaw: '{"ref":"zotero://user/0/item/AAAA1111"}' },
      meta: { kind: 'file', contentType: 'application/pdf' },
    })
    const urlNoUrl = settled({
      seq: 2,
      callId: 'a2',
      call: { name: 'zotero_attachment', argsRaw: '{"ref":"zotero://user/0/item/BBBB2222"}' },
      meta: { kind: 'url', contentType: 'text/html' },
    })
    const exportNoMeta = settled({
      seq: 3,
      callId: 'e1',
      call: { name: 'zotero_export', argsRaw: '{"refs":["zotero://user/0/item/CCCC3333"]}' },
      content: [{ type: 'text', text: 'plain output' }],
    })
    const corpus = buildCorpus(asBlocks([fileNoPath, urlNoUrl, exportNoMeta]))
    expect(corpus.items[0]!.attachment).toEqual({
      kind: 'file',
      contentType: 'application/pdf',
      title: '',
      location: '',
    })
    expect(corpus.items[1]!.attachment?.location).toBe('')
    // A settled export without meta still yields an artifact with a blank
    // format and no style, attributed through its refs.
    expect(corpus.exports[0]).toEqual({ callId: 'e1', format: '', text: 'plain output' })
    expect(corpus.items[2]!.usage.cited).toBe(true)
    expect(corpus.items[2]!.exports[0]!.format).toBe('')
    // A running export without a refs array contributes zero to the funnel.
    const live = buildCorpus(
      asBlocks([running({ name: 'zotero_export', argsRaw: '{"format":"bibtex"}', callId: 'x' })]),
    )
    expect(live.funnel).toBeNull()
    expect(live.exports).toHaveLength(0)
    // A running retrieve with no meta counts one passage and attaches none
    // (a search block co-present so the two-stage gate exposes the funnel);
    // an attachment with unparseable args stays unattributed, and one whose
    // meta carries no contentType leaves the item bare.
    const liveRetrieve = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            total: 1,
            items: [{ ref: REF, title: 'A', creatorSummary: 'B', itemType: 'report' }],
          },
        }),
        running({ name: 'zotero_retrieve', argsRaw: `{"ref":"${REF}"}`, callId: 'rr' }),
      ]),
    )
    expect(liveRetrieve.funnel).toEqual({ searched: 1, read: 0, cited: 1 })
    expect(liveRetrieve.items[0]!.evidence).toHaveLength(0)
    const attachmentDegenerate = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 'bad',
          call: { name: 'zotero_attachment', argsRaw: '{not json' },
        }),
        settled({
          seq: 2,
          callId: 'bare',
          call: { name: 'zotero_attachment', argsRaw: `{"ref":"${REF}"}` },
          meta: { kind: 'file', title: 't' },
        }),
      ]),
    )
    expect(attachmentDegenerate.unattributed).toBe(1)
    // A bare attachment (no contentType) never resolves a location, so the
    // item is not a target; with no search either, the list stays empty.
    expect(attachmentDegenerate.items).toHaveLength(0)
    // A search without a total counts its rows; a row without a year leaves
    // the item's year unset; a retrieve with unparseable args is unattributed.
    const loose = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's2',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            items: [{ ref: 'plain-ref-1', title: 'T', creatorSummary: 'C', itemType: 'report' }],
          },
        }),
        settled({
          seq: 2,
          callId: 'rr2',
          call: { name: 'zotero_retrieve', argsRaw: '{oops' },
          content: [],
        }),
      ]),
    )
    // A single-stage session still counts in the funnel (the tab renders
    // only non-zero chips); the row-count fallback for the missing total is
    // exercised on the way.
    expect(loose.funnel).toEqual({ searched: 1, read: 0, cited: 0 })
    expect(loose.unattributed).toBe(1)
    expect(loose.items[0]!.year).toBeUndefined()
    // A malformed search projection attributes nothing; a get projection
    // without title/creators leaves the search-row values standing.
    const partial = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 'm',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: { items: 'not-an-array' },
        }),
        settled({
          seq: 2,
          callId: 'p',
          call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
          meta: { year: 1999, notesPreview: [], annotationsPreview: [] },
        }),
      ]),
    )
    expect(partial.items).toHaveLength(1)
    expect(partial.items[0]!.year).toBe(1999)
    expect(partial.items[0]!.title).toBeUndefined()
  })

  it('degrades unparseable calls to unattributed and never throws', () => {
    const broken = settled({
      seq: 1,
      callId: 'b',
      call: { name: 'zotero_get', argsRaw: '{not json' },
    })
    const noRef = settled({
      seq: 2,
      callId: 'n',
      call: { name: 'zotero_retrieve', argsRaw: '{"query":"x"}' },
    })
    const corpus = buildCorpus(asBlocks([broken, noRef]))
    expect(corpus.items).toHaveLength(0)
    expect(corpus.unattributed).toBe(2)
    expect(corpus.funnel).toBeNull()
  })

  it('counts a single-stage session in the funnel (zero stages stay unrendered)', () => {
    const searchOnly = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            returned: 2,
            total: 9,
            items: [{ ref: REF, title: 'A', creatorSummary: 'B', itemType: 'report' }],
          },
        }),
      ]),
    )
    expect(searchOnly.funnel).toEqual({ searched: 1, read: 0, cited: 0 })
    expect(searchOnly.items).toHaveLength(1)
    // The caption count follows the distinct hits the list can show, not the
    // library-wide total.
    expect(searchOnly.searched).toBe(1)
    expect(searchOnly.searchOmitted).toBe(0)
  })

  it('counts distinct rows once within the final logical search', () => {
    const other = 'zotero://user/0/item/BBBB0002'
    const row = (ref: string, title: string) => ({
      ref,
      title,
      creatorSummary: 'C',
      itemType: 'report',
    })
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
          meta: {
            returned: 2,
            displayed: 2,
            omitted: 0,
            items: [row(other, 'B'), row('zotero://user/0/item/FFFF0006', 'F')],
          },
        }),
        settled({
          seq: 2,
          callId: 's2',
          call: { name: 'zotero_search', argsRaw: '{"query":"carbon"}' },
          meta: {
            returned: 2,
            displayed: 2,
            omitted: 0,
            items: [row(REF, 'A'), row('zotero://user/0/item/CCCC0003', 'E')],
          },
        }),
        settled({
          seq: 3,
          callId: 's3',
          call: { name: 'zotero_search', argsRaw: '{"query":"carbon","offset":20}' },
          meta: {
            returned: 2,
            displayed: 2,
            omitted: 0,
            items: [row(REF, 'A'), row('zotero://user/0/item/DDDD0004', 'G')],
          },
        }),
      ]),
    )
    // The first topic's hits are dropped; the paginated "carbon" calls fold
    // into one final found set, with the re-hit item counted once.
    expect(corpus.searched).toBe(3)
    expect(corpus.items.map((item) => item.key)).toEqual([
      normalizeRefKey(REF),
      normalizeRefKey('zotero://user/0/item/CCCC0003'),
      normalizeRefKey('zotero://user/0/item/DDDD0004'),
    ])
    expect(corpus.searchOmitted).toBe(0)
    expect(corpus.funnel).toEqual({ searched: 3, read: 0, cited: 0 })
  })

  it('folds pagination into one found set and honors identity fields', () => {
    const row = (ref: string) => ({ ref, title: 'T', creatorSummary: 'C', itemType: 'report' })
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: {
            name: 'zotero_search',
            argsRaw:
              '{"query":"x","mode":"everything","scope":{"kind":"collection","refOrName":"C"},"itemTypes":["b","a"],"tags":["t2","t1"],"sort":"year","direction":"asc","limit":20}',
          },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(REF)] },
        }),
        settled({
          seq: 2,
          callId: 's2',
          call: { name: 'zotero_search', argsRaw: '{not json' },
          meta: {
            returned: 1,
            displayed: 1,
            omitted: 0,
            items: [row('zotero://user/0/item/CCCC0003')],
          },
        }),
      ]),
    )
    // The fully-specified call exercises every identity field; the broken-args
    // call starts a fresh identity-less group that becomes the found set.
    expect(corpus.searched).toBe(1)
    expect(corpus.items.map((item) => item.key)).toEqual([
      normalizeRefKey('zotero://user/0/item/CCCC0003'),
    ])
    expect(corpus.searchOmitted).toBe(0)
    expect(corpus.funnel).toEqual({ searched: 1, read: 0, cited: 0 })
  })

  it('folds pagination whose scope objects differ only in key order', () => {
    const row = (ref: string) => ({ ref, title: 'T', creatorSummary: 'C', itemType: 'report' })
    const other = 'zotero://user/0/item/BBBB0002'
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 'p1',
          call: {
            name: 'zotero_search',
            argsRaw: '{"query":"x","scope":{"refOrName":"C","kind":"collection"},"offset":0}',
          },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(REF)] },
        }),
        settled({
          seq: 2,
          callId: 'p2',
          call: {
            name: 'zotero_search',
            argsRaw: '{"query":"x","scope":{"kind":"collection","refOrName":"C"},"offset":20}',
          },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(other)] },
        }),
      ]),
    )
    // Key order in the scope object must not split one logical search: both
    // pages fold into the same group and both rows survive in the found set.
    expect(corpus.searched).toBe(2)
    expect(corpus.items.map((item) => item.key)).toEqual([
      normalizeRefKey(REF),
      normalizeRefKey(other),
    ])
  })

  it('tolerates a malformed scope argument without crashing the build', () => {
    const row = (ref: string) => ({ ref, title: 'T', creatorSummary: 'C', itemType: 'report' })
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: { name: 'zotero_search', argsRaw: '{"query":"x","scope":"library"}' },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(REF)] },
        }),
      ]),
    )
    expect(corpus.searched).toBe(1)
  })

  it('lists only the worked-on items once targets exist', () => {
    const other = 'zotero://user/0/item/BBBB0002'
    const row = (ref: string, title: string) => ({
      ref,
      title,
      creatorSummary: 'C',
      itemType: 'report',
    })
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            returned: 2,
            displayed: 2,
            omitted: 0,
            items: [row(REF, 'A'), row(other, 'B')],
          },
        }),
        settled({
          seq: 2,
          callId: 'g',
          call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
          meta: { title: 'A', creators: '', notesPreview: [], annotationsPreview: [] },
        }),
      ]),
    )
    // The read hit becomes the list; the searched-only hit drops away.
    expect(corpus.items.map((item) => item.key)).toEqual([normalizeRefKey(REF)])
    // The session literature stays the union — quick access never shrinks.
    expect(corpus.literature.map((item) => item.key)).toEqual([
      normalizeRefKey(REF),
      normalizeRefKey(other),
    ])
    expect(corpus.funnel).toEqual({ searched: 1, read: 1, cited: 0 })
  })

  it('ignores note items in the target rule', () => {
    const note = 'zotero://user/0/item/NOTE0001'
    const row = (ref: string, title: string, itemType = 'report') => ({
      ref,
      title,
      creatorSummary: 'C',
      itemType,
    })
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: { name: 'zotero_search', argsRaw: '{"query":"notes"}' },
          meta: {
            returned: 1,
            displayed: 1,
            omitted: 0,
            items: [row(note, 'A note', 'note')],
          },
        }),
        settled({
          seq: 2,
          callId: 'r',
          call: { name: 'zotero_retrieve', argsRaw: `{"ref":"${note}"}` },
          meta: {
            count: 1,
            sources: ['annotation'],
            truncated: false,
            sourcesSkipped: [],
            items: [
              {
                source: 'annotation',
                sourceRef: 'zotero://user/0/annotation/ANN1',
                preview: 'claim',
                previewTruncated: false,
                pageLabel: '7',
              },
            ],
          },
        }),
        settled({
          seq: 3,
          callId: 's2',
          call: { name: 'zotero_search', argsRaw: '{"query":"carbon"}' },
          meta: {
            returned: 1,
            displayed: 1,
            omitted: 0,
            items: [row(REF, 'A')],
          },
        }),
      ]),
    )
    // The agent's incidental retrieve on a note (typed by an earlier search)
    // never shrinks the list: no paper target exists, so the final search's
    // found set stays and the note is not listed.
    expect(corpus.items.map((item) => item.key)).toEqual([normalizeRefKey(REF)])
    expect(corpus.funnel).toEqual({ searched: 1, read: 0, cited: 0 })
  })

  it('keeps a note read directly by get out of the target rule', () => {
    const paper = 'zotero://user/0/item/PAPER0001'
    const note = 'zotero://user/0/item/NOTE0001'
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: { name: 'zotero_search', argsRaw: '{}' },
          meta: {
            returned: 1,
            displayed: 1,
            omitted: 0,
            items: [
              { ref: paper, title: 'A paper', creatorSummary: 'C', itemType: 'journalArticle' },
            ],
          },
        }),
        settled({
          seq: 2,
          callId: 'g',
          call: { name: 'zotero_get', argsRaw: `{"ref":"${note}"}` },
          // The get projection carries the item type, so a note reached
          // without a search row still honors the notes-excluded rule.
          meta: {
            title: 'A note',
            creators: '',
            itemType: 'note',
            notesPreview: [],
            annotationsPreview: [],
          },
        }),
      ]),
    )
    expect(corpus.items.map((item) => item.key)).toEqual([normalizeRefKey(paper)])
    expect(corpus.funnel).toEqual({ searched: 1, read: 0, cited: 0 })
  })

  it('orders items by first touch', () => {
    const second = 'zotero://user/0/item/BBBB0002'
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 5,
          callId: 'g2',
          call: { name: 'zotero_get', argsRaw: `{"ref":"${second}"}` },
          meta: { title: 'Later', creators: '', notesPreview: [], annotationsPreview: [] },
        }),
        settled({
          seq: 1,
          callId: 'g1',
          call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
          meta: { title: 'First', creators: '', notesPreview: [], annotationsPreview: [] },
        }),
      ]),
    )
    expect(corpus.items.map((item) => item.key)).toEqual([
      normalizeRefKey(REF),
      normalizeRefKey(second),
    ])
  })

  it('does not fold tag lists that differ only in element boundaries', () => {
    const row = (ref: string) => ({ ref, title: 'T', creatorSummary: 'C', itemType: 'report' })
    const a = 'zotero://user/0/item/AAAA0001'
    const b = 'zotero://user/0/item/BBBB0001'
    const corpus = buildCorpus(
      asBlocks([
        settled({
          seq: 1,
          callId: 's1',
          call: { name: 'zotero_search', argsRaw: '{"query":"x","tags":["a","b"]}' },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(a)] },
        }),
        settled({
          seq: 2,
          callId: 's2',
          call: { name: 'zotero_search', argsRaw: '{"query":"x","tags":["a|b"]}' },
          meta: { returned: 1, displayed: 1, omitted: 0, items: [row(b)] },
        }),
      ]),
    )
    // A single pipe is a legal tag character, so `['a|b']` is a different tag
    // set than `['a', 'b']`; the identity encoding must not collapse them.
    expect(corpus.searched).toBe(1)
    expect(corpus.items.map((item) => item.key)).toEqual([normalizeRefKey(b)])
  })

  it('splits the search group when an identity field differs', () => {
    const row = (ref: string) => ({ ref, title: 'T', creatorSummary: 'C', itemType: 'report' })
    const first = 'zotero://user/0/item/AAAA0001'
    const second = 'zotero://user/0/item/BBBB0002'
    // Each pair differs in exactly one identity field; a differing field must
    // start a fresh group whose rows become the found set. Dropping any of
    // these fields from the identity would fold the pair and keep both rows.
    const pairs: [string, string][] = [
      ['{"query":"x","mode":"metadata"}', '{"query":"x","mode":"everything"}'],
      ['{"query":"x","sort":"dateModified"}', '{"query":"x","sort":"title"}'],
      ['{"query":"x","direction":"desc"}', '{"query":"x","direction":"asc"}'],
      ['{"query":"x","limit":10}', '{"query":"x","limit":20}'],
      ['{"query":"x","itemTypes":["note"]}', '{"query":"x","itemTypes":["journalArticle"]}'],
    ]
    for (const [argsA, argsB] of pairs) {
      const corpus = buildCorpus(
        asBlocks([
          settled({
            seq: 1,
            callId: 'a',
            call: { name: 'zotero_search', argsRaw: argsA },
            meta: { returned: 1, displayed: 1, omitted: 0, items: [row(first)] },
          }),
          settled({
            seq: 2,
            callId: 'b',
            call: { name: 'zotero_search', argsRaw: argsB },
            meta: { returned: 1, displayed: 1, omitted: 0, items: [row(second)] },
          }),
        ]),
      )
      expect(corpus.searched, `${argsA} vs ${argsB}`).toBe(1)
      expect(corpus.items.map((item) => item.key)).toEqual([normalizeRefKey(second)])
    }
  })
})

describe('lens and citation helpers', () => {
  it('extracts unique BibTeX keys in first-seen order', () => {
    const text =
      '@article{pan2022carbon,\n title={A}\n}\n@book{dao2023,\n}\n@article{pan2022carbon,\n}'
    expect(bibTexKeysOf(text)).toEqual(['pan2022carbon', 'dao2023'])
    expect(bibTexKeysOf('no entries here')).toEqual([])
  })

  it('joins keys into a cite command', () => {
    expect(citeCommandOf(['a', 'b'])).toBe('\\cite{a, b}')
    expect(citeCommandOf([])).toBe('')
  })
})
