import { ARTIFACT_READER_DEFAULTS, artifactReaderPreferencesOf, } from './artifact-reader-preferences.js';
/**
 * Shared, host-free contract for the document-enrichment component's settings.
 *
 * Kept dependency-free so the browser bundle may import it: the same choices,
 * defaults, and validation back the host Schemastery schema, the staged form
 * controller, and `resolveEnrichmentConfig`. Malformed values are refused rather
 * than repaired, matching `library-preferences.ts`.
 * @module dsh-zotero/enrichment-preferences
 */
import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from './credential-names.js';
import { DEFAULT_SEMANTIC_DOWNLOAD_SOURCE, DEFAULT_SEMANTIC_MODEL, SEMANTIC_DOWNLOAD_SOURCES, SEMANTIC_MODEL_KEYS, } from './enrichment-model-catalog.js';
/** The two MinerU APIs. `free` never reads the token; `pro` requires one. */
export const ENRICHMENT_MODE_CHOICES = ['free', 'pro'];
/** Input byte caps are enforced locally; MinerU enforces the page ceilings. */
export const ENRICHMENT_DOCUMENT_LIMITS = Object.freeze({
    free: Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPages: 20 }),
    pro: Object.freeze({ maxBytes: 200 * 1024 * 1024, maxPages: 200 }),
});
export const ENRICHMENT_DEFAULTS = Object.freeze({
    artifactReader: ARTIFACT_READER_DEFAULTS,
    mode: 'free',
    mineruTokenRef: ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru,
    outputDir: '',
    enableSemanticSearch: false,
    semanticModel: DEFAULT_SEMANTIC_MODEL,
    semanticDownloadSource: DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
    semanticModelDir: '',
});
export const ENRICHMENT_PREFERENCE_KEYS = Object.keys(ENRICHMENT_DEFAULTS);
/**
 * The shape of an output directory the settings form may save. Empty means the
 * default; otherwise the value must be a POSIX absolute path, a `~`/`~/...`
 * path, a Windows drive path, or a UNC path. Existence, writability, and
 * canonical safety are checked by the host on first use. Kept dependency-free
 * so the browser controller and the host schema share one rule.
 */
export const ENRICHMENT_OUTPUT_DIR_PATTERN = /^(?:$|~(?:\/|$)|\/|[A-Za-z]:[\\/]|\\\\)/;
/** Whether a configured output-dir value has an allowed absolute shape. */
export function isEnrichmentOutputDirPath(value) {
    return ENRICHMENT_OUTPUT_DIR_PATTERN.test(value);
}
/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export function enrichmentPreferencesOf(raw) {
    const values = {};
    for (const key of ENRICHMENT_PREFERENCE_KEYS) {
        values[key] = Object.hasOwn(raw, key) ? raw[key] : ENRICHMENT_DEFAULTS[key];
    }
    values.artifactReader = artifactReaderPreferencesOf(values.artifactReader);
    const validators = {
        artifactReader: () => true,
        mode: (value) => ENRICHMENT_MODE_CHOICES.includes(value),
        mineruTokenRef: (value) => typeof value === 'string',
        outputDir: (value) => typeof value === 'string',
        enableSemanticSearch: (value) => typeof value === 'boolean',
        semanticModel: (value) => SEMANTIC_MODEL_KEYS.includes(value),
        semanticDownloadSource: (value) => SEMANTIC_DOWNLOAD_SOURCES.includes(value),
        semanticModelDir: (value) => typeof value === 'string',
    };
    for (const key of ENRICHMENT_PREFERENCE_KEYS) {
        if (!validators[key](values[key])) {
            throw new Error(`Invalid enrichment preference: ${key}`);
        }
    }
    return Object.freeze({ ...values });
}
//# sourceMappingURL=enrichment-preferences.js.map