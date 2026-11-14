/**
 * Configuration schema for the optional document-enrichment component.
 *
 * Mounting makes the capability available and accepts MinerU document egress;
 * every parse still requires an explicit user submission of one document.
 * Every field is volatile so a settings commit lands in the running fiber
 * without remounting, and each read resolves the live value. Defaults live in
 * the shared `enrichment-preferences` contract; `resolveEnrichmentConfig` only
 * unwraps volatile references and refuses malformed values — it does not
 * re-implement the schema's rules.
 * @module dsh-zotero/enrichment/config
 */
import Schema from '@deepseek-ai/schemastery';
import { ARTIFACT_READER_DEFAULTS } from '../artifact-reader-preferences.js';
import { currentVolatile, schemaChoices } from '../schema-helpers.js';
import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from '../credential-names.js';
import { SEMANTIC_DOWNLOAD_SOURCES, SEMANTIC_MODEL_KEYS } from '../enrichment-model-catalog.js';
import { ENRICHMENT_DEFAULTS, ENRICHMENT_MODE_CHOICES, ENRICHMENT_OUTPUT_DIR_PATTERN, ENRICHMENT_PREFERENCE_KEYS, enrichmentPreferencesOf, } from '../enrichment-preferences.js';
export const EnrichmentConfigSchema = Schema.object({
    artifactReader: Schema.object(Object.fromEntries(Object.entries(ARTIFACT_READER_DEFAULTS).map(([key, value]) => [
        key,
        Schema.number().step(1).min(1).default(value),
    ])))
        .default(ARTIFACT_READER_DEFAULTS)
        .description('Parsed-document preparation limits and archive worker capacity.')
        .volatile(),
    mode: schemaChoices(ENRICHMENT_MODE_CHOICES)
        .default(ENRICHMENT_DEFAULTS.mode)
        .description('Which MinerU API to use: free (Agent lightweight) or pro (precise).')
        .volatile(),
    mineruTokenRef: Schema.string()
        .role('credential-ref')
        .default(ENRICHMENT_DEFAULTS.mineruTokenRef)
        .description(`Credential reference for the MinerU precise-API token (default: ${ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru}); ` +
        'only read in pro mode.')
        .volatile(),
    outputDir: Schema.string()
        .pattern(ENRICHMENT_OUTPUT_DIR_PATTERN)
        .default(ENRICHMENT_DEFAULTS.outputDir)
        .description('Absolute directory for parsed artifacts (or a ~/... path); empty uses the harness default resolved at runtime. Relative paths are refused.')
        .volatile(),
    enableSemanticSearch: Schema.boolean()
        .default(ENRICHMENT_DEFAULTS.enableSemanticSearch)
        .description('Enable local semantic search and passage ranking.')
        .volatile(),
    semanticModel: schemaChoices(SEMANTIC_MODEL_KEYS)
        .default(ENRICHMENT_DEFAULTS.semanticModel)
        .description('Which local embedding model to use for semantic ranking.')
        .volatile(),
    semanticDownloadSource: schemaChoices(SEMANTIC_DOWNLOAD_SOURCES)
        .default(ENRICHMENT_DEFAULTS.semanticDownloadSource)
        .description('Preferred download channel for semantic model assets: hf-mirror or huggingface.')
        .volatile(),
    semanticModelDir: Schema.string()
        .pattern(ENRICHMENT_OUTPUT_DIR_PATTERN)
        .default(ENRICHMENT_DEFAULTS.semanticModelDir)
        .description('Optional custom directory for downloaded semantic models; empty uses the default directory (~/.dsh/models).')
        .volatile(),
});
/** Project one live config section into the plain values the enhancer reads. */
export function resolveEnrichmentConfig(input) {
    const raw = {};
    for (const key of ENRICHMENT_PREFERENCE_KEYS) {
        const value = currentVolatile(input?.[key]);
        if (value === undefined)
            continue;
        // Text fields carry operator whitespace from hand-edited profiles; the
        // resolved shape is the canonical one (as `resolveScholarlyConfig` does
        // for its credential references).
        raw[key] = typeof value === 'string' ? value.trim() : value;
    }
    return enrichmentPreferencesOf(raw);
}
//# sourceMappingURL=config.js.map