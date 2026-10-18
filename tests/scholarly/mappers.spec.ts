/**
 * Source-adapter record mapping: every field an index can omit, rename, or
 * return as an empty value. These branches are the adapters' whole contract —
 * the shape they hand the fusion layer — and a record that maps wrongly is a
 * paper the model cannot cite.
 *
 * @module tests/scholarly/mappers
 */

import { describe, expect, it } from 'vitest'
import { cleanDblpAuthor, paperFromDblp } from '../../src/scholarly/sources/dblp.js'
import { paperFromEpmc } from '../../src/scholarly/sources/pmc.js'
import type { ScholarlyPaper } from '../../src/scholarly/types.js'
import { paperFromS2 } from '../../src/scholarly/sources/semanticscholar.js'

describe('Semantic Scholar mapping', () => {
  it('maps a fully populated record', () => {
    const paper = paperFromS2({
      paperId: 'abc123',
      title: 'A Semantic Scholar Record',
      abstract: 'An abstract.',
      year: 2021,
      publicationDate: '2021-06-01',
      venue: 'NeurIPS',
      authors: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }],
      externalIds: { DOI: '10.1234/s2.1', ArXiv: '2101.00001', PubMedCentral: '7654321' },
      citationCount: 42,
      openAccessPdf: { url: 'https://example.org/s2.pdf' },
      tldr: { text: 'A one-line summary.' },
    })

    expect(paper.title).toBe('A Semantic Scholar Record')
    expect(paper.authors).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(paper.year).toBe(2021)
    expect(paper.date).toBe('2021-06-01')
    expect(paper.doi).toBe('10.1234/s2.1')
    expect(paper.arxiv).toBe('2101.00001')
    expect(paper.pmcid).toBe('PMC7654321')
    expect(paper.citations).toBe(42)
    expect(paper.pdfUrl).toBe('https://example.org/s2.pdf')
    expect(paper.tldr).toBe('A one-line summary.')
    expect(paper.s2).toBe('abc123')
    expect(paper.sources).toEqual(['Semantic Scholar'])
  })

  it('prefers the DOI URL, then the arXiv URL, then the S2 page', () => {
    // `cleanDoi` requires the real `10.NNNN/...` prefix, so the fixture uses
    // one a registry would actually issue.
    const withDoi = paperFromS2({
      paperId: 'a',
      title: 'T',
      externalIds: { DOI: '10.1234/x' },
    })
    expect(withDoi.url).toBe('https://doi.org/10.1234/x')

    const withArxiv = paperFromS2({ paperId: 'b', title: 'T', externalIds: { ArXiv: '2101.1' } })
    expect(withArxiv.url).toBe('https://arxiv.org/abs/2101.1')

    const bare = paperFromS2({ paperId: 'c', title: 'T' })
    expect(bare.url).toBe('https://www.semanticscholar.org/paper/c')
  })

  it('maps a record with every optional field absent', () => {
    const paper = paperFromS2({ paperId: 'min', title: 'Only A Title' })
    // `stripEmptyFields` drops an empty list rather than storing one, so the
    // consumer reads `authors` as absent — never as a zero-length claim.
    expect(paper.authors ?? []).toEqual([])
    expect(paper.doi).toBeUndefined()
    expect(paper.year).toBeUndefined()
    expect(paper.citations).toBeUndefined()
  })
})

describe('DBLP mapping', () => {
  it('maps a record with authors as an array and a DOI', () => {
    const paper = paperFromDblp({
      info: {
        title: 'A DBLP Record.',
        authors: { author: [{ text: 'Ada Lovelace' }, { text: 'Alan Turing' }] },
        year: '2020',
        venue: 'NeurIPS',
        doi: '10.1234/dblp.1',
        ee: 'https://doi.org/10.1234/dblp.1',
      },
    })
    expect(paper.title).toBe('A DBLP Record')
    expect(paper.authors).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(paper.year).toBe(2020)
    expect(paper.doi).toBe('10.1234/dblp.1')
    expect(paper.venue).toBe('NeurIPS')
    expect(paper.sources).toEqual(['DBLP'])
  })

  it('maps a single author object the parser did not array-ify', () => {
    const paper = paperFromDblp({
      info: {
        title: 'One Author',
        authors: { author: { text: 'Ada Lovelace 0001' } },
        year: '2019',
      },
    })
    expect(paper.authors).toEqual(['Ada Lovelace'])
  })

  it('derives an arXiv id from the ee link when no DOI is present', () => {
    const paper = paperFromDblp({
      info: { title: 'Preprint', ee: 'https://arxiv.org/abs/2101.00002' },
    })
    expect(paper.arxiv).toBe('2101.00002')
    expect(paper.doi).toBeUndefined()
    expect(paper.url).toContain('arxiv.org')
  })

  it('takes the first element of array-valued venue and ee fields', () => {
    const paper = paperFromDblp({
      info: {
        title: 'Array Fields',
        venue: ['First Venue', 'Second Venue'],
        ee: ['https://example.org/first', 'https://example.org/second'],
      },
    })
    expect(paper.venue).toBe('First Venue')
    expect(paper.url).toBe('https://example.org/first')
  })

  it('normalizes a numeric-suffixed author name', () => {
    expect(cleanDblpAuthor('Ada Lovelace 0001')).toBe('Ada Lovelace')
    expect(cleanDblpAuthor('Alan Turing')).toBe('Alan Turing')
  })

  it('maps a record with no info block', () => {
    const paper = paperFromDblp({})
    expect(paper.title ?? '').toBe('')
  })
})

describe('Europe PMC mapping', () => {
  it('maps a record with journal, DOI, and an open-access PDF', () => {
    const paper = paperFromEpmc({
      id: '123',
      source: 'MED',
      pmid: '31415926',
      pmcid: 'PMC1234567',
      doi: '10.1234/epmc.1',
      title: 'A Europe PMC Record.',
      authorString: 'Lovelace A, Turing A.',
      journalInfo: { journal: { title: 'Nature' } },
      pubYear: '2018',
      firstPublicationDate: '2018-03-01',
      abstractText: 'An abstract.',
      citedByCount: 7,
      fullTextUrlList: {
        fullTextUrl: [
          { documentStyle: 'html', availabilityCode: 'OA', url: 'https://example.org/a.html' },
          { documentStyle: 'pdf', availabilityCode: 'OA', url: 'https://example.org/a.pdf' },
        ],
      },
    } as never)

    expect(paper.title).toBe('A Europe PMC Record')
    expect(paper.authors).toEqual(['Lovelace A', 'Turing A'])
    expect(paper.doi).toBe('10.1234/epmc.1')
    expect(paper.pmid).toBe('31415926')
    expect(paper.pmcid).toBe('PMC1234567')
    expect(paper.year).toBe(2018)
    expect(paper.date).toBe('2018-03-01')
    expect(paper.venue).toBe('Nature')
    expect(paper.pdfUrl).toBe('https://example.org/a.pdf')
    expect(paper.sources).toEqual(['Europe PMC'])
  })

  it('uses the publisher for a preprint with no journal', () => {
    const paper = paperFromEpmc({
      id: '2',
      source: 'PPR',
      title: 'A Preprint',
      bookOrReportDetails: { publisher: 'bioRxiv' },
    } as never)
    expect(paper.venue).toBe('bioRxiv')
    expect(paper.type).toBe('preprint')
  })

  it('ignores a PDF that is not open access', () => {
    const paper = paperFromEpmc({
      id: '3',
      title: 'Closed Access',
      fullTextUrlList: {
        fullTextUrl: [
          { documentStyle: 'pdf', availabilityCode: 'S', url: 'https://example.org/closed.pdf' },
        ],
      },
    } as never)
    expect(paper.pdfUrl).toBeUndefined()
  })

  it('maps a record with no author string and no journal', () => {
    const paper = paperFromEpmc({ id: '4', title: 'Bare Record' } as never)
    expect(paper.authors ?? []).toEqual([])
    expect(paper.venue).toBeUndefined()
  })
})

describe('record mapping never invents a title', () => {
  it('leaves the title empty so adapters can drop the record', () => {
    // Adapters filter on `(title ?? '') !== ''`; an invented title would survive
    // that filter as a citable record that does not exist.
    for (const paper of [
      paperFromS2({ paperId: 'x' }),
      paperFromDblp({ info: {} }),
      paperFromEpmc({ id: 'x' } as never),
    ]) {
      expect(paper.title ?? '').toBe('')
    }
  })
})

describe('fusion precedence and OpenAlex mapping corners', () => {
  it('prefers a published DOI over the arXiv DOI in either order', async () => {
    const { mergePaperInto } = await import('../../src/scholarly/normalize.js')
    const target: ScholarlyPaper = {
      title: 'T',
      authors: [],
      sources: ['arXiv'],
      doi: '10.48550/arXiv.1',
    }
    mergePaperInto(target, { title: 'T', authors: [], sources: ['Crossref'], doi: '10.1038/x' })
    expect(target.doi).toBe('10.1038/x')

    const preprintFirst: ScholarlyPaper = {
      title: 'T',
      authors: [],
      sources: ['Crossref'],
      doi: '10.1038/x',
    }
    mergePaperInto(preprintFirst, {
      title: 'T',
      authors: [],
      sources: ['arXiv'],
      doi: '10.48550/arXiv.1',
    })
    expect(preprintFirst.doi).toBe('10.1038/x')
  })

  it('keeps the first in-library annotation it is given', async () => {
    const { mergePaperInto } = await import('../../src/scholarly/normalize.js')
    const target: ScholarlyPaper = {
      title: 'T',
      authors: [],
      sources: [],
      inLibrary: { itemKey: 'A', libraryId: '0', collections: ['First'] },
    }
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      inLibrary: { itemKey: 'B', libraryId: '0', collections: ['Second'] },
    })
    expect(target.inLibrary?.itemKey).toBe('A')
  })

  it('fills a missing in-library annotation from the source', async () => {
    const { mergePaperInto } = await import('../../src/scholarly/normalize.js')
    const target: ScholarlyPaper = { title: 'T', authors: [], sources: [] }
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      inLibrary: { itemKey: 'C', libraryId: '0', collections: [] },
    })
    expect(target.inLibrary?.itemKey).toBe('C')
  })

  it('keeps the longest abstract and never shortens one', async () => {
    const { mergePaperInto } = await import('../../src/scholarly/normalize.js')
    const target = {
      title: 'T',
      authors: [],
      sources: [],
      abstract: 'a long abstract already here',
    }
    mergePaperInto(target, { title: 'T', authors: [], sources: [], abstract: 'short' })
    expect(target.abstract).toBe('a long abstract already here')
  })

  it('keeps the larger citation count', async () => {
    const { mergePaperInto } = await import('../../src/scholarly/normalize.js')
    const target: ScholarlyPaper = { title: 'T', authors: [], sources: [], citations: 100 }
    mergePaperInto(target, { title: 'T', authors: [], sources: [], citations: 3 })
    expect(target.citations).toBe(100)
  })
})
