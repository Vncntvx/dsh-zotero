import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkText, queryTermsOf, rankChunks, tokenize } from '../../src/evidence.js'

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Attention, is ALL you need!')).toEqual([
      'attention',
      'is',
      'all',
      'you',
      'need',
    ])
  })

  it('keeps unicode letters and digits together', () => {
    expect(tokenize('  FlashAttention-2  論文  ')).toEqual(['flashattention', '2', '論文'])
  })

  it('folds tokens the way Zotero folds its own search index', () => {
    expect(tokenize('Café Straße œuvre')).toEqual(['cafe', 'strasse', 'oeuvre'])
    expect(tokenize('“Quoted” — dashed')).toEqual(['quoted', 'dashed'])
    expect(tokenize('séance ¹⁄₂')).toEqual(['seance', '1', '2'])
  })

  it('returns no tokens for empty input', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('chunkText', () => {
  it('cuts hard word-count chunks with a short tail', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkText(words, 5)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({ text: 'w0 w1 w2 w3 w4', index: 0, start: 0, end: 14 })
    expect(chunks[1]).toEqual({ text: 'w5 w6 w7 w8 w9', index: 1, start: 15, end: 29 })
    expect(chunks[2]).toEqual({ text: 'w10 w11', index: 2, start: 30, end: 37 })
  })

  it('returns no chunks for empty text', () => {
    expect(chunkText('', 5)).toEqual([])
  })

  it('preserves original whitespace inside chunks', () => {
    expect(chunkText('a  b\nc', 2)[0]!.text).toBe('a  b')
  })

  it('splits unspaced CJK text into words instead of one run-on chunk', () => {
    // A single `\S+` span would make the whole string one chunk; word-aware
    // segmentation cuts it into several even though there is no whitespace.
    const cjk = '中文全文没有空格'.repeat(6)
    const chunks = chunkText(cjk, 4)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(cjk)
  })

  it('tokenizes unspaced CJK into queryable words', () => {
    expect(tokenize('中文全文没有空格')).toEqual(['中文', '全文', '没有', '空格'])
  })

  it('keeps every chunk within the character ceiling, whitespace included', () => {
    const chunks = chunkText('a b c d e f', 10, 3)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['a b', 'c d', 'e f'])
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(3)
  })

  it('cuts a single overlong word in place to honor the character ceiling', () => {
    const chunks = chunkText(`a ${'x'.repeat(10)} b`, 5, 4)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['a', 'xxxx', 'xxxx', 'xx', 'b'])
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(4)
  })

  it('keeps pure word-count behavior when no character ceiling is given', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkText(words, 5)
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'w0 w1 w2 w3 w4',
      'w5 w6 w7 w8 w9',
      'w10 w11',
    ])
  })

  it('falls back to whitespace splitting when Intl.Segmenter is unavailable', () => {
    vi.stubGlobal('Intl', { Segmenter: undefined })
    try {
      expect(chunkText('w0 w1 w2 w3 w4 w5', 2).map((chunk) => chunk.text)).toEqual([
        'w0 w1',
        'w2 w3',
        'w4 w5',
      ])
      expect(tokenize('Attention, is ALL you need!')).toEqual([
        'attention',
        'is',
        'all',
        'you',
        'need',
      ])
      expect(tokenize('---')).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rankChunks', () => {
  const CHUNKS = [
    { text: 'flash attention speeds up transformers', index: 0 },
    { text: 'unrelated filler text about farming', index: 1 },
    { text: 'attention is all you need', index: 2 },
    { text: 'flash attention attention again', index: 3 },
  ]

  it('ranks chunks with more query-term occurrences first', () => {
    const ranked = rankChunks('flash attention', CHUNKS)
    expect(ranked.map((entry) => entry.index)).toEqual([3, 0, 2, 1])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    expect(ranked[3]!.score).toBe(0)
  })

  it('keeps original order when scores tie', () => {
    const ranked = rankChunks('flash', [
      { text: 'flash drive storage', index: 0 },
      { text: 'flash memory chips', index: 1 },
      { text: 'no match here', index: 2 },
    ])
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1, 2])
  })

  it('matches a folded query against the text it folded from', () => {
    // The server-side search matches `cafe` against `café`; ranking must too,
    // or a search hit returns no passages for the very terms that found it.
    const ranked = rankChunks('cafe', [
      { text: 'the café served seance notes', index: 0 },
      { text: 'unrelated text', index: 1 },
    ])
    expect(ranked[0]!.score).toBeGreaterThan(0)
    expect(ranked[1]!.score).toBe(0)
  })

  it('prefers a rare query term over raw term-frequency counts', () => {
    // `rare` appears in exactly one document (high idf), while `common`
    // appears in both (low idf). A plain term-frequency ranking would put
    // the four-occurrence document first; BM25's idf and length
    // normalization put the short document with the rare term on top.
    const ranked = rankChunks('rare common', [
      { text: 'rare common', index: 0 },
      { text: 'common common common common', index: 1 },
    ])
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
  })

  it('returns every chunk in original order with zero scores for an empty query', () => {
    const ranked = rankChunks('', CHUNKS)
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1, 2, 3])
    expect(ranked.every((entry) => entry.score === 0)).toBe(true)
  })

  it('does not turn function words in a natural-language question into evidence', () => {
    // The generic table sentence and the concept paraphrase share only
    // function words with the question; neither is lexical evidence. The one
    // passage carrying the actual terms must win.
    const passages = [
      { text: 'The role of perceived legitimacy in regulatory adherence.', index: 0 },
      { text: 'Table 2 lists the and of the in the', index: 1 },
      { text: 'institutional trust and compliance', index: 2 },
    ]
    const ranked = rankChunks(
      'What mechanisms explain the relationship between institutional trust and compliance?',
      passages,
    )
    expect(ranked.map((entry) => entry.index)).toEqual([2, 0, 1])
    expect(ranked[0]!.score).toBeGreaterThan(0)
    expect(ranked[1]!.score).toBe(0)
    expect(ranked[2]!.score).toBe(0)
  })

  it('counts a repeated query term once instead of multiplying its score', () => {
    const once = rankChunks('trust', CHUNKS)
    const thrice = rankChunks('trust trust trust', CHUNKS)
    expect(thrice.map((entry) => entry.score)).toEqual(once.map((entry) => entry.score))
    expect(thrice.map((entry) => entry.index)).toEqual(once.map((entry) => entry.index))
  })

  it('keeps a content word that appears in most but not all passages', () => {
    // A `df > 0.6N` noise threshold would discard `attention` (df=3, N=4)
    // and break the ranking contract above. Only function words are dropped.
    expect(queryTermsOf('attention').includes('attention')).toBe(true)
    const ranked = rankChunks('attention', CHUNKS)
    expect(ranked[0]!.score).toBeGreaterThan(0)
  })

  it('still returns evidence when the only query term appears in every passage', () => {
    // Zeroing `df >= N` would make a paper entirely about `attention` answer
    // an `attention` query with an empty evidence array.
    const homogeneous = Array.from({ length: 6 }, (_, index) => ({
      text: `attention study number ${index} and attention again`,
      index,
    }))
    const ranked = rankChunks('attention', homogeneous)
    expect(ranked.every((entry) => entry.score > 0)).toBe(true)
  })

  it('keeps a single-passage corpus queryable', () => {
    const ranked = rankChunks('trust', [{ text: 'institutional trust', index: 0 }])
    expect(ranked[0]!.score).toBeGreaterThan(0)
  })

  it('reports the deduplicated, folded, non-function query terms', () => {
    expect(queryTermsOf('Trust the CAFÉ trust and the CAFÉ')).toEqual(['trust', 'cafe'])
    expect(queryTermsOf('之间的关系是什么')).not.toContain('的')
    expect(queryTermsOf('the and of')).toEqual([])
  })
})

describe('rankChunks empty corpus', () => {
  it('returns nothing for an empty chunk list', () => {
    expect(rankChunks('anything', [])).toEqual([])
  })
})
