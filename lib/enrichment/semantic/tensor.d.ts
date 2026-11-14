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
export type PoolingKind = 'cls' | 'mean' | 'last_token';
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
export declare function poolTokenEmbeddings(kind: PoolingKind, hidden: Float32Array, dim: number, seq: number, mask: ArrayLike<number>): Float32Array;
/**
 * Scale one vector to unit length, in place. Zero vectors are left alone: an
 * all-zero embedding is already a defined fact the ranker can score.
 * @param vector - the vector to normalize; mutated.
 * @returns the same buffer, normalized.
 */
export declare function l2NormalizeInPlace(vector: Float32Array): Float32Array;
/**
 * Cosine similarity of two equal-length, finite vectors. A mismatched width or
 * a non-finite component is a runtime/calibration error, not a reason to
 * silently truncate the longer vector or return a plausible number.
 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
//# sourceMappingURL=tensor.d.ts.map