/**
 * Source adapters, parsing side: turning one index's wire format into a
 * `ScholarlyPaper`. Pure record mapping — no HTTP.
 *
 * Request construction and refusal handling live in `sources-requests.spec.ts`.
 *
 * @module tests/scholarly/sources-parsing
 */

import { describe, expect, it } from 'vitest'
import {
  buildArxivSearchQuery,
  extractArxivId,
  paperFromArxiv,
  parseArxivAtom,
} from '../../src/scholarly/sources/arxiv.js'
import { paperFromCrossref } from '../../src/scholarly/sources/crossref.js'
import { cleanDblpAuthor, paperFromDblp } from '../../src/scholarly/sources/dblp.js'
import {
  paperFromOpenAlex,
  reconstructInvertedAbstract,
} from '../../src/scholarly/sources/openalex.js'
import { paperFromEpmc } from '../../src/scholarly/sources/pmc.js'
import { parsePubmedXml } from '../../src/scholarly/sources/pubmed.js'
import { paperFromS2 } from '../../src/scholarly/sources/semanticscholar.js'

describe('arxiv adapter', () => {
  it('extracts arXiv IDs from various formats', () => {
    expect(extractArxivId('2301.00001')).toBe('2301.00001')
    expect(extractArxivId('arXiv:2301.00001v2')).toBe('2301.00001')
    expect(extractArxivId('https://arxiv.org/abs/2301.00001')).toBe('2301.00001')
    expect(extractArxivId('10.48550/arXiv.2301.00001')).toBe('2301.00001')
    expect(extractArxivId('cs/0101001')).toBe('cs/0101001')
  })

  it('builds query with stopwords removed and category / date constraints', () => {
    const q = buildArxivSearchQuery({
      query: 'attention for transformer in NLP',
      limit: 10,
      sort: 'relevance',
      categories: ['cs.CL'],
      yearFrom: 2020,
      yearTo: 2023,
    })
    expect(q).toContain('(ti:attention OR abs:attention)')
    expect(q).toContain('(ti:transformer OR abs:transformer)')
    expect(q).not.toContain('ti:for')
    expect(q).toContain('cat:cs.CL')
    expect(q).toContain('submittedDate:[202001010000 TO 202312312359]')
  })

  it('parses arXiv Atom XML feed into structured entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:doi>10.48550/arXiv.1706.03762</arxiv:doi>
    <arxiv:journal_ref>NeurIPS 2017</arxiv:journal_ref>
    <category term="cs.CL"/>
  </entry>
</feed>`

    const entries = parseArxivAtom(xml)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('1706.03762')
    expect(entries[0].title).toBe('Attention Is All You Need')
    expect(entries[0].authors).toEqual(['Ashish Vaswani', 'Noam Shazeer'])
    expect(entries[0].doi).toBe('10.48550/arXiv.1706.03762')
    expect(entries[0].journalRef).toBe('NeurIPS 2017')
  })
})

describe('openalex adapter', () => {
  it('reconstructs abstract from inverted index', () => {
    const index = {
      Attention: [0],
      is: [1],
      all: [2],
      you: [3],
      'need.': [4],
    }
    expect(reconstructInvertedAbstract(index)).toBe('Attention is all you need.')
  })

  it('maps OpenAlex work to ScholarlyPaper', () => {
    const paper = paperFromOpenAlex({
      id: 'https://openalex.org/W12345',
      doi: 'https://doi.org/10.1000/182',
      display_name: 'Test Paper Title',
      publication_year: 2022,
      publication_date: '2022-05-10',
      type: 'journal-article',
      authorships: [{ author: { display_name: 'Alice Smith' } }],
      primary_location: {
        source: { display_name: 'Nature' },
        landing_page_url: 'https://nature.com',
      },
      cited_by_count: 142,
      is_retracted: false,
      abstract_inverted_index: { Hello: [0], world: [1] },
      ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/34567' },
    })

    expect(paper.title).toBe('Test Paper Title')
    expect(paper.doi).toBe('10.1000/182')
    expect(paper.year).toBe(2022)
    expect(paper.authors).toEqual(['Alice Smith'])
    expect(paper.citations).toBe(142)
    expect(paper.abstract).toBe('Hello world')
    expect(paper.pmid).toBe('34567')
    expect(paper.sources).toEqual(['OpenAlex'])
  })
})

describe('crossref adapter', () => {
  it('extracts date-parts, venue, and detects retractions', () => {
    const normal = paperFromCrossref({
      DOI: '10.1038/nature1234',
      title: ['A Deep Study'],
      author: [{ given: 'Bob', family: 'Johnson' }],
      issued: { 'date-parts': [[2021, 3, 15]] },
      'container-title': ['Nature Communications'],
      'is-referenced-by-count': 88,
    })
    expect(normal.year).toBe(2021)
    expect(normal.date).toBe('2021-03-15')
    expect(normal.authors).toEqual(['Bob Johnson'])
    expect(normal.retracted).toBeUndefined()

    const retracted = paperFromCrossref({
      DOI: '10.1038/bad1234',
      title: ['Retracted Paper'],
      author: [{ name: 'Fake Author' }],
      'update-to': [{ type: 'retraction', DOI: '10.1038/notice' }],
    })
    expect(retracted.retracted).toBe(true)
  })
})

describe('semantic scholar adapter', () => {
  it('maps TLDR and externalIds', () => {
    const paper = paperFromS2({
      paperId: 's2_123',
      title: 'Graph Neural Networks',
      year: 2020,
      authors: [{ name: 'Carol Danvers' }],
      citationCount: 450,
      tldr: { text: 'This paper introduces graph neural networks for molecules.' },
      externalIds: {
        DOI: '10.1145/12345',
        ArXiv: '2001.00001',
      },
    })
    expect(paper.title).toBe('Graph Neural Networks')
    expect(paper.tldr).toBe('This paper introduces graph neural networks for molecules.')
    expect(paper.doi).toBe('10.1145/12345')
    expect(paper.arxiv).toBe('2001.00001')
    expect(paper.citations).toBe(450)
  })
})

describe('europe pmc and pubmed adapters', () => {
  it('extracts Open Access PDF url from Europe PMC', () => {
    const paper = paperFromEpmc({
      id: 'PMC12345',
      title: 'Gene Therapy Study.',
      authorString: 'Doctor Who, Rose Tyler.',
      pubYear: '2019',
      fullTextUrlList: {
        fullTextUrl: [
          {
            documentStyle: 'pdf',
            availabilityCode: 'OA',
            url: 'https://europepmc.org/pdf/12345.pdf',
          },
        ],
      },
      isOpenAccess: 'Y',
    })
    expect(paper.title).toBe('Gene Therapy Study')
    expect(paper.authors).toEqual(['Doctor Who', 'Rose Tyler'])
    expect(paper.pdfUrl).toBe('https://europepmc.org/pdf/12345.pdf')
    expect(paper.openAccess).toBe(true)
  })

  it('parses PubMed XML with abstract labels', () => {
    const xml = `<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>12345678</PMID>
      <Article>
        <ArticleTitle>Clinical evaluation of drug X.</ArticleTitle>
        <Journal>
          <Title>Lancet</Title>
          <JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue>
        </Journal>
        <AuthorList>
          <Author><ForeName>John</ForeName><LastName>Doe</LastName></Author>
        </AuthorList>
        <Abstract>
          <AbstractText Label="BACKGROUND">Background info.</AbstractText>
          <AbstractText Label="METHODS">Method info.</AbstractText>
        </Abstract>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.1016/S0140-6736(20)30001-X</ArticleId>
        <ArticleId IdType="pmc">PMC7890123</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`

    const papers = parsePubmedXml(xml)
    expect(papers).toHaveLength(1)
    expect(papers[0].title).toBe('Clinical evaluation of drug X')
    expect(papers[0].pmid).toBe('12345678')
    expect(papers[0].doi).toBe('10.1016/S0140-6736(20)30001-X')
    expect(papers[0].pmcid).toBe('PMC7890123')
    expect(papers[0].venue).toBe('Lancet')
    expect(papers[0].abstract).toBe('BACKGROUND: Background info. METHODS: Method info.')
  })
})

describe('dblp adapter', () => {
  it('cleans namesake trailing digits and formats paper', () => {
    expect(cleanDblpAuthor('Wei Wang 0001')).toBe('Wei Wang')
    expect(cleanDblpAuthor('John Smith')).toBe('John Smith')

    const paper = paperFromDblp({
      info: {
        title: 'Efficient Matrix Multiplication.',
        authors: { author: [{ text: 'Wei Wang 0001' }, { text: 'Hao Zhang 0002' }] },
        year: '2022',
        venue: 'ICML',
        doi: '10.5555/icml.2022.1',
      },
    })
    expect(paper.title).toBe('Efficient Matrix Multiplication')
    expect(paper.authors).toEqual(['Wei Wang', 'Hao Zhang'])
    expect(paper.year).toBe(2022)
    expect(paper.venue).toBe('ICML')
  })
})

describe('PubMed XML parsing edge cases', () => {
  it('reads a labelled abstract, collective author, and MedlineDate year', () => {
    const xml = `<PubmedArticleSet><PubmedArticle>
      <MedlineCitation>
        <Article>
          <ArticleTitle>An Edge Case Article.</ArticleTitle>
          <Abstract>
            <AbstractText Label="BACKGROUND">First part.</AbstractText>
            <AbstractText Label="RESULTS">Second part.</AbstractText>
          </Abstract>
          <AuthorList>
            <Author><CollectiveName>The Study Group</CollectiveName></Author>
            <Author><ForeName>Ada</ForeName><LastName>Lovelace</LastName></Author>
          </AuthorList>
          <Journal><JournalIssue><PubDate><MedlineDate>2019 Jan-Feb</MedlineDate></PubDate></JournalIssue></Journal>
        </Article>
      </MedlineCitation>
      <PubmedData><ArticleIdList>
        <ArticleId IdType="doi">10.1234/edge.1</ArticleId>
        <ArticleId IdType="pubmed">31415926</ArticleId>
      </ArticleIdList></PubmedData>
    </PubmedArticle></PubmedArticleSet>`

    const papers = parsePubmedXml(xml)
    expect(papers).toHaveLength(1)
    const paper = papers[0]!
    expect(paper.title).toBe('An Edge Case Article')
    expect(paper.abstract).toContain('BACKGROUND')
    expect(paper.authors).toContain('The Study Group')
    expect(paper.authors).toContain('Ada Lovelace')
    expect(paper.year).toBe(2019)
    expect(paper.doi).toBe('10.1234/edge.1')
    expect(paper.pmid).toBe('31415926')
  })

  it('returns nothing for an empty PubmedArticleSet', () => {
    expect(parsePubmedXml('<PubmedArticleSet></PubmedArticleSet>')).toEqual([])
  })

  it('drops an article that carries no title', () => {
    // `parsePubmedXml` filters on `title !== ''`, so an empty citation block
    // yields nothing rather than a nameless record.
    expect(
      parsePubmedXml('<PubmedArticleSet><PubmedArticle></PubmedArticle></PubmedArticleSet>'),
    ).toEqual([])
  })
})

describe('arXiv Atom parsing edge cases', () => {
  it('reads a multi-author entry with categories and a DOI', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2401.00002v1</id>
        <title>An arXiv Edge Case</title>
        <summary>Short summary of the work.</summary>
        <published>2024-01-02T00:00:00Z</published>
        <author><name>Ada Lovelace</name></author>
        <author><name>Alan Turing</name></author>
        <category term="cs.LG" />
        <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1234/arxiv.edge</arxiv:doi>
      </entry>
    </feed>`

    const entries = parseArxivAtom(atom)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.title).toBe('An arXiv Edge Case')
    expect(entries[0]?.authors).toEqual(['Ada Lovelace', 'Alan Turing'])

    const paper = paperFromArxiv(entries[0]!)
    expect(paper.year).toBe(2024)
    expect(paper.doi).toBe('10.1234/arxiv.edge')
    expect(paper.arxiv).toBe('2401.00002')
  })

  it('builds a search query that drops stopwords and honours categories', () => {
    const query = buildArxivSearchQuery({
      query: 'the attention mechanism of a transformer',
      limit: 5,
      sort: 'date',
      categories: ['cs.CL', 'cs.LG'],
    } as never)
    expect(query).not.toContain(' the ')
    expect(query).toContain('cs.CL')
    expect(query).toContain('cs.LG')
  })

  it('returns nothing for a feed with no entries', () => {
    expect(
      parseArxivAtom('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'),
    ).toEqual([])
  })
})
