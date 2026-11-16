/** Tokenization is bounded before encoding; inference splits retain every row. */
import { expect, it, vi } from 'vitest'
import { tinyModel } from '../helpers/semantic-model-bundle.ts'
import { embedderOf, type SessionPort } from '../../src/enrichment/semantic/session.ts'
import {
  embeddingTokenizerOf,
  MAX_EMBED_TEXT_CHARS,
} from '../../src/enrichment/semantic/tokenizer.ts'

it('refuses oversized text before invoking the tokenizer', () => {
  const encode = vi.fn(() => ({ ids: [1], attention_mask: [1] }))
  const tokenizer = embeddingTokenizerOf({ encode, token_to_id: () => 0 }, {}, tinyModel)
  expect(() => tokenizer.batch(['x'.repeat(MAX_EMBED_TEXT_CHARS + 1)], 'document')).toThrow(
    /exceeds/,
  )
  expect(encode).not.toHaveBeenCalled()
})

it('splits long padded rows under 32768 tokens without repeating tokenization or losing order', async () => {
  const encode = vi.fn((text: string) => ({
    ids: new Array<number>(16384).fill(Number(text)),
    attention_mask: new Array<number>(16384).fill(1),
  }))
  const spec = { ...tinyModel, maxTokens: 32768, normalize: false }
  const tokenizer = embeddingTokenizerOf({ encode, token_to_id: () => 0 }, {}, spec)
  const runs: number[][] = []
  const port: SessionPort = {
    inputNames: ['input_ids'],
    outputNames: ['sentence_embedding'],
    async run(feeds) {
      const input = feeds.input_ids!
      const [rows, seq] = input.dims as [number, number]
      expect(rows * seq).toBeLessThanOrEqual(32768)
      const ids = Array.from({ length: rows }, (_, i) => Number(input.data[i * seq]))
      runs.push(ids)
      return {
        sentence_embedding: {
          dims: [rows, 2],
          data: new Float32Array(ids.flatMap((id) => [id, 0])),
        },
      }
    },
    release: async () => {},
  }
  const embedder = embedderOf(spec, tokenizer, port, (dims, data) => ({ dims, data }))
  try {
    const vectors = await embedder.embed(['1', '2', '3', '4', '5', '6', '7', '8'], 'document')
    expect(runs).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ])
    expect(vectors.map((vector) => vector[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(encode).toHaveBeenCalledTimes(8)
  } finally {
    await embedder.dispose()
  }
})
