/**
 * The ONNX inference session for one local embedding model.
 *
 * The runtime is `onnxruntime-web` executing its WASM backend inside Node:
 * portable across platforms, no native addon, no install scripts. The module
 * is loaded lazily, the session is created once per model, and `dispose`
 * releases it. Inference metadata (pooling, normalization, dimension) comes
 * from the catalog entry the bundle was verified against.
 *
 * The session talks to ONNX through the narrow {@link SessionPort} seam so the
 * batching, pooling, and normalization logic is unit-testable without WASM.
 * @module dsh-zotero/enrichment/semantic/session
 */

import { join } from 'node:path'
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js'
import type { EmbeddingSide, EmbeddingTokenizer } from './tokenizer.js'
import { createEmbeddingTokenizer } from './tokenizer.js'
import { l2NormalizeInPlace, poolTokenEmbeddings } from './tensor.js'

/** How many texts go through the encoder per run. */
export const EMBED_BATCH_SIZE = 8

/** One ONNX tensor as the session logic sees it. */
export interface SessionTensor {
  readonly dims: readonly number[]
  readonly data: Float32Array | BigInt64Array
}

/** The slice of an ONNX session the embedder needs. */
export interface SessionPort {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Readonly<Record<string, SessionTensor>>): Promise<Record<string, SessionTensor>>
  release(): Promise<void>
}

/** Build an int64 tensor from padded ids/masks. */
export type Int64TensorFactory = (dims: readonly number[], data: BigInt64Array) => SessionTensor

/** The embedder half of one loaded model. */
export interface Embedder {
  readonly dimension: number
  /**
   * Embed texts with the side's instruction prefix, in input order.
   * @param texts - the texts to embed.
   * @param side - which prefix applies.
   */
  embed(texts: readonly string[], side: EmbeddingSide): Promise<Float32Array[]>
  /** Release the ONNX session; the embedder is unusable afterwards. */
  dispose(): Promise<void>
}

/** Which output tensor an encoder emits, decided once from the output names. */
type OutputShape = 'pooled' | 'hidden'

function outputShapeOf(outputNames: readonly string[]): OutputShape {
  if (outputNames.includes('sentence_embedding') || outputNames.includes('embeddings')) {
    return 'pooled'
  }
  if (outputNames.includes('last_hidden_state')) return 'hidden'
  throw new TypeError(
    `unsupported encoder outputs [${outputNames.join(', ')}]; expected sentence_embedding or last_hidden_state`,
  )
}

function feedsOf(
  session: SessionPort,
  tokenizer: EmbeddingTokenizer,
  texts: readonly string[],
  side: EmbeddingSide,
  int64Tensor: Int64TensorFactory,
): Record<string, SessionTensor> {
  const batch = tokenizer.batch(texts, side)
  const dims = [batch.batchSize, batch.sequenceLength]
  const feeds: Record<string, SessionTensor> = {}
  const has = (name: string): boolean => session.inputNames.includes(name)
  if (has('input_ids')) feeds.input_ids = int64Tensor(dims, batch.inputIds)
  if (has('attention_mask')) feeds.attention_mask = int64Tensor(dims, batch.attentionMask)
  if (has('token_type_ids'))
    feeds.token_type_ids = int64Tensor(dims, new BigInt64Array(batch.inputIds.length))
  return feeds
}

function rowsOf(
  session: SessionPort,
  output: SessionTensor,
  shape: OutputShape,
  spec: SemanticModelEntry,
  sequenceLength: number,
  masks: readonly BigInt64Array[],
): Float32Array[] {
  if (shape === 'pooled') {
    if (output.dims.length !== 2 || output.dims[1] !== spec.dimension) {
      throw new TypeError(
        `encoder returned dims [${output.dims.join(', ')}]; expected [n, ${spec.dimension}]`,
      )
    }
    const data = output.data as Float32Array
    const rows: Float32Array[] = []
    for (let row = 0; row < output.dims[0]!; row += 1) {
      const vector = data.slice(row * spec.dimension, (row + 1) * spec.dimension)
      rows.push(spec.normalize ? l2NormalizeInPlace(vector) : vector)
    }
    return rows
  }
  const [batch, seq, dim] = output.dims as [number, number, number]
  if (dim !== spec.dimension) {
    throw new TypeError(
      `encoder hidden width ${dim} does not match catalog dimension ${spec.dimension}`,
    )
  }
  if (seq !== sequenceLength || batch !== masks.length) {
    throw new TypeError(
      `encoder returned [${batch}, ${seq}] for a batch of ${masks.length} × ${sequenceLength}`,
    )
  }
  const data = output.data as Float32Array
  const rows: Float32Array[] = []
  for (let row = 0; row < batch; row += 1) {
    const base = row * seq * dim
    const slice = data.subarray(base, base + seq * dim)
    const maskRow = [...masks[row]!].map((value) => (value === 0n ? 0 : 1))
    const pooled = poolTokenEmbeddings(spec.pooling, slice, dim, seq, maskRow)
    rows.push(spec.normalize ? l2NormalizeInPlace(pooled) : pooled)
  }
  return rows
}

function masksOf(
  tokenizer: EmbeddingTokenizer,
  texts: readonly string[],
  side: EmbeddingSide,
): { batch: ReturnType<EmbeddingTokenizer['batch']>; masks: BigInt64Array[] } {
  const batch = tokenizer.batch(texts, side)
  const masks: BigInt64Array[] = []
  for (let row = 0; row < batch.batchSize; row += 1) {
    masks.push(
      batch.attentionMask.slice(row * batch.sequenceLength, (row + 1) * batch.sequenceLength),
    )
  }
  return { batch, masks }
}

/**
 * The embedder over an open session. Batching, pooling, and normalization
 * live here; the session port only runs feeds.
 */
export function embedderOf(
  spec: SemanticModelEntry,
  tokenizer: EmbeddingTokenizer,
  session: SessionPort,
  int64Tensor: Int64TensorFactory,
): Embedder {
  const shape = outputShapeOf(session.outputNames)
  const outputName =
    shape === 'pooled'
      ? (session.outputNames.find((n) => n === 'sentence_embedding') ??
        session.outputNames.find((n) => n === 'embeddings')!)
      : 'last_hidden_state'
  return {
    dimension: spec.dimension,
    async embed(texts, side) {
      const vectors: Float32Array[] = []
      for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
        const slice = texts.slice(start, start + EMBED_BATCH_SIZE)
        const { masks } = masksOf(tokenizer, slice, side)
        const feeds = feedsOf(session, tokenizer, slice, side, int64Tensor)
        const outputs = await session.run(feeds)
        const output = outputs[outputName]
        if (output === undefined) {
          throw new TypeError(`encoder produced no ${outputName} output`)
        }
        const sequenceLength = feeds.input_ids?.dims[1] ?? 0
        vectors.push(...rowsOf(session, output, shape, spec, sequenceLength, masks))
      }
      return vectors
    },
    async dispose() {
      await session.release()
    },
  }
}

/**
 * Open the real WASM session for one verified bundle. The ONNX runtime and the
 * tokenizer runtime are loaded here, once, on first use.
 * @param spec - the verified catalog entry.
 * @param dir - the bundle directory (already verified on disk).
 */
export async function openEmbedder(spec: SemanticModelEntry, dir: string): Promise<Embedder> {
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.logLevel = 'error'
  const session = await ort.InferenceSession.create(join(dir, 'onnx', 'model_quantized.onnx'), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const port: SessionPort = {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds) {
      const tensorFeeds: Record<string, InstanceType<typeof ort.Tensor>> = {}
      for (const [name, tensor] of Object.entries(feeds)) {
        tensorFeeds[name] = new ort.Tensor('int64', tensor.data as BigInt64Array, [...tensor.dims])
      }
      const outputs = await session.run(tensorFeeds)
      const result: Record<string, SessionTensor> = {}
      for (const [name, tensor] of Object.entries(outputs)) {
        result[name] = { dims: tensor.dims, data: tensor.data as Float32Array | BigInt64Array }
      }
      return result
    },
    async release() {
      await session.release()
    },
  }
  const int64Tensor: Int64TensorFactory = (dims, data) => ({ dims, data })
  const { readJsonFile } = await import('./bundle.js')
  const tokenizer = await createEmbeddingTokenizer(
    await readJsonFile(join(dir, 'tokenizer.json')),
    await readJsonFile(join(dir, 'tokenizer_config.json')),
    spec,
  )
  return embedderOf(spec, tokenizer, port, int64Tensor)
}
