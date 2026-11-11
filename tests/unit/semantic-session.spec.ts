/**
 * The session layer's batching, pooling, and output-shape logic, driven
 * through a scripted `SessionPort`: the WASM session itself is only exercised
 * by the opt-in semantic-eval run against a real model.
 * @module tests/unit/semantic-session
 */

import { describe, expect, it } from 'vitest'
import { semanticModelOf } from '../../src/enrichment-model-catalog.ts'
import {
  cacheSpecOf,
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

  it('feeds position_ids and zero-length KV caches for decoder-style exports', async () => {
    const inputs = ['input_ids', 'attention_mask', 'position_ids']
    for (let layer = 0; layer < 2; layer += 1)
      for (const kind of ['key', 'value']) inputs.push(`past_key_values.${layer}.${kind}`)
    const { port, feedsSeen } = portOf(
      [{ dims: [1, 2, 2], data: new Float32Array([1, 0, 1, 0]) }],
      { inputs },
    )
    ;(port as { cacheSpec?: { kvHeads: number; headDim: number; layers: number } }).cacheSpec = {
      kvHeads: 8,
      headDim: 128,
      layers: 2,
    }
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await embedder.embed(['ab'], 'query')
    const feeds = feedsSeen[0]!
    expect(feeds.position_ids!.data[1]).toBe(1n)
    const cache = feeds['past_key_values.1.value']!
    expect(cache.dims).toEqual([1, 8, 0, 128])
    expect(cache.data).toBeInstanceOf(Float32Array)
    expect((cache.data as Float32Array).length).toBe(0)
  })

  it('derives the KV-cache contract from the ONNX inputs and config.json', () => {
    const cacheInputs = ['input_ids', 'past_key_values.0.key']
    // Qwen3 shape: explicit head count, head dim and layer count.
    expect(
      cacheSpecOf(cacheInputs, {
        num_key_value_heads: 8,
        num_hidden_layers: 28,
        head_dim: 128,
      }),
    ).toEqual({ kvHeads: 8, headDim: 128, layers: 28 })
    // Models that omit head_dim derive it from hidden_size / heads.
    expect(
      cacheSpecOf(cacheInputs, {
        num_hidden_layers: 12,
        hidden_size: 768,
        num_attention_heads: 12,
      }),
    ).toEqual({ kvHeads: 1, headDim: 64, layers: 12 })
    // A plain encoder declares no cache inputs at all.
    expect(cacheSpecOf(['input_ids', 'attention_mask'], {})).toBeUndefined()
    // Declaring cache inputs without usable dimensions is a hard error.
    expect(() => cacheSpecOf(cacheInputs, { num_hidden_layers: 4 })).toThrow(
      /declares a KV cache but config.json omits its dimensions/,
    )
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

  it('tokenizes each batch exactly once for feeds and pooling masks', async () => {
    let batches = 0
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const originalBatch = tokenizerAdapter.batch.bind(tokenizerAdapter)
    tokenizerAdapter.batch = ((texts, side) => {
      batches += 1
      return originalBatch(texts, side)
    }) as typeof tokenizerAdapter.batch
    const { port } = portOf([{ dims: [0, 0, 2], data: new Float32Array(0) }])
    ;(port as { run: SessionPort['run'] }).run = async (feeds) => {
      const [rows, seq] = feeds.input_ids!.dims
      return {
        last_hidden_state: {
          dims: [rows!, seq!, 2],
          data: new Float32Array(rows! * seq! * 2).fill(1),
        },
      }
    }
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await embedder.embed(['a', 'b', 'c'], 'query')
    expect(batches).toBe(1)
  })

  it('does not start the next batch after cancellation', async () => {
    const { port, feedsSeen } = portOf([{ dims: [0, 0, 2], data: new Float32Array(0) }])
    const controller = new AbortController()
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    ;(port as { run: SessionPort['run'] }).run = async (feeds, signal) => {
      feedsSeen.push(feeds)
      const [rows, seq] = feeds.input_ids!.dims
      // The first run lets cancellation arrive before the check after it.
      controller.abort(new Error('stop'))
      signal?.throwIfAborted()
      return {
        last_hidden_state: {
          dims: [rows!, seq!, 2],
          data: new Float32Array(rows! * seq! * 2).fill(1),
        },
      }
    }
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await expect(
      embedder.embed(
        Array.from({ length: 20 }, (_, i) => `t${i}`),
        'query',
        controller.signal,
      ),
    ).rejects.toThrow('stop')
    expect(feedsSeen).toHaveLength(1)
  })

  it('rejects a malformed tensor instead of returning a plausible vector', async () => {
    const { port } = portOf([{ dims: [1, 1, 2], data: new Float32Array([Number.NaN, 1]) }])
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await expect(embedder.embed(['a'], 'query')).rejects.toThrow(/non-finite/)
  })

  it('rejects a short buffer that disagrees with the declared shape', async () => {
    const { port } = portOf([{ dims: [1, 1, 2], data: new Float32Array([1]) }])
    const tokenizerAdapter = embeddingTokenizerOf(tokenizer, { pad_token: '<|endoftext|>' }, spec)
    const embedder = embedderOf(spec, tokenizerAdapter, port, int64Tensor)
    await expect(embedder.embed(['a'], 'query')).rejects.toThrow(/shorter than its declared shape/)
  })
})
