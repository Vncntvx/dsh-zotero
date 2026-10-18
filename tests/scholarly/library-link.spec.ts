/**
 * `attachLibraryStatus`: what the local-library annotation must and must not
 * claim.
 *
 * Three facts have to stay distinguishable: the paper is held, the paper is
 * not held, and the lookup could not run. A layer that reports the third as the
 * second tells the model a paper is absent from a library it never read.
 *
 * @module tests/scholarly/library-link
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroSearchResult } from '../../src/types.js'
import { attachLibraryStatus, type ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'
import type { ScholarlyPaper } from '../../src/scholarly/types.js'

/** A hit with just enough fields to be annotated. @param over - overrides. */
function paperOf(over: Partial<ScholarlyPaper> = {}): ScholarlyPaper {
  return { title: 'Attention Is All You Need', authors: [], sources: [], ...over }
}

/**
 * A library service returning fixed compact records.
 * @param items - the records `search` returns.
 * @returns the service.
 */
function libraryOf(items: ZoteroSearchResult['items']): ZoteroServiceLike {
  return {
    search: async () => ({
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      items,
      total: items.length,
      returned: items.length,
      offset: 0,
    }),
  }
}

/** One compact record the service can return. @param over - overrides. */
function recordOf(over: Record<string, unknown> = {}) {
  return {
    ref: 'zotero://user/0/item/ITEM1234',
    title: 'Attention Is All You Need',
    creatorSummary: 'Vaswani et al.',
    itemType: 'journalArticle',
    ...over,
  } as ZoteroSearchResult['items'][number]
}

describe('attachLibraryStatus', () => {
  it('annotates a match by title and reports it', async () => {
    const papers = [paperOf()]
    const report = await attachLibraryStatus(papers, libraryOf([recordOf()]))
    expect(papers[0]?.inLibrary?.itemKey).toBe('ITEM1234')
    expect(report.matched).toBe(1)
    expect(report.failed).toBe(0)
  })

  it('matches on a DOI carried in the extra field', async () => {
    const papers = [paperOf({ title: 'A Different Title Entirely', doi: '10.1234/xyz.1' })]
    const report = await attachLibraryStatus(
      papers,
      libraryOf([recordOf({ title: 'Unrelated', extra: 'DOI: 10.1234/xyz.1' })]),
    )
    expect(report.matched).toBe(1)
  })

  it('does not match on a title shorter than the identity threshold', async () => {
    // A two-word title matches too many works to assert identity.
    const papers = [paperOf({ title: 'Short' })]
    const report = await attachLibraryStatus(papers, libraryOf([recordOf({ title: 'Short' })]))
    expect(report.matched).toBe(0)
    expect(papers[0]?.inLibrary).toBeUndefined()
  })

  it('skips a record whose ref is outside the grammar', async () => {
    const papers = [paperOf()]
    const report = await attachLibraryStatus(
      papers,
      libraryOf([recordOf({ ref: 'zotero://user/0/items/ITEM1234' })]),
    )
    expect(report.unparseable).toBe(1)
    expect(papers[0]?.inLibrary).toBeUndefined()
  })

  it('counts a failed lookup instead of reporting absence', async () => {
    const papers = [paperOf()]
    const report = await attachLibraryStatus(papers, {
      search: async () => {
        throw new Error('local API unreachable')
      },
    })
    expect(report.failed).toBe(1)
    expect(report.matched).toBe(0)
    expect(papers[0]?.inLibrary).toBeUndefined()
  })

  it('reads the detail of a matched record to collect its collections', async () => {
    // The detail read confirms and enriches a compact match; it is not a second
    // discovery path, so the compact record already has to match.
    const papers = [paperOf()]
    const report = await attachLibraryStatus(papers, {
      ...libraryOf([recordOf()]),
      get: async () => ({
        ref: 'zotero://user/0/item/ITEM1234',
        itemType: 'journalArticle',
        title: 'Attention Is All You Need',
        creators: [],
        tags: [],
        collections: [{ ref: 'zotero://user/0/collection/C1', name: 'ML' }],
        children: { total: 0 },
        abstractTruncated: false,
      }),
    })
    expect(report.matched).toBe(1)
    expect(papers[0]?.inLibrary?.collections).toEqual(['ML'])
  })

  it('keeps the compact match when the detail read fails', async () => {
    const papers = [paperOf()]
    const report = await attachLibraryStatus(papers, {
      ...libraryOf([recordOf()]),
      get: async () => {
        throw new Error('detail unavailable')
      },
    })
    expect(report.matched).toBe(1)
    // The collection list stays empty rather than being invented.
    expect(papers[0]?.inLibrary?.collections).toEqual([])
  })

  it('reports nothing to do when no library service is composed', async () => {
    const report = await attachLibraryStatus([paperOf()], undefined)
    expect(report).toEqual({ matched: 0, failed: 0, unparseable: 0 })
  })

  it('keeps a group-library identity when the record names one', async () => {
    const papers = [paperOf()]
    const report = await attachLibraryStatus(
      papers,
      libraryOf([recordOf({ ref: 'zotero://group/42/item/GRP12345' })]),
    )
    expect(report.matched).toBe(1)
    expect(papers[0]?.inLibrary?.libraryId).toBe('42')
  })
})

describe('attachLibraryStatus detail enrichment corners', () => {
  it('matches through the detail DOI when the compact record differs', async () => {
    const papers = [paperOf({ title: 'A Title Long Enough To Compare', doi: '10.1234/detail.1' })]
    const report = await attachLibraryStatus(papers, {
      search: async () => ({
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [
          recordOf({ title: 'A Title Long Enough To Compare', extra: 'DOI: 10.1234/detail.1' }),
        ],
        total: 1,
        returned: 1,
        offset: 0,
      }),
      get: async () => ({
        ref: 'zotero://user/0/item/ITEM1234',
        itemType: 'journalArticle',
        title: 'Unrelated Detail Title',
        creators: [],
        tags: [],
        collections: [],
        children: { total: 0 },
        abstractTruncated: false,
      }),
    })
    expect(report.matched).toBe(1)
  })

  it('leaves a non-matching record unannotated when the detail also differs', async () => {
    const papers = [paperOf({ title: 'Nothing In Common Here At All' })]
    const report = await attachLibraryStatus(papers, {
      search: async () => ({
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [recordOf({ title: 'A Completely Different Work' })],
        total: 1,
        returned: 1,
        offset: 0,
      }),
      get: async () => ({
        ref: 'zotero://user/0/item/ITEM1234',
        itemType: 'journalArticle',
        title: 'Also Different',
        creators: [],
        tags: [],
        collections: [],
        children: { total: 0 },
        abstractTruncated: false,
      }),
    })
    expect(report.matched).toBe(0)
    expect(papers[0]?.inLibrary).toBeUndefined()
  })
})
