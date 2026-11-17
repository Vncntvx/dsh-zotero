/**
 * Identity, author compatibility, and version-record mechanics.
 *
 * The fusion contract rests on these helpers: strong identifiers decide
 * identity, the title gate needs corroboration, and a version merge preserves
 * the primary record's own text instead of overwriting it.
 *
 * @module tests/scholarly/normalize-identity
 */

import { describe, expect, it } from 'vitest'
import {
  addVersionRecord,
  firstAuthorCompatible,
  identityOf,
  identityRelationOf,
  mergePaperInto,
  titleVersionMatch,
} from '../../src/scholarly/normalize.js'
import type { PaperVersion, ScholarlyPaper } from '../../src/scholarly/types.js'

/** Build one record with only the fields the case needs. */
function paper(over: Partial<ScholarlyPaper> & { title: string }): ScholarlyPaper {
  return { authors: [], sources: [], ...over }
}

function version(over: Partial<PaperVersion>): PaperVersion {
  return { kind: 'other', title: 'T', authors: [], sources: [], ...over }
}

describe('paper identity', () => {
  it('treats an arXiv DOI as a preprint identity, not a published DOI', () => {
    const identity = identityOf({ doi: '10.48550/arXiv.2301.07041', arxiv: '2301.07041' })
    expect(identity.publishedDois).toEqual(new Set())
    expect(identity.arxivIds).toEqual(new Set(['2301.07041']))
  })

  it('normalizes PMIDs and PMCIDs for comparison', () => {
    const identity = identityOf({ pmid: ' 12345 ', pmcid: ' PMC1234 ' })
    expect(identity.pmids).toEqual(new Set(['12345']))
    expect(identity.pmcids).toEqual(new Set(['pmc1234']))
  })

  it('classifies shared, version, and distinct relationships', () => {
    const base = { title: 'T' }
    expect(
      identityRelationOf({ ...base, doi: '10.1000/a' }, { ...base, doi: '10.1000/A' }),
    ).toEqual({ relation: 'same', conflicting: false })

    expect(
      identityRelationOf({ ...base, doi: '10.1000/a' }, { ...base, doi: '10.1000/b' }),
    ).toEqual({ relation: 'distinct', conflicting: true })

    expect(
      identityRelationOf(
        { ...base, doi: '10.1000/a', pmid: '123' },
        { ...base, doi: '10.1000/b', pmid: '123' },
      ),
    ).toEqual({ relation: 'version', conflicting: true })

    expect(
      identityRelationOf({ ...base, arxiv: '2301.07041' }, { ...base, arxiv: '2301.07041' }),
    ).toEqual({ relation: 'same', conflicting: false })
  })
})

describe('first-author compatibility', () => {
  it('accepts a shortened given name and either name order', () => {
    expect(firstAuthorCompatible(['Ashish Vaswani'], ['A. Vaswani'])).toBe(true)
    expect(firstAuthorCompatible(['Vaswani, Ashish'], ['A. Vaswani'])).toBe(true)
    expect(firstAuthorCompatible(['Vaswani'], ['Ashish Vaswani'])).toBe(true)
    expect(firstAuthorCompatible(['Vaswani,'], ['Vaswani'])).toBe(true)
    expect(firstAuthorCompatible(['Vaswani,   '], ['Vaswani'])).toBe(true)
    expect(firstAuthorCompatible(['张三'], ['张 三'])).toBe(true)
    expect(firstAuthorCompatible(['欧阳修'], ['欧阳'])).toBe(true)
  })

  it('rejects different people and incomplete names', () => {
    expect(firstAuthorCompatible(['Alice Example'], ['Bob Example'])).toBe(false)
    expect(firstAuthorCompatible(['张三'], ['李四'])).toBe(false)
    expect(firstAuthorCompatible([], ['Vaswani'])).toBe(false)
    expect(firstAuthorCompatible([''], ['Vaswani'])).toBe(false)
    expect(firstAuthorCompatible([', A.'], ['Vaswani'])).toBe(false)
    expect(firstAuthorCompatible(['Vaswani'], [])).toBe(false)
  })
})

describe('title-based version gate', () => {
  it('requires the same token set, an author match, and a year within one', () => {
    expect(
      titleVersionMatch(
        paper({
          title: 'Neural Retrieval for Clinical Evidence',
          authors: ['Ashish Vaswani'],
          year: 2017,
        }),
        paper({ title: 'Clinical Evidence Neural Retrieval', authors: ['A. Vaswani'], year: 2018 }),
      ),
    ).toBe(true)

    expect(
      titleVersionMatch(
        paper({ title: 'Neural Retrieval for Clinical Evidence', authors: ['Ashish Vaswani'] }),
        paper({
          title: 'Neural Retrieval for Clinical Evidence',
          authors: ['Ashish Vaswani'],
          year: 2017,
        }),
      ),
    ).toBe(false)

    expect(
      titleVersionMatch(
        paper({
          title: 'Neural Retrieval for Clinical Evidence',
          authors: ['Alice Example'],
          year: 2017,
        }),
        paper({
          title: 'Neural Retrieval for Clinical Evidence',
          authors: ['Bob Example'],
          year: 2017,
        }),
      ),
    ).toBe(false)

    expect(
      titleVersionMatch(
        paper({ title: 'Neural Retrieval for Clinical Evidence', authors: ['A'], year: 2017 }),
        paper({ title: 'Neural Retrieval for Legal Evidence', authors: ['A'], year: 2017 }),
      ),
    ).toBe(false)

    expect(
      titleVersionMatch(
        paper({ title: 'Deep Learning', authors: ['A'], year: 2017 }),
        paper({ title: 'Deep Learning', authors: ['A'], year: 2017 }),
      ),
    ).toBe(false)
  })
})

describe('version records', () => {
  it('adds a new version once and merges a repeated one by identity', () => {
    const target = paper({ title: 'Neural Retrieval', versions: [] })
    addVersionRecord(target, version({ doi: '10.1000/a', year: 2017, sources: ['OpenAlex'] }))
    expect(target.versions).toHaveLength(1)

    addVersionRecord(
      target,
      version({
        doi: '10.1000/a',
        year: 2019,
        venue: 'NeurIPS',
        retracted: true,
        sources: ['Crossref'],
      }),
    )
    expect(target.versions).toHaveLength(1)
    expect(target.versions?.[0]).toMatchObject({
      year: 2017,
      venue: 'NeurIPS',
      retracted: true,
      sources: ['OpenAlex', 'Crossref'],
    })

    addVersionRecord(target, version({ doi: '10.1000/a', year: 2020, retracted: true }))
    expect(target.versions?.[0]?.year).toBe(2017)
  })

  it('dedupes identifier-less versions by title, year, and venue', () => {
    const target = paper({ title: 'Neural Retrieval', versions: [] })
    addVersionRecord(target, version({ title: 'Neural Retrieval', year: 2017, venue: 'NeurIPS' }))
    addVersionRecord(target, version({ title: 'Neural Retrieval', year: 2017, venue: 'NeurIPS' }))
    expect(target.versions).toHaveLength(1)
  })

  it('never overwrites the primary record text and never propagates a retraction', () => {
    const target = paper({
      title: 'Neural Retrieval',
      authors: [],
      abstract: undefined,
      sources: ['OpenAlex'],
    })
    mergePaperInto(
      target,
      paper({
        title: 'Neural Retrieval',
        authors: ['Ashish Vaswani'],
        abstract: 'Version abstract.',
        arxiv: '2301.07041',
        doi: '10.1000/version',
        url: 'https://example.test/version',
        retracted: true,
        citations: 4,
        sources: ['Crossref'],
      }),
      'version',
    )

    expect(target.abstract).toBe('Version abstract.')
    expect(target.authors).toEqual(['Ashish Vaswani'])
    expect(target.arxiv).toBe('2301.07041')
    expect(target.doi).toBe('10.1000/version')
    expect(target.url).toBeUndefined()
    expect(target.retracted).toBeUndefined()
    expect(target.citations).toBe(4)
    expect(target.sources).toEqual(['OpenAlex', 'Crossref'])
    expect(target.versions?.[0]).toMatchObject({
      doi: '10.1000/version',
      retracted: true,
      url: 'https://example.test/version',
    })
  })

  it('keeps the primary text when a version arrives second', () => {
    const target = paper({
      title: 'Neural Retrieval',
      authors: ['Primary Author'],
      abstract: 'Primary abstract.',
    })
    mergePaperInto(
      target,
      paper({
        title: 'Neural Retrieval',
        authors: ['Version Author'],
        abstract: 'A much longer version abstract.',
      }),
      'version',
    )
    expect(target.abstract).toBe('Primary abstract.')
    expect(target.authors).toEqual(['Primary Author'])
  })
})
