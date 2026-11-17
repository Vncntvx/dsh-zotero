/**
 * Identity gates for cross-source fusion.
 *
 * Two indexes describing one work must merge; two different works that happen
 * to share a title, a research object, or most of a title must not. These are
 * the counterexamples the old title-similarity rule failed.
 *
 * @module tests/scholarly/fusion-identity
 */

import { describe, expect, it } from 'vitest'
import { formatPaperDetail, formatPaperItem, fuseRankedLists } from '../../src/scholarly/fusion.js'
import type { PaperVersion, ScholarlyPaper } from '../../src/scholarly/types.js'

/** Build one source record with only the fields the case needs. */
function paper(over: Partial<ScholarlyPaper> & { title: string }): ScholarlyPaper {
  return { authors: [], sources: [], ...over }
}

describe('scholarly fusion identity gates', () => {
  it('keeps works that differ only in the studied population apart', () => {
    const clinical = paper({
      title: 'Retrieval Augmented Generation for Clinical Question Answering',
      authors: ['Alice Example'],
      year: 2020,
      doi: '10.1000/synthetic-a',
      abstract: 'Clinical-only abstract.',
      sources: ['OpenAlex'],
    })
    const legal = paper({
      title: 'Retrieval Augmented Generation for Legal Question Answering',
      authors: ['Bob Example'],
      year: 2025,
      doi: '10.1000/synthetic-b',
      abstract: 'A much longer legal abstract that must not overwrite the clinical record.',
      retracted: true,
      sources: ['Crossref'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'openalex', papers: [clinical] },
      { sourceId: 'crossref', papers: [legal] },
    ])

    expect(fused).toHaveLength(2)
    const clinicalResult = fused.find((entry) => entry.doi === '10.1000/synthetic-a')
    const legalResult = fused.find((entry) => entry.doi === '10.1000/synthetic-b')
    expect(clinicalResult?.title).toBe(clinical.title)
    expect(clinicalResult?.authors).toEqual(['Alice Example'])
    expect(clinicalResult?.abstract).toBe('Clinical-only abstract.')
    expect(clinicalResult?.retracted).toBeUndefined()
    expect(legalResult?.title).toBe(legal.title)
    expect(legalResult?.retracted).toBe(true)
  })

  it('keeps same-title records with different first authors apart', () => {
    const first = paper({
      title: 'Shared Title About Neural Retrieval',
      authors: ['Alice Example'],
      year: 2021,
      sources: ['OpenAlex'],
    })
    const second = paper({
      title: 'Shared Title About Neural Retrieval',
      authors: ['Bob Example'],
      year: 2021,
      sources: ['Crossref'],
    })

    expect(
      fuseRankedLists([
        { sourceId: 'openalex', papers: [first] },
        { sourceId: 'crossref', papers: [second] },
      ]),
    ).toHaveLength(2)
  })

  it('keeps same-title records with years further apart than the version window', () => {
    const first = paper({
      title: 'Shared Title About Neural Retrieval',
      authors: ['Alice Example'],
      year: 2020,
      sources: ['OpenAlex'],
    })
    const second = paper({
      title: 'Shared Title About Neural Retrieval',
      authors: ['Alice Example'],
      year: 2025,
      sources: ['Crossref'],
    })

    expect(
      fuseRankedLists([
        { sourceId: 'openalex', papers: [first] },
        { sourceId: 'crossref', papers: [second] },
      ]),
    ).toHaveLength(2)
  })

  it('keeps an erratum apart from the original even when title, authors, and year match', () => {
    const original = paper({
      title: 'A Study of Widget Calibration',
      authors: ['Alice Example'],
      year: 2020,
      doi: '10.1000/original',
      sources: ['Crossref'],
    })
    const erratum = paper({
      title: 'A Study of Widget Calibration',
      authors: ['Alice Example'],
      year: 2020,
      doi: '10.1000/erratum',
      sources: ['Crossref'],
    })

    expect(
      fuseRankedLists([
        { sourceId: 'crossref', papers: [original] },
        { sourceId: 'openalex', papers: [erratum] },
      ]),
    ).toHaveLength(2)
  })

  it('merges a preprint with its published version and keeps both metadata sets', () => {
    const preprint = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2017,
      arxiv: '1706.03762',
      abstract: 'Preprint abstract.',
      sources: ['arXiv'],
    })
    const published = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['A. Vaswani', 'N. Shazeer'],
      year: 2018,
      doi: '10.5555/neurips.2017.1',
      venue: 'NeurIPS',
      abstract: 'Longer published abstract with venue details.',
      sources: ['OpenAlex'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'arxiv', papers: [preprint] },
      { sourceId: 'openalex', papers: [published] },
    ])

    expect(fused).toHaveLength(1)
    expect(fused[0]).toMatchObject({
      title: published.title,
      doi: published.doi,
      year: 2018,
      venue: 'NeurIPS',
      abstract: published.abstract,
      arxiv: '1706.03762',
      sources: ['OpenAlex', 'arXiv'],
    })
    expect(fused[0].versions).toEqual([
      expect.objectContaining({
        kind: 'preprint',
        title: preprint.title,
        year: 2017,
        arxiv: '1706.03762',
        abstract: 'Preprint abstract.',
        sources: ['arXiv'],
      }),
    ])
  })

  it('does not propagate a retraction across a version relationship', () => {
    const preprint = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2017,
      arxiv: '1706.03762',
      retracted: true,
      sources: ['arXiv'],
    })
    const published = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2018,
      doi: '10.5555/neurips.2017.1',
      sources: ['OpenAlex'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'arxiv', papers: [preprint] },
      { sourceId: 'openalex', papers: [published] },
    ])

    expect(fused).toHaveLength(1)
    expect(fused[0].retracted).toBeUndefined()
    expect(fused[0].versions?.[0]?.retracted).toBe(true)
    expect(formatPaperItem(fused[0], 1)).toContain('retracted version: arXiv:1706.03762')
  })

  it('merges records sharing a PMID but carrying different published DOIs as versions', () => {
    const first = paper({
      title: 'Shared PMID Study',
      authors: ['Ada Lovelace'],
      year: 2020,
      doi: '10.1000/first',
      pmid: '12345678',
      sources: ['PubMed'],
    })
    const second = paper({
      title: 'Shared PMID Study',
      authors: ['Ada Lovelace'],
      year: 2020,
      doi: '10.1000/second',
      pmid: '12345678',
      retracted: true,
      sources: ['OpenAlex'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'pubmed', papers: [first] },
      { sourceId: 'openalex', papers: [second] },
    ])

    expect(fused).toHaveLength(1)
    expect(fused[0].doi).toBe('10.1000/first')
    expect(fused[0].retracted).toBeUndefined()
    expect(fused[0].versions).toEqual([
      expect.objectContaining({ doi: '10.1000/second', retracted: true }),
    ])
  })

  it('promotes a published record that shares only the arXiv identity', () => {
    const preprint = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2017,
      arxiv: '2301.07041',
      abstract: 'Preprint abstract.',
      sources: ['arXiv'],
    })
    const published = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2018,
      arxiv: '2301.07041',
      doi: '10.1000/published',
      abstract: 'Published abstract.',
      sources: ['OpenAlex'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'arxiv', papers: [preprint] },
      { sourceId: 'openalex', papers: [published] },
    ])

    expect(fused).toHaveLength(1)
    expect(fused[0]).toMatchObject({ doi: '10.1000/published', year: 2018 })
    expect(fused[0].versions?.[0]).toMatchObject({ kind: 'preprint', year: 2017 })
  })

  it('merges two views of one preprint as the same record', () => {
    const first = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2017,
      arxiv: '2301.07041',
      abstract: 'Short abstract.',
      sources: ['arXiv'],
    })
    const second = paper({
      title: 'Neural Retrieval for Clinical Evidence',
      authors: ['Ashish Vaswani'],
      year: 2017,
      arxiv: '2301.07041',
      abstract: 'A much longer abstract from another index.',
      sources: ['OpenAlex'],
    })

    const fused = fuseRankedLists([
      { sourceId: 'arxiv', papers: [first] },
      { sourceId: 'openalex', papers: [second] },
    ])

    expect(fused).toHaveLength(1)
    expect(fused[0].abstract).toBe(second.abstract)
    expect(fused[0].versions).toBeUndefined()
  })

  it('renders sparse version metadata without inventing fields', () => {
    const versions: PaperVersion[] = [
      { kind: 'other', title: 'No Identifiers At All', authors: [], sources: ['DBLP'] },
      {
        kind: 'preprint',
        title: 'Arxiv Only',
        authors: [],
        arxiv: '2301.07041',
        retracted: true,
        sources: ['arXiv'],
      },
    ]
    const detail = formatPaperDetail(paper({ title: 'Primary', versions }))
    expect(detail).toContain('versions:')
    expect(detail).toContain('No Identifiers At All')
    expect(detail).toContain('arXiv: 2301.07041')
    expect(detail).toContain('RETRACTED')
  })

  it('does not merge an identifier-less short title', () => {
    const first = paper({ title: 'Deep Learning', authors: ['Alice Example'], year: 2020 })
    const second = paper({ title: 'Deep Learning', authors: ['Alice Example'], year: 2020 })

    expect(
      fuseRankedLists([
        { sourceId: 'openalex', papers: [first] },
        { sourceId: 'crossref', papers: [second] },
      ]),
    ).toHaveLength(2)
  })

  it('does not merge a title that is only a subset of the other', () => {
    // The old containment rule merged this pair at 4/5 = 0.8. Equal token sets
    // are required now, so the extra word keeps them apart.
    const shorter = paper({
      title: 'Deep Learning for Image Recognition',
      authors: ['Alice Example'],
      year: 2020,
      sources: ['OpenAlex'],
    })
    const longer = paper({
      title: 'Deep Learning for Image Recognition Tasks',
      authors: ['Alice Example'],
      year: 2020,
      sources: ['Crossref'],
    })

    expect(
      fuseRankedLists([
        { sourceId: 'openalex', papers: [shorter] },
        { sourceId: 'crossref', papers: [longer] },
      ]),
    ).toHaveLength(2)
  })
})
