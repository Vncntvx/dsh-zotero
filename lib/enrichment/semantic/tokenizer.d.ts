/**
 * Tokenization for local embedding models.
 *
 * The `@huggingface/tokenizers` runtime encodes but does not pad or truncate,
 * and an embedding model's input contract needs both: every row of a batch
 * shares one padded length, and nothing longer than the model's window may
 * reach the encoder. This module owns those two rules plus the query/document
 * instruction prefixes the catalog pins.
 *
 * The HF runtime is loaded lazily by {@link createEmbeddingTokenizer}, so the
 * dependency only loads when a model actually runs.
 * @module dsh-zotero/enrichment/semantic/tokenizer
 */
/** The slice of the HF tokenizer this module relies on; tests stub it. */
export interface TokenizerLike {
    encode(text: string, options?: {
        readonly add_special_tokens?: boolean;
    }): {
        readonly ids: number[];
        readonly attention_mask: number[];
    };
    token_to_id(token: string): number | undefined;
}
/** One padded batch: int64 tensors shaped `[batch, seq]`, ready for ONNX. */
export interface TokenizedBatch {
    readonly inputIds: BigInt64Array;
    readonly attentionMask: BigInt64Array;
    readonly batchSize: number;
    readonly sequenceLength: number;
}
/** Which side of a retrieval pair the text belongs to. */
export type EmbeddingSide = 'query' | 'document';
/** The tokenizer half of one loaded model. */
export interface EmbeddingTokenizer {
    /**
     * Tokenize, truncate to the model window, and pad a batch.
     * @param texts - the texts, in order.
     * @param side - which instruction prefix applies.
     */
    batch(texts: readonly string[], side: EmbeddingSide): TokenizedBatch;
}
/**
 * The minimal tokenizer config fields this module reads. `pad_token` is a
 * string in most exports and an object in others; both shapes occur.
 */
export interface TokenizerConfigLike {
    readonly pad_token?: string | {
        readonly content?: string;
    } | null;
    readonly pad_token_id?: number;
}
/**
 * The embedding tokenizer over one loaded HF tokenizer instance.
 * @param tokenizer - the HF tokenizer (already constructed from `tokenizer.json`).
 * @param config - the model's `tokenizer_config.json`, for the pad token.
 * @param spec - the catalog entry: window, prefixes.
 */
export declare function embeddingTokenizerOf(tokenizer: TokenizerLike, config: TokenizerConfigLike, spec: {
    readonly maxTokens: number;
    readonly queryPrefix: string;
    readonly documentPrefix: string;
}): EmbeddingTokenizer;
/**
 * Build the embedding tokenizer from the two on-disk JSON files.
 * @param tokenizerJson - parsed `tokenizer.json`.
 * @param tokenizerConfig - parsed `tokenizer_config.json`.
 * @param spec - the catalog entry: window, prefixes.
 */
export declare function createEmbeddingTokenizer(tokenizerJson: unknown, tokenizerConfig: unknown, spec: {
    readonly maxTokens: number;
    readonly queryPrefix: string;
    readonly documentPrefix: string;
}): Promise<EmbeddingTokenizer>;
//# sourceMappingURL=tokenizer.d.ts.map