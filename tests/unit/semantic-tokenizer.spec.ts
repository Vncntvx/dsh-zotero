/**
 * The embedding tokenizer's own rules — instruction prefixes, window
 * truncation, batch padding — driven through a scripted tokenizer, because the
 * real `tokenizer.json` files are opt-in model assets no unit test may
 * require. Special-token handling of the HF runtime itself is covered by the
 * opt-in semantic-eval run.
 * @module tests/unit/semantic-tokenizer
 */

import { describe, expect, it, vi } from 'vitest'
import {
  embeddingTokenizerOf,
  type TokenizerLike,
} from '../../src/enrichment/semantic/tokenizer.ts'

/** ids[i] = i + 1; one id per character, so lengths are observable. */
function scriptedTokenizer(): TokenizerLike {
  return {
    encode: (text) => ({
      ids: Array.from({ length: text.length }, (_, i) => i + 1),
      attention_mask: new Array(text.length).fill(1),
    }),
    token_to_id: (token) => (token === '<pad>' ? 0 : undefined),
  }
}

const spec = { maxTokens: 8, queryPrefix: 'query: ', documentPrefix: 'doc: ' }

describe('embeddingTokenizerOf', () => {
  it('applies the side instruction prefix before encoding', () => {
    const tokenizer = scriptedTokenizer()
    const encode = vi.spyOn(tokenizer, 'encode')
    const embedding = embeddingTokenizerOf(tokenizer, { pad_token: '<pad>' }, spec)
    embedding.batch(['abc'], 'query')
    embedding.batch(['abc'], 'document')
    expect(encode).toHaveBeenNthCalledWith(1, 'query: abc', { add_special_tokens: true })
    expect(encode).toHaveBeenNthCalledWith(2, 'doc: abc', { add_special_tokens: true })
  })

  it('truncates rows to the model window', () => {
    const embedding = embeddingTokenizerOf(scriptedTokenizer(), { pad_token: '<pad>' }, spec)
    const batch = embedding.batch(['0123456789abc'], 'query')
    expect(batch.sequenceLength).toBe(8)
    expect([...batch.inputIds.subarray(0, 8)]).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n])
  })

  it('pads every row to the batch maximum with the pad id and zeroes its mask', () => {
    const embedding = embeddingTokenizerOf(scriptedTokenizer(), { pad_token: '<pad>' }, spec)
    const batch = embedding.batch(['ab', 'abcd'], 'query')
    expect(batch.batchSize).toBe(2)
    // 'query: ab' = 9 chars → truncated to 8; 'query: abcd' = 11 → 8.
    expect(batch.sequenceLength).toBe(8)
    // Both rows occupy the full width, so every mask entry is attended.
    expect([...batch.attentionMask]).toEqual(new Array(16).fill(1n))
  })

  it('pads a shorter row after the prefix is applied', () => {
    const embedding = embeddingTokenizerOf(scriptedTokenizer(), { pad_token: '<pad>' }, spec)
    // 'doc: x' = 6 chars vs 'doc: abcde' = 10 → truncated to 8; row 0 pads to 8.
    const batch = embedding.batch(['x', 'abcde'], 'document')
    expect(batch.sequenceLength).toBe(8)
    // Row 0: ids 1..6 then two pad ids (0).
    expect([...batch.inputIds.subarray(0, 8)]).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 0n, 0n])
    expect([...batch.attentionMask.subarray(0, 8)]).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 0n, 0n])
  })

  it('resolves the pad id from the config token, defaulting to 0', () => {
    const embedding = embeddingTokenizerOf(
      scriptedTokenizer(),
      { pad_token: { content: '<pad>' } },
      spec,
    )
    const batch = embedding.batch(['x', 'abcdef'], 'document')
    // Row 0 pads from position 6 with the pad id 0 ('<pad>').
    expect(batch.inputIds[6]).toBe(0n)
  })

  it('returns an empty batch for no texts', () => {
    const embedding = embeddingTokenizerOf(scriptedTokenizer(), { pad_token: '<pad>' }, spec)
    const batch = embedding.batch([], 'query')
    expect(batch.batchSize).toBe(0)
    expect(batch.sequenceLength).toBe(0)
  })
})
