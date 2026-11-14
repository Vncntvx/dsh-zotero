/**
 * Static catalog of supported local semantic embedding models and download sources.
 *
 * Models are addressed by stable semantic tier keys, so user configuration
 * keys stay unchanged when physical model versions are upgraded or replaced:
 * - `balanced`: General-purpose balanced retrieval (Qwen3-Embedding-0.6B, default).
 * - `lightweight`: Lightweight CPU execution (IBM Granite 97M ModernBERT).
 * - `bilingual`: Bilingual Chinese/English research literature (KaLM-Embedding V2.5 0.5B).
 * - `english`: English technical & academic long-context (Nomic Embed 137M).
 * - `hybrid`: Dense/sparse multi-vector academic retrieval (BAAI BGE-M3).
 * - `academic`: Standard 768-dim multilingual baseline (Alibaba GTE Multilingual Base).
 *
 * Shipped as a pure module allowlisted for browser and node import.
 * @module dsh-zotero/enrichment-model-catalog
 */
export declare const SEMANTIC_MODEL_KEYS: readonly ['balanced', 'lightweight', 'bilingual', 'english', 'hybrid', 'academic'];
export type SemanticModelKey = (typeof SEMANTIC_MODEL_KEYS)[number];
export declare const DEFAULT_SEMANTIC_MODEL: SemanticModelKey;
export declare const DEFAULT_SEMANTIC_MODEL_ROOT = "~/.dsh/models";
export declare const SEMANTIC_DOWNLOAD_SOURCES: readonly ['hf-mirror', 'huggingface'];
export type SemanticDownloadSource = (typeof SEMANTIC_DOWNLOAD_SOURCES)[number];
export declare const DEFAULT_SEMANTIC_DOWNLOAD_SOURCE: SemanticDownloadSource;
export interface SemanticModelFileEntry {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface SemanticModelEntry {
    /** Stable semantic tier key used in user configuration. */
    readonly key: SemanticModelKey;
    /** Underlying physical model identifier (used for disk directories). */
    readonly physicalKey: string;
    /** Human-readable display label. */
    readonly label: string;
    /** Underlying model name for display. */
    readonly physicalModel: string;
    /** Human-facing summary of architecture, scope, and trade-offs. */
    readonly note: string;
    /** Upstream repository id on Hugging Face / HF-Mirror. */
    readonly modelId: string;
    /** Upstream commit revision for reproducible downloads. */
    readonly revision: string;
    /** Output vector dimensionality. */
    readonly dimension: number;
    /** Hard context window ceiling. */
    readonly maxTokens: number;
    /** Supported languages. */
    readonly languages: readonly string[];
    /** Upstream license. */
    readonly license: string;
    /**
     * Pooling over the token embeddings the encoder returns, verified for every
     * entry against the upstream `1_Pooling/config.json`.
     */
    readonly pooling: 'cls' | 'mean' | 'last_token';
    /** Whether the pooled vector is L2-normalized before cosine scoring. */
    readonly normalize: boolean;
    /**
     * Instruction prefix applied before tokenizing a query; empty when the model
     * documents no instruction. Taken from the upstream model card, never
     * invented: Qwen3 and KaLM are instruct models, Nomic requires task prefixes.
     */
    readonly queryPrefix: string;
    /** Instruction prefix applied before tokenizing a document/passage. */
    readonly documentPrefix: string;
    /** Pinned asset files. */
    readonly files: readonly SemanticModelFileEntry[];
}
export type SemanticModelSpec = SemanticModelEntry;
export declare const SEMANTIC_MODELS: readonly SemanticModelEntry[];
export declare function isSemanticModelKey(value: unknown): value is SemanticModelKey;
export declare function isSemanticDownloadSource(value: unknown): value is SemanticDownloadSource;
export declare function semanticModelBytes(model: SemanticModelEntry): number;
export declare function semanticModelOf(key: string): SemanticModelEntry;
export declare function allSemanticModels(): readonly SemanticModelEntry[];
/**
 * The on-disk commit marker written after a bundle is fully downloaded.
 *
 * The manifest records the installed bytes against the catalog. A status check
 * compares them, and the loader refuses a bundle whose manifest disagrees. It
 * also carries the inference metadata needed to run the model.
 */
export interface SemanticModelManifest {
    readonly schema: 2;
    readonly key: SemanticModelKey;
    readonly physicalKey: string;
    readonly modelId: string;
    readonly revision: string;
    readonly dimension: number;
    readonly maxTokens: number;
    readonly pooling: 'cls' | 'mean' | 'last_token';
    readonly normalize: boolean;
    readonly queryPrefix: string;
    readonly documentPrefix: string;
    readonly files: Readonly<Record<string, {
        readonly bytes: number;
        readonly sha256: string;
    }>>;
}
/** Build the manifest one bundle must carry, from the catalog alone. */
export declare function manifestOf(model: SemanticModelEntry): SemanticModelManifest;
//# sourceMappingURL=enrichment-model-catalog.d.ts.map