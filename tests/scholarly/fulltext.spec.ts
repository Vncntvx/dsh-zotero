import { describe, expect, it } from 'vitest'
import {
  extractOutline,
  findSection,
  rankPassages,
} from '../../src/scholarly/fulltext/evidence-bridge.js'
import { bm25EvidenceRanker } from '../../src/local/evidence-ranker.js'
import { decodeEntities } from '../../src/scholarly/sources/helpers.js'
import { arxivHtmlToMarkdown, jatsToMarkdown } from '../../src/scholarly/fulltext/markup.js'

describe('scholarly markup decoding & conversion', () => {
  it('decodes HTML and XML entities accurately', () => {
    expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeEntities('Alpha &lt; Beta &gt; Gamma')).toBe('Alpha < Beta > Gamma')
    expect(decodeEntities('En&#x2013;dash and Em&#x2014;dash')).toBe('En–dash and Em—dash')
    expect(decodeEntities('Code &#65; and &#66;')).toBe('Code A and B')
  })

  it('converts arXiv HTML articles to Markdown with math preservation', () => {
    const dummyParagraph =
      'This is a detailed analysis of neural transformer architectures under extreme constraints. '.repeat(
        6,
      )
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Article</title></head>
        <body>
          <nav>Navigation header to be ignored</nav>
          <article class="ltx_document">
            <h1>Attention Mechanisms in Large Language Models</h1>
            <p>${dummyParagraph}</p>
            <h2>1. Introduction</h2>
            <p>We consider the formulation where <math alttext="f(x) = Wx + b">f(x)</math> represents the projection.</p>
            <p>For block formulas: <math alttext="\\sum_{i=1}^n x_i" display="block">formula</math></p>
            <p>Here are more detailed discussion paragraphs to satisfy the minimal article length threshold. ${dummyParagraph}</p>
          </article>
        </body>
      </html>
    `
    const md = arxivHtmlToMarkdown(html)
    expect(md).toBeDefined()
    expect(md).toContain('# Attention Mechanisms in Large Language Models')
    expect(md).toContain('## 1. Introduction')
    expect(md).toContain('$f(x) = Wx + b$')
    expect(md).toContain('$$\\sum_{i=1}^n x_i$$')
    expect(md).not.toContain('Navigation header')
  })

  it('rejects incomplete or tiny arXiv HTML snippets under 500 chars', () => {
    const tinyHtml = '<article><h1>Short</h1><p>Too short.</p></article>'
    expect(arxivHtmlToMarkdown(tinyHtml)).toBeUndefined()
    expect(arxivHtmlToMarkdown('<div>No article tag</div>')).toBeUndefined()
  })

  it('converts PubMed Central JATS XML articles to structured Markdown', () => {
    const filler =
      'The biological efficacy of mRNA vaccines has been extensively examined across diverse demographic cohorts worldwide. '.repeat(
        5,
      )
    const xml = `
      <article>
        <front>
          <article-meta>
            <article-title>Mechanisms of mRNA Vaccine Immunology</article-title>
            <abstract>
              <p>Abstract text summarizing key immunological findings and long-term memory responses in cohorts.</p>
            </abstract>
          </article-meta>
        </front>
        <body>
          <sec id="s1">
            <title>1. Background and Rationale</title>
            <p>${filler}</p>
            <p>Formula expression: <tex-math>E = mc^2</tex-math>.</p>
          </sec>
          <sec id="s2">
            <title>2. Clinical Results</title>
            <p>Observations showed robust antibody titer elevation across all measured timepoints. ${filler}</p>
          </sec>
        </body>
        <back>
          <ref-list>
            <title>References</title>
            <ref id="b1"><element-citation publication-type="journal"><article-title>Foundational Study</article-title></element-citation></ref>
          </ref-list>
        </back>
      </article>
    `
    const md = jatsToMarkdown(xml)
    expect(md).toBeDefined()
    expect(md).toContain('# Mechanisms of mRNA Vaccine Immunology')
    expect(md).toContain('## Abstract')
    expect(md).toContain('## 1. Background and Rationale')
    expect(md).toContain('$E = mc^2$')
    expect(md).toContain('## 2. Clinical Results')
    expect(md).toContain('## References')
  })

  it('returns undefined when JATS XML lacks a body', () => {
    const noBodyXml = '<article><front><article-title>No Body</article-title></front></article>'
    expect(jatsToMarkdown(noBodyXml)).toBeUndefined()
  })
})

describe('scholarly evidence bridge & outline extraction', () => {
  const sampleDoc = `
# 1. Introduction

Transformers have become the standard architecture for natural language processing tasks.
In this work, we explore self-attention mechanisms and scaling laws.

## 1.1 Related Work

Previous recurrent neural networks suffered from vanishing gradient problems during backpropagation through time.

# 2. Methodology

We propose a multi-head self-attention module that attends to information from different representation subspaces.
The computational complexity is quadratic in the input sequence length.

## 2.1 Optimization and Training

Models were trained using the AdamW optimizer with cosine learning rate scheduling and warmup.
Dropout rate was set to 0.1 across all sublayers.

# 3. Experimental Evaluation

We evaluate on WMT 2014 English-to-German and English-to-French translation benchmarks.
`

  it('extracts hierarchical outlines from markdown documents', () => {
    const outline = extractOutline(sampleDoc)
    expect(outline.length).toBe(5)
    expect(outline[0]?.id).toBe('1')
    expect(outline[0]?.title).toBe('Introduction')
    expect(outline[0]?.level).toBe(1)

    expect(outline[1]?.id).toBe('1.1')
    expect(outline[1]?.title).toBe('Related Work')
    expect(outline[1]?.level).toBe(2)

    expect(outline[2]?.id).toBe('2')
    expect(outline[2]?.title).toBe('Methodology')
  })

  it('locates sections by ID, title, or substring query', () => {
    const outline = extractOutline(sampleDoc)
    const sec1 = findSection(outline, '1')
    expect(sec1?.title).toBe('Introduction')

    const sec21 = findSection(outline, '2.1')
    expect(sec21?.title).toBe('Optimization and Training')

    const secByTitle = findSection(outline, 'Methodology')
    expect(secByTitle?.id).toBe('2')

    const secBySub = findSection(outline, 'experimental')
    expect(secBySub?.id).toBe('3')

    expect(findSection(outline, 'Nonexistent Section')).toBeUndefined()
    expect(findSection(outline, '')).toBeUndefined()
  })

  it('ranks passages by query relevance', async () => {
    const query = 'AdamW optimizer learning rate scheduling'
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: sampleDoc,
      query,
      limit: 3,
      maxWords: 180,
      maxCharsPerChunk: 1_200,
    })
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]?.text).toContain('AdamW')
    expect(ranked[0]?.score).toBeGreaterThan(0)
  })

  it('segments on the same boundaries the host chunker uses', async () => {
    // The regression this locks: this module had its own 1200-character
    // splitter, so a `scholarly_read query=` hit and a `zotero_retrieve` hit
    // over the same paper landed on different passages.
    const { chunkText } = await import('../../src/evidence.js')
    const hostChunks = chunkText(sampleDoc, 180, 1_200)
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: sampleDoc,
      query: 'self-attention',
      limit: 12,
      maxWords: 180,
      maxCharsPerChunk: 1_200,
    })

    for (const passage of ranked) {
      expect(
        hostChunks.some((chunk) => chunk.text === passage.text),
        'every scholarly passage must be a host chunk verbatim',
      ).toBe(true)
    }
  })

  it('reports a character span that matches the passage text', async () => {
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: sampleDoc,
      query: 'attention',
      limit: 3,
      maxWords: 180,
      maxCharsPerChunk: 1_200,
    })
    expect(ranked.length).toBeGreaterThan(0)
    for (const passage of ranked) {
      expect(sampleDoc.slice(passage.start, passage.end)).toBe(passage.text)
    }
  })
})

describe('scholarly outline and passage boundaries', () => {
  it('numbers an outline heading that repeats an earlier number', () => {
    const doc = `# 1. Introduction

Body one.

# 1. Introduction

Body two.`
    const sections = extractOutline(doc)
    expect(sections.length).toBe(2)
    // The duplicate id is disambiguated rather than overwriting the first.
    expect(new Set(sections.map((s) => s.id)).size).toBe(2)
  })

  it('numbers headings by position when the document has no numbered headings', () => {
    const doc = `# Introduction

Body.

# Methods

More body.`
    const sections = extractOutline(doc)
    expect(sections.map((s) => s.id)).toEqual(['1', '2'])
  })

  it('returns no passages for an empty query or empty text', async () => {
    expect(
      (
        await rankPassages({
          ranker: bm25EvidenceRanker,
          text: 'some text about attention',
          query: '',
          limit: 3,
        })
      ).passages,
    ).toEqual([])
    expect(
      (await rankPassages({ ranker: bm25EvidenceRanker, text: '', query: 'attention', limit: 3 }))
        .passages,
    ).toEqual([])
  })

  it('finds a passage span even when the chunk text repeats', async () => {
    const repeated = 'attention '.repeat(400)
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: repeated,
      query: 'attention',
      limit: 2,
      maxWords: 50,
      maxCharsPerChunk: 200,
    })
    for (const passage of ranked) {
      expect(passage.end).toBeGreaterThanOrEqual(passage.start)
    }
  })
})
