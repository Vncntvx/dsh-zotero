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
import { join } from 'node:path';
import { EMBED_BATCH_SIZE } from './batching.js';
import { createEmbeddingTokenizer } from './tokenizer.js';
import { l2NormalizeInPlace, poolTokenEmbeddings } from './tensor.js';
/** How many texts go through the encoder per run; the cache batches to the same size. */
export { EMBED_BATCH_SIZE };
function outputShapeOf(outputNames) {
    if (outputNames.includes('sentence_embedding') || outputNames.includes('embeddings')) {
        return 'pooled';
    }
    if (outputNames.includes('last_hidden_state'))
        return 'hidden';
    throw new TypeError(`unsupported encoder outputs [${outputNames.join(', ')}]; expected sentence_embedding or last_hidden_state`);
}
/** One tokenization drives both the feeds and the pooling masks. */
function feedsAndMasksOf(session, tokenizer, texts, side, int64Tensor) {
    const batch = tokenizer.batch(texts, side);
    const dims = [batch.batchSize, batch.sequenceLength];
    const feeds = {};
    const has = (name) => session.inputNames.includes(name);
    if (has('input_ids'))
        feeds.input_ids = int64Tensor(dims, batch.inputIds);
    if (has('attention_mask'))
        feeds.attention_mask = int64Tensor(dims, batch.attentionMask);
    if (has('token_type_ids'))
        feeds.token_type_ids = int64Tensor(dims, new BigInt64Array(batch.inputIds.length));
    if (has('position_ids')) {
        // Causal decoder exports need the position of every token. Padding
        // positions keep a valid index so the graph has no out-of-range gather.
        const positions = new BigInt64Array(batch.inputIds.length);
        for (let row = 0; row < batch.batchSize; row += 1) {
            for (let column = 0; column < batch.sequenceLength; column += 1) {
                positions[row * batch.sequenceLength + column] = BigInt(column);
            }
        }
        feeds.position_ids = int64Tensor(dims, positions);
    }
    if (session.cacheSpec !== undefined) {
        const { kvHeads, headDim, layers } = session.cacheSpec;
        const empty = new Float32Array(0);
        for (let layer = 0; layer < layers; layer += 1) {
            for (const kind of ['key', 'value']) {
                const name = `past_key_values.${layer}.${kind}`;
                if (has(name)) {
                    feeds[name] = {
                        dims: [batch.batchSize, kvHeads, 0, headDim],
                        data: empty,
                    };
                }
            }
        }
    }
    const masks = [];
    for (let row = 0; row < batch.batchSize; row += 1) {
        masks.push(batch.attentionMask.slice(row * batch.sequenceLength, (row + 1) * batch.sequenceLength));
    }
    return { feeds, batch, masks };
}
function finiteData(output) {
    if (!(output.data instanceof Float32Array)) {
        throw new TypeError('encoder output is not a float32 tensor');
    }
    const data = output.data;
    for (let i = 0; i < data.length; i += 1) {
        if (!Number.isFinite(data[i]))
            throw new RangeError(`non-finite output component at ${i}`);
    }
    return data;
}
function rowsOf(output, shape, spec, batch, masks, expectedRows) {
    const { dims } = output;
    if (shape === 'pooled') {
        if (dims.length !== 2 || dims[0] !== expectedRows || dims[1] !== spec.dimension) {
            throw new TypeError(`encoder returned dims [${dims.join(', ')}]; expected [${expectedRows}, ${spec.dimension}]`);
        }
        const data = finiteData(output);
        if (data.length < dims[0] * spec.dimension) {
            throw new TypeError('encoder pooled buffer is shorter than its declared shape');
        }
        const rows = [];
        for (let row = 0; row < dims[0]; row += 1) {
            const vector = data.slice(row * spec.dimension, (row + 1) * spec.dimension);
            rows.push(spec.normalize ? l2NormalizeInPlace(vector) : vector);
        }
        return rows;
    }
    if (dims.length !== 3) {
        throw new TypeError(`encoder hidden state has rank ${dims.length}; expected 3`);
    }
    const [rows, seq, dim] = dims;
    if (dim !== spec.dimension) {
        throw new TypeError(`encoder hidden width ${dim} does not match catalog dimension ${spec.dimension}`);
    }
    if (seq !== batch.sequenceLength || rows !== expectedRows || rows !== masks.length) {
        throw new TypeError(`encoder returned [${rows}, ${seq}] for a batch of ${expectedRows} × ${batch.sequenceLength}`);
    }
    const data = finiteData(output);
    if (data.length < rows * seq * dim) {
        throw new TypeError('encoder hidden buffer is shorter than its declared shape');
    }
    const vectors = [];
    for (let row = 0; row < rows; row += 1) {
        const base = row * seq * dim;
        const slice = data.subarray(base, base + seq * dim);
        const maskRow = [...masks[row]].map((value) => (value === 0n ? 0 : 1));
        const pooled = poolTokenEmbeddings(spec.pooling, slice, dim, seq, maskRow);
        if (pooled.length !== spec.dimension) {
            throw new TypeError(`pooled vector width ${pooled.length} does not match the catalog`);
        }
        vectors.push(spec.normalize ? l2NormalizeInPlace(pooled) : pooled);
    }
    return vectors;
}
/**
 * The embedder over an open session. Batching, pooling, and normalization
 * live here; the session port only runs feeds.
 */
export function embedderOf(spec, tokenizer, session, int64Tensor) {
    const shape = outputShapeOf(session.outputNames);
    const outputName = shape === 'pooled'
        ? (session.outputNames.find((n) => n === 'sentence_embedding') ??
            session.outputNames.find((n) => n === 'embeddings'))
        : 'last_hidden_state';
    return {
        dimension: spec.dimension,
        async embed(texts, side, signal) {
            signal?.throwIfAborted();
            const vectors = [];
            for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
                signal?.throwIfAborted();
                const slice = texts.slice(start, start + EMBED_BATCH_SIZE);
                // One tokenization per batch: feeds and pooling masks share it.
                const { feeds, batch, masks } = feedsAndMasksOf(session, tokenizer, slice, side, int64Tensor);
                signal?.throwIfAborted();
                const outputs = await session.run(feeds, signal);
                // A WASM run already in flight is allowed to finish; the next batch
                // must not start after cancellation.
                signal?.throwIfAborted();
                const output = outputs[outputName];
                if (output === undefined) {
                    throw new TypeError(`encoder produced no ${outputName} output`);
                }
                const rows = rowsOf(output, shape, spec, batch, masks, slice.length);
                if (rows.length !== slice.length) {
                    throw new TypeError(`encoder produced ${rows.length} vectors for ${slice.length} texts`);
                }
                vectors.push(...rows);
            }
            if (vectors.length !== texts.length) {
                throw new TypeError(`encoder produced ${vectors.length} vectors for ${texts.length} texts`);
            }
            return vectors;
        },
        async dispose() {
            await session.release();
        },
    };
}
/**
 * Derive the KV-cache feed contract from the ONNX input names and the model's
 * `config.json`. Returns `undefined` for plain encoders. A decoder export that
 * declares cache inputs but omits the dimensions is a hard error: guessing
 * would produce a silently wrong tensor shape.
 * @param inputNames - the session's declared input tensor names.
 * @param config - the bundle's parsed `config.json`.
 */
export function cacheSpecOf(inputNames, config) {
    if (!inputNames.some((name) => name.startsWith('past_key_values.')))
        return undefined;
    const kvHeads = config.num_key_value_heads;
    const hiddenSize = config.hidden_size;
    const attentionHeads = config.num_attention_heads;
    const headDim = config.head_dim;
    const layers = config.num_hidden_layers;
    const spec = {
        kvHeads: typeof kvHeads === 'number' ? kvHeads : 1,
        headDim: typeof headDim === 'number'
            ? headDim
            : typeof hiddenSize === 'number' && typeof attentionHeads === 'number'
                ? hiddenSize / attentionHeads
                : 0,
        layers: typeof layers === 'number' ? layers : 0,
    };
    if (spec.headDim <= 0 || spec.layers <= 0) {
        throw new TypeError('the encoder declares a KV cache but config.json omits its dimensions');
    }
    return spec;
}
/**
 * Open the real WASM session for one verified bundle. Ownership of the ONNX
 * session transfers to this function: any failure after creation releases it
 * exactly once, and a release failure never masks the original error.
 * @param spec - the verified catalog entry.
 * @param dir - the bundle directory (already verified on disk).
 */
export async function openEmbedder(spec, dir) {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.logLevel = 'error';
    const session = await ort.InferenceSession.create(join(dir, 'onnx', 'model_quantized.onnx'), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
    });
    let released = false;
    const release = async () => {
        if (released)
            return;
        released = true;
        await session.release();
    };
    try {
        const { readJsonFile } = await import('./bundle.js');
        const config = (await readJsonFile(join(dir, 'config.json')));
        const cacheSpec = cacheSpecOf(session.inputNames, config);
        const port = {
            inputNames: session.inputNames,
            outputNames: session.outputNames,
            ...(cacheSpec === undefined ? {} : { cacheSpec }),
            async run(feeds) {
                const tensorFeeds = {};
                for (const [name, tensor] of Object.entries(feeds)) {
                    const isFloat = tensor.data instanceof Float32Array;
                    tensorFeeds[name] = new ort.Tensor(isFloat ? 'float32' : 'int64', tensor.data, [...tensor.dims]);
                }
                const outputs = await session.run(tensorFeeds);
                const result = {};
                for (const [name, tensor] of Object.entries(outputs)) {
                    result[name] = { dims: tensor.dims, data: tensor.data };
                }
                return result;
            },
            release,
        };
        const int64Tensor = (dims, data) => ({ dims, data });
        const tokenizer = await createEmbeddingTokenizer(await readJsonFile(join(dir, 'tokenizer.json')), await readJsonFile(join(dir, 'tokenizer_config.json')), spec);
        return embedderOf(spec, tokenizer, port, int64Tensor);
    }
    catch (error) {
        // Ownership transfer: the session is ours to release on every failure
        // after creation. A release failure must not replace the original error.
        await release().catch(() => undefined);
        throw error;
    }
}
//# sourceMappingURL=session.js.map