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
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type EnrichmentPreferences } from '../enrichment-preferences.js';
export type EnrichmentConfig = {
    [K in keyof EnrichmentPreferences]?: EnrichmentPreferences[K] | Volatile<EnrichmentPreferences[K]>;
};
export declare const EnrichmentConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    artifactReader: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
        [k: string]: Schema<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        [k: string]: Schema<number, number, "defined">;
    }>>>, "volatile-defined">;
    mode: Schema<string | number, string | number, "volatile-defined">;
    mineruTokenRef: Schema<string, string, "volatile-defined">;
    outputDir: Schema<string, string, "volatile-defined">;
    enableSemanticSearch: Schema<boolean, boolean, "volatile-defined">;
    semanticModel: Schema<string | number, string | number, "volatile-defined">;
    semanticDownloadSource: Schema<string | number, string | number, "volatile-defined">;
    semanticModelDir: Schema<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    artifactReader: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
        [k: string]: Schema<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        [k: string]: Schema<number, number, "defined">;
    }>>>, "volatile-defined">;
    mode: Schema<string | number, string | number, "volatile-defined">;
    mineruTokenRef: Schema<string, string, "volatile-defined">;
    outputDir: Schema<string, string, "volatile-defined">;
    enableSemanticSearch: Schema<boolean, boolean, "volatile-defined">;
    semanticModel: Schema<string | number, string | number, "volatile-defined">;
    semanticDownloadSource: Schema<string | number, string | number, "volatile-defined">;
    semanticModelDir: Schema<string, string, "volatile-defined">;
}>>, "plain">;
/** Project one live config section into the plain values the enhancer reads. */
export declare function resolveEnrichmentConfig(input?: Partial<EnrichmentConfig>): EnrichmentPreferences;
//# sourceMappingURL=config.d.ts.map