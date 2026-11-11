/**
 * The session layer's batching, pooling, and output-shape logic, driven
 * through a scripted `SessionPort`: the WASM session itself is only exercised
 * by the opt-in semantic-eval run against a real model.
 * @module tests/unit/semantic-session
 */

import { describe, expect, it } from 'vitest'
import { semanticModelOf } from '../../src/enrichment-model-catalog.ts'
import {
  embedderOf,
  type Int64TensorFactory,
  type SessionPort,
  type SessionTensor,
} from '../../src/enrichment/semantic/session.ts'
import {
  embeddingTokenizerOf,
  type TokenizerLike,
} from '../../src/enrichment/semantic/tokenizer.ts'

// A small-dimension clone of the balanced entry: the session logic is
// dimension-agnostic and the fixtures are 2-wide.
const spec = {
  ...semanticModelOf('balanced'),
  dimension: 2,
  maxTokens: 16,
  queryPrefix: '',
  documentPrefix: '',
}

/** ids[i] = i + 1 per character; the pad id is 0. */
const tokenizer: TokenizerLike = {
  encode: (text) => ({
    ids: Array.from({ length: text.length }, (_, i) => i + 1),
    attention_mask: new Array(text.length).fill(1),
  }),
  token_to_id: (token) => (token === '<|endoftext|>' ? 0 : undefined),
}

const int64Tensor: Int64TensorFactory = (dims, data) => ({ dims, data })

function portOf(
  outputs: SessionTensor[],
  opts: { inputs?: readonly string[] } = {},
): {
  port: SessionPort
  feedsSeen: Array<Record<string, SessionTensor>>
} {
  const feedsSeen: Array<Record<string, SessionTensor>> = []
  return {
    feedsSeen,
    port: {
      inputNames: opts.inputs ?? ['input_ids', 'attention_mask'],
      outputNames: outputs[0] === undefined ? [] : ['last_hidden_state'],
      async run(feeds) {
        feedsSeen.push(feeds)
        const next = outputs.shift()
        if (next === undefined) throw new Error('no scripted output')
        return { last_hidden_state: next }
      },
      release: async () => {},
    },
  }
}

describe('embedderOf', () => {
  it('pools last-token rows, normalizes, and respects the batch size', async () => {
    // One batch of 8 max: feed 2 texts, script one [2, 1, 2] output where the
    // attended vectors are [3,4] and [6,8] — unit length after normalization.
    const output: SessionTensor = {
      dims: [2, 1, 2],
      data: new Float32Array([3, 4, 6, 8]),
    }
    const { port, feedsSeen } = portOf([output])
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    const vectors = await embedder.embed(['a', 'b'], 'query')
    expect(vectors).toHaveLength(2)
    expect(vectors[0]![0]).toBeCloseTo(0.6, 6)
    expect(vectors[0]![1]).toBeCloseTo(0.8, 6)
    expect(vectors[1]![0]).toBeCloseTo(0.6, 6)
    // The feeds are int64 [batch, seq] with the prefix tokenized.
    const feeds = feedsSeen[0]!
    expect(feeds.input_ids!.dims).toEqual([2, feeds.input_ids!.dims[1]!])
    expect(feeds.input_ids!.data[0]).toBeGreaterThan(0n)
  })

  it('splits large request sets into EMBED_BATCH_SIZE runs', async () => {
    // The scripted encoder answers with the batch/seq the feeds asked for.
    const { port, feedsSeen } = portOf([{ dims: [0, 0, 2], data: new Float32Array(0) }])
    ;(port as { run: SessionPort['run'] }).run = async (feeds) => {
      feedsSeen.push(feeds)
      const [batch, seq] = feeds.input_ids!.dims
      return {
        last_hidden_state: {
          dims: [batch!, seq!, 2],
          data: new Float32Array(batch! * seq! * 2).fill(1),
        },
      }
    }
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    const texts = Array.from({ length: 20 }, (_, i) => `t${i}`)
    const vectors = await embedder.embed(texts, 'document')
    expect(vectors).toHaveLength(20)
    expect(feedsSeen).toHaveLength(3)
  })

  it('feeds token_type_ids when the encoder declares the input', async () => {
    const output: SessionTensor = { dims: [1, 1, 2], data: new Float32Array([1, 0]) }
    const { port, feedsSeen } = portOf([output], { inputs: ['input_ids', 'token_type_ids'] })
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await embedder.embed(['a'], 'document')
    expect(feedsSeen[0]!.token_type_ids).toBeDefined()
    expect(feedsSeen[0]!.attention_mask).toBeUndefined()
  })

  it('rejects an encoder whose outputs are neither pooled nor hidden states', () => {
    const bad: SessionPort = {
      inputNames: ['input_ids'],
      outputNames: ['logits'],
      run: async () => ({}),
      release: async () => {},
    }
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    expect(() => embedderOf(spec, tokenizerAdapter, bad, int64Tensor)).toThrow(
      /sentence_embedding or last_hidden_state/,
    )
  })

  it('rejects a hidden width that disagrees with the catalog dimension', async () => {
    const output: SessionTensor = { dims: [1, 1, 7], data: new Float32Array(7).fill(1) }
    const { port } = portOf([output])
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await expect(embedder.embed(['a'], 'query')).rejects.toThrow(/catalog dimension/)
  })
})
