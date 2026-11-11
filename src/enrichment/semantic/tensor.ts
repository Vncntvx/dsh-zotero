/**
 * Pure tensor math for local embeddings: pooling over token positions, L2
 * normalization, and cosine similarity.
 *
 * Everything operates on flat `Float32Array` buffers so the unit tests can
 * drive it with synthetic values and the session layer can feed ONNX outputs
 * straight in. No runtime dependency and no allocation beyond the pooled
 * vector.
 * @module dsh-zotero/enrichment/semantic/tensor
 */

/** How one `[seq, dim]` hidden state collapses into a single `[dim]` vector. */
export type PoolingKind = 'cls' | 'mean' | 'last_token'

/**
 * Pool one sequence's token embeddings into one vector.
 *
 * - `cls`: position 0, the sentence boundary token the sentence-transformers
 *   conventions designate.
 * - `mean`: the attention-masked mean, so padding never dilutes the result.
 * - `last_token`: the last attended position, what decoder-style embedding
 *   models (Qwen3) train against.
 * @param kind - the model's documented pooling.
 * @param hidden - the `[batch, seq, dim]` slice for one row, row-major.
 * @param dim - the hidden width.
 * @param seq - the padded sequence length of this batch.
 * @param mask - the row's attention mask (`1` attended, `0` padding).
 * @returns the pooled vector; a zero vector when nothing is attended.
 */
export function poolTokenEmbeddings(
  kind: PoolingKind,
  hidden: Float32Array,
  dim: number,
  seq: number,
  mask: ArrayLike<number>,
): Float32Array {
  const pooled = new Float32Array(dim)
  if (kind === 'cls') {
    for (let d = 0; d < dim; d += 1) pooled[d] = hidden[d]!
    return pooled
  }
  if (kind === 'last_token') {
    let last = -1
    for (let position = seq - 1; position >= 0; position -= 1) {
      if ((mask[position] ?? 0) !== 0) {
        last = position
        break
      }
    }
    if (last < 0) return pooled
    const base = last * dim
    for (let d = 0; d < dim; d += 1) pooled[d] = hidden[base + d]!
    return pooled
  }
  let attended = 0
  for (let position = 0; position < seq; position += 1) {
    if ((mask[position] ?? 0) === 0) continue
    attended += 1
    const base = position * dim
    for (let d = 0; d < dim; d += 1) pooled[d] += hidden[base + d]!
  }
  if (attended > 1) {
    for (let d = 0; d < dim; d += 1) pooled[d] /= attended
  }
  return pooled
}

/**
 * Scale one vector to unit length, in place. Zero vectors are left alone: an
 * all-zero embedding is already a defined fact the ranker can score.
 * @param vector - the vector to normalize; mutated.
 * @returns the same buffer, normalized.
 */
export function l2NormalizeInPlace(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * vector[i]!
  if (sum <= 0) return vector
  const scale = 1 / Math.sqrt(sum)
  for (let i = 0; i < vector.length; i += 1) vector[i] = vector[i]! * scale
  return vector
}

/**
 * Cosine similarity of two equal-length, finite vectors. A mismatched width or
 * a non-finite component is a runtime/calibration error, not a reason to
 * silently truncate the longer vector or return a plausible number.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(`embedding dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`non-finite embedding component at ${i}`)
    }
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  const result = dot / Math.sqrt(normA * normB)
  if (!Number.isFinite(result)) throw new RangeError('cosine produced a non-finite value')
  return result
}
