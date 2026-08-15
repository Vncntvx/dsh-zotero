import { describe, expect, it } from 'vitest'
import { chunkText, rankChunks, tokenize } from '../src/evidence.js'

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Attention, is ALL you need!')).toEqual(['attention', 'is', 'all', 'you', 'need'])
  })

  it('keeps unicode letters and digits together', () => {
    expect(tokenize('  FlashAttention-2  論文  ')).toEqual(['flashattention', '2', '論文'])
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
    expect(chunks[0]).toEqual({ text: 'w0 w1 w2 w3 w4', index: 0 })
    expect(chunks[1]).toEqual({ text: 'w5 w6 w7 w8 w9', index: 1 })
    expect(chunks[2]).toEqual({ text: 'w10 w11', index: 2 })
  })

  it('returns no chunks for empty text', () => {
    expect(chunkText('', 5)).toEqual([])
  })

  it('preserves original whitespace inside chunks', () => {
    expect(chunkText('a  b\nc', 2)[0]!.text).toBe('a  b')
  })
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

  it('returns every chunk in original order with zero scores for an empty query', () => {
    const ranked = rankChunks('', CHUNKS)
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1, 2, 3])
    expect(ranked.every((entry) => entry.score === 0)).toBe(true)
  })
})

describe('rankChunks empty corpus', () => {
  it('returns nothing for an empty chunk list', () => {
    expect(rankChunks('anything', [])).toEqual([])
  })
})
