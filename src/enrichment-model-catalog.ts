/**
 * Static catalog of supported local semantic embedding models and download sources.
 *
 * Models are addressed via stable, semantic tier identifiers to decouple user
 * configuration from specific physical model versions. When underlying models
 * are upgraded or replaced, user configuration keys remain unchanged:
 * - `balanced`: General-purpose balanced retrieval (Qwen3-Embedding-0.6B, default).
 * - `lightweight`: Ultra-lightweight CPU execution (IBM Granite 97M ModernBERT).
 * - `bilingual`: Bilingual Chinese/English research literature (KaLM-Embedding V2.5 0.5B).
 * - `english`: English technical & academic long-context (Nomic Embed 137M).
 * - `hybrid`: Dense/sparse multi-vector academic retrieval (BAAI BGE-M3).
 * - `academic`: Standard 768-dim multilingual baseline (Alibaba GTE Multilingual Base).
 *
 * Shipped as a pure module allowlisted for browser and node import.
 * @module dsh-zotero/enrichment-model-catalog
 */

export const SEMANTIC_MODEL_KEYS = [
  'balanced',
  'lightweight',
  'bilingual',
  'english',
  'hybrid',
  'academic',
] as const

export type SemanticModelKey = (typeof SEMANTIC_MODEL_KEYS)[number]

export const DEFAULT_SEMANTIC_MODEL: SemanticModelKey = 'balanced'
export const DEFAULT_SEMANTIC_MODEL_ROOT = '~/.dsh/models'

export const SEMANTIC_DOWNLOAD_SOURCES = ['hf-mirror', 'huggingface'] as const

export type SemanticDownloadSource = (typeof SEMANTIC_DOWNLOAD_SOURCES)[number]

export const DEFAULT_SEMANTIC_DOWNLOAD_SOURCE: SemanticDownloadSource = 'hf-mirror'

export interface SemanticModelFileEntry {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface SemanticModelEntry {
  /** Stable semantic tier key used in user configuration. */
  readonly key: SemanticModelKey
  /** Underlying physical model identifier (used for disk directories). */
  readonly physicalKey: string
  /** Human-readable display label. */
  readonly label: string
  /** Underlying model name for display. */
  readonly physicalModel: string
  /** Human-facing summary of architecture, scope, and trade-offs. */
  readonly note: string
  /** Upstream repository id on Hugging Face / HF-Mirror. */
  readonly modelId: string
  /** Upstream commit revision for reproducible downloads. */
  readonly revision: string
  /** Output vector dimensionality. */
  readonly dimension: number
  /** Hard context window ceiling. */
  readonly maxTokens: number
  /** Supported languages. */
  readonly languages: readonly string[]
  /** Upstream license. */
  readonly license: string
  /**
   * Pooling over the token embeddings the encoder returns. Verified against
   * the upstream `1_Pooling/config.json` for every entry, because a wrong
   * pooling silently degrades recall without an error.
   */
  readonly pooling: 'cls' | 'mean' | 'last_token'
  /** Whether the pooled vector is L2-normalized before cosine scoring. */
  readonly normalize: boolean
  /**
   * Instruction prefix applied before tokenizing a query; empty when the model
   * documents no instruction. Taken from the upstream model card, never
   * invented: Qwen3 and KaLM are instruct models, Nomic requires task prefixes.
   */
  readonly queryPrefix: string
  /** Instruction prefix applied before tokenizing a document/passage. */
  readonly documentPrefix: string
  /** Pinned asset files. */
  readonly files: readonly SemanticModelFileEntry[]
}

export type SemanticModelSpec = SemanticModelEntry

const CATALOG: Record<SemanticModelKey, SemanticModelEntry> = {
  balanced: {
    key: 'balanced',
    physicalKey: 'qwen3-0.6b',
    label: '通用平衡型 (balanced · Qwen3-0.6B)',
    physicalModel: 'Qwen3-Embedding-0.6B',
    note: 'General-purpose 0.6B embedding model with 1024 dimensions and 32K context. Strong Chinese semantic matching; recommended default.',
    modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    revision: 'c25a394dd583836952667c12f008335071b3f43d',
    dimension: 1024,
    maxTokens: 32768,
    languages: ['*'],
    license: 'Apache-2.0',
    pooling: 'last_token',
    normalize: true,
    queryPrefix:
      'Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ',
    documentPrefix: '',
    files: [
      {
        path: 'config.json',
        bytes: 1576,
        sha256: '66a10929782f3c9a3cd5dec90e2a95c60e05736134a63cd54479eeae80bed175',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 9731,
        sha256: '977648852447cb6587327ff3205b0a84cf2fc9f05621d6c8e88a497caafab2e1',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 613,
        sha256: '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd',
      },
      {
        path: 'tokenizer.json',
        bytes: 11423705,
        sha256: 'def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 613527631,
        sha256: '87cd124e0ef1fd1f223ebc283efccbaeac386d0b08344701c46975d0657b591f',
      },
    ],
  },
  lightweight: {
    key: 'lightweight',
    physicalKey: 'granite-97m',
    label: '极速轻量型 (lightweight · Granite-97M)',
    physicalModel: 'IBM Granite 97M (ModernBERT)',
    note: 'Lightweight multilingual ModernBERT model. Uses ~200MB RAM with ~15ms CPU latency, suitable for fast batch indexing on resource-constrained devices.',
    modelId: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    revision: '536a9f241cb3f02a9c5995a1e708c784bd274859',
    dimension: 384,
    maxTokens: 32768,
    languages: ['*'],
    license: 'Apache-2.0',
    pooling: 'cls',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [
      {
        path: 'config.json',
        bytes: 1215,
        sha256: 'ae74d55a56f779774cb9a8e63d3c2da9ae1af83c00229ffdff43d0b38407a0ee',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 12860,
        sha256: '6ed69389e30a8ecabfce2f9ebcdf0c908b34056f24d994340f2f216521c057d5',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 871,
        sha256: '013787ee251ff611722479197c00853b62113ad303cb0a36524231783c676c69',
      },
      {
        path: 'tokenizer.json',
        bytes: 25301671,
        sha256: '51947676cae1f991fa51c6b9a24e14ee5460e5f0b9f692f13bb3159829d1592a',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 97858099,
        sha256: '704c1ebca5fbb7cd83ced41827658ac4c9990c64f7f2874d22b78044e5022e22',
      },
    ],
  },
  bilingual: {
    key: 'bilingual',
    physicalKey: 'kalm-0.5b',
    label: '中英双语型 (bilingual · KaLM-0.5B)',
    physicalModel: 'KaLM-Embedding-V2.5 0.5B',
    note: 'Bilingual 0.5B model tuned for Chinese/English research literature and instruction retrieval with 32K context.',
    modelId: 'thomasht86/KaLM-embedding-multilingual-mini-instruct-v2.5-ONNX',
    revision: '1ef826ab24cfcf52243ea16fefaf239b8c7fa285',
    dimension: 896,
    maxTokens: 32768,
    languages: ['*'],
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    queryPrefix: 'Instruct: Given a query, retrieve documents that answer the query \n Query: ',
    documentPrefix: '',
    files: [
      {
        path: 'config.json',
        bytes: 984,
        sha256: 'bf4f421fa081322e7bd27aa5b48ae5d60177a498b0c5342223aefe7dceb0e625',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 1521,
        sha256: 'f7d64e83e9748bf609050e04467e28c2edcea4773fc1bd94c1203507ad80c245',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 370,
        sha256: 'daf48284de8f4779b1dbf20963a68180002fba2a34a5da72292380c5d9fb6af2',
      },
      {
        path: 'tokenizer.json',
        bytes: 11419302,
        sha256: '2f79052deba517b0663d877714e117a31a4a6243cddb85fc4443c80a2fa65a20',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 562341284,
        sha256: '24b1592de862610a04152900c08fc5ccafc8c9f020c7c3d4ff3815f22426aec5',
      },
    ],
  },
  english: {
    key: 'english',
    physicalKey: 'nomic-137m',
    label: '英文代码型 (english · Nomic-137M)',
    physicalModel: 'Nomic Embed 137M v1.5',
    note: 'English and technical embedding model with 8K context and Matryoshka dimension truncation. Best for English literature; weaker on Chinese.',
    modelId: 'nomic-ai/nomic-embed-text-v1.5',
    revision: 'e9b6763023c676ca8431644204f50c2b100d9aab',
    dimension: 768,
    maxTokens: 8192,
    languages: ['en'],
    license: 'Apache-2.0',
    pooling: 'mean',
    normalize: true,
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
    files: [
      {
        path: 'config.json',
        bytes: 2538,
        sha256: '9ab00bd92cee80a569f708140b7b6c1661a65891ff3765b1519e181ba2f2c92b',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 1191,
        sha256: 'd7e0000bcc80134debd2222220427e6bf5fa20a669f40a0d0d1409cc18e0a9bc',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 695,
        sha256: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a',
      },
      {
        path: 'tokenizer.json',
        bytes: 711396,
        sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 137296292,
        sha256: 'b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27',
      },
    ],
  },
  hybrid: {
    key: 'hybrid',
    physicalKey: 'bge-m3',
    label: '多路混合型 (hybrid · BGE-M3)',
    physicalModel: 'BAAI BGE-M3 Multilingual',
    note: 'Widely adopted multilingual model with 8192 context and 1024-dim space. Reliable for long paper sections and cross-lingual retrieval.',
    modelId: 'onnx-community/bge-m3-ONNX',
    revision: '25b9af8e87a38eb120cfe87125383677b9cd309e',
    dimension: 1024,
    maxTokens: 8192,
    languages: ['*'],
    license: 'MIT',
    pooling: 'cls',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [
      {
        path: 'config.json',
        bytes: 658,
        sha256: '70dae5884ced999af00244f776ac9eaa71538d68497d3d6a6091e0318cd32905',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 1203,
        sha256: 'b87c8703482b0300d3da30e201519aa641f6a450f5eb5bf1e624afbf70c74d80',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 964,
        sha256: '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
      },
      {
        path: 'tokenizer.json',
        bytes: 17082799,
        sha256: '249df0778f236f6ece390de0de746838ef25b9d6954b68c2ee71249e0a9d8fd4',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 568479395,
        sha256: '2237f770aad5c71bbc1fc2d361a57f9a37400574cc9eff32626f0cdb49234730',
      },
    ],
  },
  academic: {
    key: 'academic',
    physicalKey: 'gte-base',
    label: '经典学术型 (academic · GTE-Base)',
    physicalModel: 'Alibaba NLP GTE Multilingual Base',
    note: 'Multilingual model covering 75+ languages with 8K context and 768-dim space. Balanced performance for mixed-language libraries.',
    modelId: 'onnx-community/gte-multilingual-base',
    revision: '2edbf5e672aab465f9ed4c154a8b61791c082c69',
    dimension: 768,
    maxTokens: 8192,
    languages: ['*'],
    license: 'Apache-2.0',
    pooling: 'cls',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [
      {
        path: 'config.json',
        bytes: 1648,
        sha256: '6ef2538d4286a7cd18d05225f659d8a1bceca7adb01c186868e53dbd4f822e17',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 1149,
        sha256: '24cebbf2ef20fc317256e03e52ac7b2ca326586f946a8427ecac036332bf0933',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 964,
        sha256: '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
      },
      {
        path: 'tokenizer.json',
        bytes: 17082734,
        sha256: '3a56def25aa40facc030ea8b0b87f3688e4b3c39eb8b45d5702b3a1300fe2a20',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 340318797,
        sha256: 'ab2bd164ebd8ca9003dc49a981b611e849b5d326f504c8873ba76e07fa6c0082',
      },
    ],
  },
}

export const SEMANTIC_MODELS: readonly SemanticModelEntry[] = Object.freeze(
  SEMANTIC_MODEL_KEYS.map((k) => CATALOG[k]),
)

export function isSemanticModelKey(value: unknown): value is SemanticModelKey {
  return typeof value === 'string' && (SEMANTIC_MODEL_KEYS as readonly string[]).includes(value)
}

export function isSemanticDownloadSource(value: unknown): value is SemanticDownloadSource {
  return (
    typeof value === 'string' && (SEMANTIC_DOWNLOAD_SOURCES as readonly string[]).includes(value)
  )
}

export function semanticModelBytes(model: SemanticModelEntry): number {
  return model.files.reduce((sum, f) => sum + f.bytes, 0)
}

export function semanticModelOf(key: string): SemanticModelEntry {
  const match = SEMANTIC_MODELS.find((m) => m.key === key)
  if (!match) {
    throw new TypeError(
      `unknown semantic model "${key}"; available: ${SEMANTIC_MODEL_KEYS.join(', ')}`,
    )
  }
  return match
}

export function allSemanticModels(): readonly SemanticModelEntry[] {
  return SEMANTIC_MODELS
}

/**
 * The on-disk commit marker written after a bundle is fully downloaded.
 *
 * The manifest is the one place the installed bytes and the catalog meet: a
 * status check compares this record with the catalog, and the loader refuses a
 * bundle whose manifest disagrees. It carries the inference metadata too, so a
 * manifest-only inspection is enough to know how to run the model.
 */
export interface SemanticModelManifest {
  readonly schema: 2
  readonly key: SemanticModelKey
  readonly physicalKey: string
  readonly modelId: string
  readonly revision: string
  readonly dimension: number
  readonly maxTokens: number
  readonly pooling: 'cls' | 'mean' | 'last_token'
  readonly normalize: boolean
  readonly queryPrefix: string
  readonly documentPrefix: string
  readonly files: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>>
}

/** Build the manifest one bundle must carry, from the catalog alone. */
export function manifestOf(model: SemanticModelEntry): SemanticModelManifest {
  return {
    schema: 2,
    key: model.key,
    physicalKey: model.physicalKey,
    modelId: model.modelId,
    revision: model.revision,
    dimension: model.dimension,
    maxTokens: model.maxTokens,
    pooling: model.pooling,
    normalize: model.normalize,
    queryPrefix: model.queryPrefix,
    documentPrefix: model.documentPrefix,
    files: Object.fromEntries(
      model.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }]),
    ),
  }
}
