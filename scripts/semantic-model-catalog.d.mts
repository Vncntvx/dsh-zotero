/**
 * Types for `scripts/semantic-model-catalog.mjs`, the build-time mirror of
 * `src/enrichment-model-catalog.ts`. The unit spec asserts the two carry the
 * same data, so this surface only needs to describe the shape.
 * @module dsh-zotero/scripts/semantic-model-catalog
 */

/** One pinned file inside a model bundle. */
export interface SemanticModelFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/** One selectable local model and the exact bytes it requires. */
export interface SemanticModelSpec {
  readonly key: string
  readonly physicalKey: string
  readonly label: string
  readonly physicalModel: string
  readonly note: string
  readonly modelId: string
  readonly revision: string
  readonly dimension: number
  readonly maxTokens: number
  readonly languages: readonly string[]
  readonly license: string
  readonly files: readonly SemanticModelFile[]
}

export declare const SEMANTIC_MODELS: readonly SemanticModelSpec[]
export declare const DEFAULT_SEMANTIC_MODEL: string
export declare const DEFAULT_SEMANTIC_MODEL_ROOT: string
export declare const SEMANTIC_MODEL_KEYS: readonly string[]
export declare const SEMANTIC_DOWNLOAD_SOURCES: readonly string[]
export declare const DEFAULT_SEMANTIC_DOWNLOAD_SOURCE: string
export declare function semanticModelBytes(model: SemanticModelSpec): number
export declare function semanticModelOf(key: string): SemanticModelSpec
