/**
 * Shared, host-free contract for the document-enrichment component's settings.
 *
 * Kept dependency-free so the browser bundle may import it: the same choices,
 * defaults, and validation back the host Schemastery schema, the staged form
 * controller, and `resolveEnrichmentConfig`. Malformed values are refused rather
 * than repaired, matching `library-preferences.ts`.
 * @module dsh-zotero/enrichment-preferences
 */

import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from './credential-names.js'
import {
  DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
  DEFAULT_SEMANTIC_MODEL,
  SEMANTIC_DOWNLOAD_SOURCES,
  SEMANTIC_MODEL_KEYS,
  type SemanticDownloadSource,
  type SemanticModelKey,
} from './enrichment-model-catalog.js'

/** The two MinerU APIs. `free` never reads the token; `pro` requires one. */
export const ENRICHMENT_MODE_CHOICES = ['free', 'pro'] as const
export type EnrichmentMode = (typeof ENRICHMENT_MODE_CHOICES)[number]

/** Input byte caps are enforced locally; MinerU enforces the page ceilings. */
export const ENRICHMENT_DOCUMENT_LIMITS = Object.freeze({
  free: Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPages: 20 }),
  pro: Object.freeze({ maxBytes: 200 * 1024 * 1024, maxPages: 200 }),
})

export interface EnrichmentPreferences {
  /** Which MinerU API to use. Independent of whether a token is configured. */
  readonly mode: EnrichmentMode
  /** Credential-reference name for the precise-API token (a name, never the value). */
  readonly mineruTokenRef: string
  /** Deployment gate for explicitly requested document uploads; enabling it starts no work. */
  readonly allowDocumentUpload: boolean
  /** Absolute output directory; empty means the harness default is resolved at runtime. */
  readonly outputDir: string
  /** Whether to enable local semantic ranking and embedding models. */
  readonly enableSemanticSearch: boolean
  /** Which local embedding model to use for semantic ranking. */
  readonly semanticModel: SemanticModelKey
  /** Preferred download channel for semantic model assets. */
  readonly semanticDownloadSource: SemanticDownloadSource
  /** Optional custom directory for downloaded models; empty uses default assets directory. */
  readonly semanticModelDir: string
}

export type EnrichmentPreferenceKey = keyof EnrichmentPreferences

export const ENRICHMENT_DEFAULTS: EnrichmentPreferences = Object.freeze({
  mode: 'free',
  mineruTokenRef: ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru,
  allowDocumentUpload: false,
  outputDir: '',
  enableSemanticSearch: false,
  semanticModel: DEFAULT_SEMANTIC_MODEL,
  semanticDownloadSource: DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
  semanticModelDir: '',
})

export const ENRICHMENT_PREFERENCE_KEYS = Object.keys(
  ENRICHMENT_DEFAULTS,
) as EnrichmentPreferenceKey[]

/**
 * The shape of an output directory the settings form may save. Empty means the
 * default; otherwise the value must be a POSIX absolute path, a `~`/`~/...`
 * path, a Windows drive path, or a UNC path. Existence, writability, and
 * canonical safety are checked by the host on first use. Kept dependency-free
 * so the browser controller and the host schema share one rule.
 */
export const ENRICHMENT_OUTPUT_DIR_PATTERN = /^(?:$|~(?:\/|$)|\/|[A-Za-z]:[\\/]|\\\\)/

/** Whether a configured output-dir value has an allowed absolute shape. */
export function isEnrichmentOutputDirPath(value: string): boolean {
  return ENRICHMENT_OUTPUT_DIR_PATTERN.test(value)
}

/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export function enrichmentPreferencesOf(
  raw: Readonly<Record<string, unknown>>,
): EnrichmentPreferences {
  const values = {} as Record<EnrichmentPreferenceKey, unknown>
  for (const key of ENRICHMENT_PREFERENCE_KEYS) {
    values[key] = Object.hasOwn(raw, key) ? raw[key] : ENRICHMENT_DEFAULTS[key]
  }

  const validators: Record<EnrichmentPreferenceKey, (value: unknown) => boolean> = {
    mode: (value) => (ENRICHMENT_MODE_CHOICES as readonly unknown[]).includes(value),
    mineruTokenRef: (value) => typeof value === 'string',
    allowDocumentUpload: (value) => typeof value === 'boolean',
    outputDir: (value) => typeof value === 'string',
    enableSemanticSearch: (value) => typeof value === 'boolean',
    semanticModel: (value) => (SEMANTIC_MODEL_KEYS as readonly unknown[]).includes(value),
    semanticDownloadSource: (value) =>
      (SEMANTIC_DOWNLOAD_SOURCES as readonly unknown[]).includes(value),
    semanticModelDir: (value) => typeof value === 'string',
  }
  for (const key of ENRICHMENT_PREFERENCE_KEYS) {
    if (!validators[key](values[key])) {
      throw new Error(`Invalid enrichment preference: ${key}`)
    }
  }
  return Object.freeze({ ...values }) as EnrichmentPreferences
}
