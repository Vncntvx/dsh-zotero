/**
 * The ONNX inference session for one local embedding model.
 *
 * The runtime is `onnxruntime-web` executing its WASM backend inside Node:
 * portable across platforms, no native addon, no install scripts. The module
 * is loaded lazily, the session is created once per model, and `dispose`
 * releases it. Inference metadata (pooling, normalization, dimension) comes
 * from the catalog entry the bundle was verified against.
 *
 * Each batch is tokenized exactly once: one `TokenizedBatch` feeds both the
 * encoder inputs and the pooling masks. A caller `AbortSignal` is checked
 * before tokenizing and before/after every WASM run; an already executing run
 * is allowed to finish (WASM cannot be preempted), but no later batch starts.
 * Output tensors are validated for rank, shape, buffer length, finite values
 * and vector count before any cosine is computed.
 * @module dsh-zotero/enrichment/semantic/session
 */
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js';
import { EMBED_BATCH_SIZE } from './batching.js';
import type { EmbeddingSide, EmbeddingTokenizer } from './tokenizer.js';
/** How many texts go through the encoder per run; the cache batches to the same size. */
export { EMBED_BATCH_SIZE };
/** One ONNX tensor as the session logic sees it. */
export interface SessionTensor {
    readonly dims: readonly number[];
    readonly data: Float32Array | BigInt64Array;
}
/**
 * An explicit KV-cache input the encoder expects. Decoder-style ONNX exports
 * (Qwen3) need one zero-length `[batch, kvHeads, 0, headDim]` tensor per layer,
 * plus `position_ids`. The values come from the bundle's `config.json`, never
 * from a hardcoded guess.
 */
export interface CacheInputSpec {
    readonly kvHeads: number;
    readonly headDim: number;
    readonly layers: number;
}
/** The slice of an ONNX session the embedder needs. */
export interface SessionPort {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    /** Present only when the export declares explicit `past_key_values.*` inputs. */
    readonly cacheSpec?: CacheInputSpec;
    run(feeds: Readonly<Record<string, SessionTensor>>, signal?: AbortSignal): Promise<Record<string, SessionTensor>>;
    release(): Promise<void>;
}
/** Build an int64 tensor from padded ids/masks. */
export type Int64TensorFactory = (dims: readonly number[], data: BigInt64Array) => SessionTensor;
/** The embedder half of one loaded model. */
export interface Embedder {
    readonly dimension: number;
    /**
     * Embed texts with the side's instruction prefix, in input order.
     * @param texts - the texts to embed.
     * @param side - which prefix applies.
     * @param signal - caller cancellation; checked between batches.
     */
    embed(texts: readonly string[], side: EmbeddingSide, signal?: AbortSignal): Promise<Float32Array[]>;
    /** Release the ONNX session; the embedder is unusable afterwards. */
    dispose(): Promise<void>;
}
/**
 * The embedder over an open session. Batching, pooling, and normalization
 * live here; the session port only runs feeds.
 */
export declare function embedderOf(spec: SemanticModelEntry, tokenizer: EmbeddingTokenizer, session: SessionPort, int64Tensor: Int64TensorFactory): Embedder;
/**
 * Derive the KV-cache feed contract from the ONNX input names and the model's
 * `config.json`. Returns `undefined` for plain encoders. A decoder export that
 * declares cache inputs but omits the dimensions is a hard error: guessing
 * would produce a silently wrong tensor shape.
 * @param inputNames - the session's declared input tensor names.
 * @param config - the bundle's parsed `config.json`.
 */
export declare function cacheSpecOf(inputNames: readonly string[], config: Readonly<Record<string, unknown>>): CacheInputSpec | undefined;
/**
 * Open the real WASM session for one verified bundle. Ownership of the ONNX
 * session transfers to this function: any failure after creation releases it
 * exactly once, and a release failure never masks the original error.
 * @param spec - the verified catalog entry.
 * @param dir - the bundle directory (already verified on disk).
 */
export declare function openEmbedder(spec: SemanticModelEntry, dir: string): Promise<Embedder>;
//# sourceMappingURL=session.d.ts.map