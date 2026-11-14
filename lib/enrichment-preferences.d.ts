import { type ArtifactReaderPreferences } from './artifact-reader-preferences.js';
import { type SemanticDownloadSource, type SemanticModelKey } from './enrichment-model-catalog.js';
/** The two MinerU APIs. `free` never reads the token; `pro` requires one. */
export declare const ENRICHMENT_MODE_CHOICES: readonly ['free', 'pro'];
export type EnrichmentMode = (typeof ENRICHMENT_MODE_CHOICES)[number];
/** Input byte caps are enforced locally; MinerU enforces the page ceilings. */
export declare const ENRICHMENT_DOCUMENT_LIMITS: Readonly<{
    free: Readonly<{
        maxBytes: number;
        maxPages: 20;
    }>;
    pro: Readonly<{
        maxBytes: number;
        maxPages: 200;
    }>;
}>;
export interface EnrichmentPreferences {
    readonly artifactReader: ArtifactReaderPreferences;
    /** Which MinerU API to use. Independent of whether a token is configured. */
    readonly mode: EnrichmentMode;
    /** Credential-reference name for the precise-API token (a name, never the value). */
    readonly mineruTokenRef: string;
    /** Absolute output directory; empty means the harness default is resolved at runtime. */
    readonly outputDir: string;
    /** Whether to enable local semantic ranking and embedding models. */
    readonly enableSemanticSearch: boolean;
    /** Which local embedding model to use for semantic ranking. */
    readonly semanticModel: SemanticModelKey;
    /** Preferred download channel for semantic model assets. */
    readonly semanticDownloadSource: SemanticDownloadSource;
    /** Optional custom directory for downloaded models; empty uses default assets directory. */
    readonly semanticModelDir: string;
}
export type EnrichmentPreferenceKey = keyof EnrichmentPreferences;
export declare const ENRICHMENT_DEFAULTS: EnrichmentPreferences;
export declare const ENRICHMENT_PREFERENCE_KEYS: EnrichmentPreferenceKey[];
/**
 * The shape of an output directory the settings form may save. Empty means the
 * default; otherwise the value must be a POSIX absolute path, a `~`/`~/...`
 * path, a Windows drive path, or a UNC path. Existence, writability, and
 * canonical safety are checked by the host on first use. Kept dependency-free
 * so the browser controller and the host schema share one rule.
 */
export declare const ENRICHMENT_OUTPUT_DIR_PATTERN: RegExp;
/** Whether a configured output-dir value has an allowed absolute shape. */
export declare function isEnrichmentOutputDirPath(value: string): boolean;
/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export declare function enrichmentPreferencesOf(raw: Readonly<Record<string, unknown>>): EnrichmentPreferences;
//# sourceMappingURL=enrichment-preferences.d.ts.map