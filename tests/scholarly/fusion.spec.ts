import { describe, expect, it } from 'vitest'
import {
  bestIdentifierOf,
  formatAuthorSummary,
  formatPaperDetail,
  formatPaperItem,
  fuseRankedLists,
  postProcessRanked,
} from '../../src/scholarly/fusion.js'
import {
  isFuzzyTitleMatch,
  jaccardSimilarity,
  mergePaperInto,
  titleTokens,
} from '../../src/scholarly/normalize.js'
import type { ScholarlyPaper } from '../../src/scholarly/types.js'

describe('scholarly normalization & matching', () => {
  it('computes Jaccard similarity and fuzzy title matching', () => {
    const tokensA = titleTokens('Attention Is All You Need')
    const tokensB = titleTokens('Attention Is All You Need: A Transformer Architecture')
    const sim = jaccardSimilarity(tokensA, tokensB)
    expect(sim).toBeGreaterThanOrEqual(0.6)

    const paper1: ScholarlyPaper = {
      title: 'Deep Residual Learning for Image Recognition',
      authors: ['Kaiming He'],
      year: 2016,
      sources: ['arXiv'],
    }
    const paper2: ScholarlyPaper = {
      title: 'Deep Residual Learning for Image Recognition: Extended Study',
      authors: ['Kaiming He'],
      year: 2016,
      sources: ['Crossref'],
    }
    expect(isFuzzyTitleMatch(paper1, paper2)).toBe(true)

    // Year mismatch (> 1 year difference) prevents false-positive matching
    const paper3: ScholarlyPaper = { ...paper2, year: 2020 }
    expect(isFuzzyTitleMatch(paper1, paper3)).toBe(false)
  })

  it('merges paper fields giving precedence to published DOI and richer data', () => {
    const target: ScholarlyPaper = {
      title: 'Attention Is All You Need',
      authors: ['Vaswani'],
      year: 2017,
      doi: '10.48550/arXiv.1706.03762',
      arxiv: '1706.03762',
      abstract: 'Short abstract.',
      citations: 500,
      sources: ['arXiv'],
    }

    const other: ScholarlyPaper = {
      title: 'Attention Is All You Need',
      authors: ['Vaswani', 'Shazeer', 'Parmar'],
      year: 2017,
      doi: '10.5555/neurips.2017.1', // Published DOI
      abstract: 'Much longer and comprehensive abstract text explaining multi-head attention.',
      citations: 120000,
      retracted: true,
      sources: ['Crossref'],
    }

    mergePaperInto(target, other)

    expect(target.doi).toBe('10.5555/neurips.2017.1')
    expect(target.arxiv).toBe('1706.03762')
    expect(target.authors).toHaveLength(3)
    expect(target.abstract).toBe(other.abstract)
    expect(target.citations).toBe(120000)
    expect(target.retracted).toBe(true)
    expect(target.sources).toEqual(['arXiv', 'Crossref'])
  })
})

describe('weighted RRF fusion', () => {
  it('fuses multiple lists and ranks papers appearing across sources higher', () => {
    const paperA: ScholarlyPaper = {
      title: 'Transformer Multi-Source Paper',
      authors: ['Author 1'],
      doi: '10.1000/1',
      sources: ['arXiv'],
    }
    const paperB: ScholarlyPaper = {
      title: 'Unique arXiv Paper',
      authors: ['Author 2'],
      doi: '10.1000/2',
      sources: ['arXiv'],
    }
    const paperC: ScholarlyPaper = {
      title: 'Unique OpenAlex Paper',
      authors: ['Author 3'],
      doi: '10.1000/3',
      sources: ['OpenAlex'],
    }

    const listArxiv = {
      sourceId: 'arxiv',
      weight: 1.0,
      papers: [paperB, paperA], // paperA is rank 1
    }

    const listOpenAlex = {
      sourceId: 'openalex',
      weight: 1.0,
      papers: [paperA, paperC], // paperA is rank 0
    }

    const fused = fuseRankedLists([listArxiv, listOpenAlex])

    // paperA appears in both lists, so its RRF score must be highest!
    expect(fused[0].title).toBe('Transformer Multi-Source Paper')
    expect(fused[0].sources).toContain('arXiv')
    expect(fused[0].sources).toContain('OpenAlex')
  })

  it('boosts exact title matches and handles date/citation sorting', () => {
    const p1: ScholarlyPaper = {
      title: 'Diffusion Models for Fast Sampling',
      authors: ['Alice'],
      year: 2023,
      date: '2023-04-10',
      citations: 200,
      sources: ['arXiv'],
    }
    const p2: ScholarlyPaper = {
      title: 'A Survey on Diffusion Models',
      authors: ['Bob'],
      year: 2024,
      date: '2024-01-15',
      citations: 50,
      sources: ['OpenAlex'],
    }
    const pFuture: ScholarlyPaper = {
      title: 'Erroneous Future Paper',
      authors: ['Ghost'],
      year: 2099,
      citations: 0,
      sources: ['Crossref'],
    }

    // Exact title match boost
    const boosted = postProcessRanked([p2, p1], {
      query: 'Diffusion Models for Fast Sampling',
      limit: 10,
      sort: 'relevance',
    })
    expect(boosted[0].title).toBe('Diffusion Models for Fast Sampling')

    // Date sorting
    const byDate = postProcessRanked([p1, p2, pFuture], {
      query: 'diffusion',
      limit: 10,
      sort: 'date',
    })
    expect(byDate[0].title).toBe('A Survey on Diffusion Models') // 2024 > 2023
    expect(byDate.find((p) => p.title === 'Erroneous Future Paper')).toBeUndefined()

    // Citation sorting
    const byCitations = postProcessRanked([p2, p1], {
      query: 'diffusion',
      limit: 10,
      sort: 'citations',
    })
    expect(byCitations[0].title).toBe('Diffusion Models for Fast Sampling') // 200 > 50
  })

  it('formats paper search result and detail cards cleanly', () => {
    const paper: ScholarlyPaper = {
      title: 'Foundation Models in 2024',
      authors: ['Author A', 'Author B'],
      year: 2024,
      venue: 'NeurIPS',
      doi: '10.1234/5678',
      arxiv: '2401.99999',
      citations: 1500,
      openAccess: true,
      inLibrary: {
        itemKey: 'ABC12345',
        libraryId: 'user',
        collections: ['AI Research'],
      },
      sources: ['arXiv', 'Semantic Scholar'],
      tldr: 'A comprehensive study of 2024 foundation models.',
    }

    const formatted = formatPaperItem(paper, 1, 300)
    expect(formatted).toContain('[1] Foundation Models in 2024')
    expect(formatted).toContain('[In Zotero: AI Research]')
    expect(formatted).toContain('cited 1500')
    expect(formatted).toContain('id: arXiv:2401.99999')

    const detail = formatPaperDetail(paper)
    expect(detail).toContain('in Zotero: yes (itemKey: ABC12345')
    expect(detail).toContain('summary (Semantic Scholar): A comprehensive study')
  })

  it('does not mutate input paper source arrays during normalization and fusion', () => {
    const rawSources = ['arXiv']
    const rawPaper: ScholarlyPaper = {
      title: 'Attention Is All You Need',
      authors: ['Vaswani'],
      year: 2017,
      sources: rawSources,
    }

    const fused = fuseRankedLists([
      { sourceId: 'arxiv', papers: [rawPaper] },
      { sourceId: 'openalex', papers: [rawPaper] },
    ])

    expect(fused.length).toBe(1)
    expect(fused[0]?.sources).toContain('arXiv')
    expect(fused[0]?.sources).toContain('OpenAlex')
    // Original input array must remain untouched
    expect(rawSources.length).toBe(1)
    expect(rawSources).toEqual(['arXiv'])
  })
})

describe('normalizePaper field derivation', () => {
  /** A paper with only the field under test set. @param over - overrides. */
  function paperOf(over: Partial<ScholarlyPaper>): ScholarlyPaper {
    return { title: 'T', authors: ['A'], sources: [], ...over } as ScholarlyPaper
  }

  it('derives an arXiv id from an arXiv DOI', async () => {
    const { normalizePaper } = await import('../../src/scholarly/normalize.js')
    const out = normalizePaper(paperOf({ doi: '10.48550/arXiv.2301.07041' }))
    expect(out.arxiv).toBe('2301.07041')
  })

  it('derives a DOI and PDF url from an arXiv id', async () => {
    const { normalizePaper } = await import('../../src/scholarly/normalize.js')
    const out = normalizePaper(paperOf({ arxiv: '2301.07041' }))
    expect(out.doi).toBe('10.48550/arXiv.2301.07041')
    expect(out.pdfUrl).toBe('https://arxiv.org/pdf/2301.07041')
  })

  it('prefers the canonical arXiv page for an arXiv DOI', async () => {
    const { normalizePaper } = await import('../../src/scholarly/normalize.js')
    const out = normalizePaper(paperOf({ doi: '10.48550/arXiv.2301.07041' }))
    expect(out.url).toBe('https://arxiv.org/abs/2301.07041')

    const doiPaper = normalizePaper(paperOf({ doi: '10.1234/plain.1' }))
    expect(doiPaper.url).toBe('https://doi.org/10.1234/plain.1')

    const pmidPaper = normalizePaper(paperOf({ pmid: '12345678' }))
    expect(pmidPaper.url).toBe('https://pubmed.ncbi.nlm.nih.gov/12345678/')
  })

  it('derives a year from a date', async () => {
    const { normalizePaper } = await import('../../src/scholarly/normalize.js')
    expect(normalizePaper(paperOf({ date: '2021-06-01' })).year).toBe(2021)
  })

  it('files a published DOI over a preprint DOI', () => {
    const target = {
      title: 'T',
      authors: [],
      sources: [],
      doi: '10.48550/arXiv.2301.1',
    } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      doi: '10.1038/published',
    } as ScholarlyPaper)
    expect(target.doi).toBe('10.1038/published')
  })

  it('keeps a published DOI against an incoming preprint DOI', () => {
    const target = {
      title: 'T',
      authors: [],
      sources: [],
      doi: '10.1038/published',
    } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      doi: '10.48550/arXiv.2301.1',
    } as ScholarlyPaper)
    expect(target.doi).toBe('10.1038/published')
  })

  it('takes the longer abstract, the larger author list, and the higher citation count', () => {
    const target = {
      title: 'T',
      authors: ['A'],
      sources: [],
      abstract: 'short',
      citations: 5,
    } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: ['A', 'B'],
      sources: [],
      abstract: 'a much longer abstract than the one already present',
      citations: 12,
    } as ScholarlyPaper)
    expect(target.abstract).toContain('much longer')
    expect(target.authors).toEqual(['A', 'B'])
    expect(target.citations).toBe(12)
  })

  it('makes retraction infectious and unions the source list', () => {
    const target = { title: 'T', authors: [], sources: ['OpenAlex'] } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: ['OpenAlex', 'Crossref'],
      retracted: true,
    } as ScholarlyPaper)
    expect(target.retracted).toBe(true)
    expect(target.sources).toEqual(['OpenAlex', 'Crossref'])
  })

  it('keeps an open-access flag once known', () => {
    const target = { title: 'T', authors: [], sources: [], openAccess: true } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      openAccess: false,
    } as ScholarlyPaper)
    expect(target.openAccess).toBe(true)
  })

  it('fills an absent open-access flag from the source', () => {
    const target = { title: 'T', authors: [], sources: [] } as ScholarlyPaper
    mergePaperInto(target, {
      title: 'T',
      authors: [],
      sources: [],
      openAccess: false,
    } as ScholarlyPaper)
    expect(target.openAccess).toBe(false)
  })
})

describe('ranking, filtering, and formatting branches', () => {
  /** @param over - paper overrides. */
  function p(over: Partial<ScholarlyPaper>): ScholarlyPaper {
    return { title: 'T', authors: [], sources: ['OpenAlex'], ...over } as ScholarlyPaper
  }

  it('sorts a date query newest first and clamps a future date', () => {
    const future = `${new Date().getFullYear() + 5}-01-01`
    const ranked = postProcessRanked(
      [p({ title: 'old', date: '2019-01-01' }), p({ title: 'future', date: future })],
      { query: 'q', limit: 10, sort: 'date' },
    )
    expect(ranked.map((x) => x.title)).toHaveLength(2)
    // The future-dated record is clamped to today, so it never sorts above a
    // record that is genuinely newer than it.
    expect(ranked[0]?.title).toBe('future')
  })

  it('drops a future-dated record from a date-sorted list', () => {
    const ranked = postProcessRanked(
      [p({ title: 'implausible', year: new Date().getFullYear() + 3 })],
      { query: 'q', limit: 10, sort: 'date' },
    )
    expect(ranked).toHaveLength(0)
  })

  it('strips an implausible year from a relevance-sorted list', () => {
    const ranked = postProcessRanked([p({ title: 'kept', year: new Date().getFullYear() + 3 })], {
      query: 'q',
      limit: 10,
      sort: 'relevance',
    })
    expect(ranked[0]?.year).toBeUndefined()
    expect(ranked[0]?.title).toBe('kept')
  })

  it('sorts by citation count and treats a missing count as lowest', () => {
    const ranked = postProcessRanked(
      [
        p({ title: 'none' }),
        p({ title: 'many', citations: 50 }),
        p({ title: 'some', citations: 5 }),
      ],
      { query: 'q', limit: 10, sort: 'citations' },
    )
    expect(ranked.map((x) => x.title)).toEqual(['many', 'some', 'none'])
  })

  it('filters to open access and slices to the limit', () => {
    const ranked = postProcessRanked(
      [
        p({ title: 'closed' }),
        p({ title: 'pdf', pdfUrl: 'https://example.org/a.pdf' }),
        p({ title: 'flagged', openAccess: true }),
      ],
      { query: 'q', limit: 1, sort: 'relevance', openAccess: true },
    )
    expect(ranked).toHaveLength(1)
    expect(['pdf', 'flagged']).toContain(ranked[0]?.title)
  })

  it('prefers the arXiv identifier, then DOI, PMID, PMCID, then a fallback', () => {
    expect(bestIdentifierOf(p({ arxiv: '2101.1' }))).toBe('arXiv:2101.1')
    expect(bestIdentifierOf(p({ doi: '10.1234/x' }))).toBe('10.1234/x')
    expect(bestIdentifierOf(p({ pmid: '123' }))).toBe('PMID:123')
    expect(bestIdentifierOf(p({ pmcid: 'PMC1' }))).toBe('PMC1')
    expect(bestIdentifierOf(p({ openalex: 'W1' }))).toBe('W1')
    expect(bestIdentifierOf(p({ s2: 's2id' }))).toBe('s2id')
    expect(bestIdentifierOf(p({ url: 'https://example.org' }))).toBe('https://example.org')
    expect(bestIdentifierOf(p({ title: 'A Title' }))).toBe('A Title')
  })

  it('truncates an author list past the display maximum', () => {
    expect(formatAuthorSummary([])).toBe('')
    expect(formatAuthorSummary(['A', 'B'])).toBe('A, B')
    expect(formatAuthorSummary(['A', 'B', 'C', 'D', 'E'])).toContain('5 authors')
  })

  it('formats a record that has none of the optional facts', () => {
    const line = formatPaperItem(p({ title: 'Bare' }), 1)
    expect(line).toContain('[1] Bare')
    expect(line).toContain('via OpenAlex')
  })

  it('truncates an over-long abstract with an ellipsis', () => {
    const line = formatPaperItem(p({ title: 'Long', abstract: 'x'.repeat(400) }), 1, 100)
    expect(line).toContain('…')
  })

  it('marks a retracted record', () => {
    expect(formatPaperItem(p({ title: 'R', retracted: true }), 1)).toContain('RETRACTED')
  })

  it('uses the TLDR as a short abstract when one is set', () => {
    const line = formatPaperItem(p({ title: 'S', tldr: 'A TLDR summary.' }), 1, 300)
    expect(line).toContain('A TLDR summary.')
  })
})

describe('fusion with custom weights and unknown sources', () => {
  it('honours an explicit per-source weight', () => {
    const heavy = fuseRankedLists([
      {
        sourceId: 'arxiv',
        weight: 5,
        papers: [{ title: 'Heavy Hit', authors: [], sources: [] } as ScholarlyPaper],
      },
      {
        sourceId: 'crossref',
        weight: 1,
        papers: [{ title: 'Light Hit', authors: [], sources: [] } as ScholarlyPaper],
      },
    ])
    expect(heavy[0]?.title).toBe('Heavy Hit')
  })

  it('labels a source it does not know by its raw id', () => {
    const merged = fuseRankedLists([
      {
        sourceId: 'unknown-index',
        papers: [{ title: 'A Paper', authors: [], sources: [] } as ScholarlyPaper],
      },
    ])
    expect(merged[0]?.sources).toContain('unknown-index')
  })

  it('uses a custom RRF constant without changing the ordering contract', () => {
    // Distinct titles stay distinct records; the constant only reweights ranks.
    const lists = [
      {
        sourceId: 'arxiv',
        papers: [{ title: 'Distinct Paper One', authors: [], sources: [] } as ScholarlyPaper],
      },
      {
        sourceId: 'openalex',
        papers: [{ title: 'Distinct Paper Two', authors: [], sources: [] } as ScholarlyPaper],
      },
    ]
    const ranked = fuseRankedLists(lists, 10)
    expect(ranked).toHaveLength(2)
  })
})
