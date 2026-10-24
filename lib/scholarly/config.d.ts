/**
 * Configuration schema for the scholarly literature subsystem.
 *
 * The schema is the single authority for defaults and bounds: the loader
 * validates a committed section and refuses one outside these ranges, so the
 * resolver below only unwraps volatile references and trims secrets. It does
 * not re-implement `min`, `max`, or `default` — a second copy of a rule is a
 * second answer to the same question, and a silently clamped typo is worse
 * than a refused commit.
 *
 * Every field is volatile: a settings commit lands in the running fiber's
 * references without remounting, and each tool reads the live value per call.
 *
 * @module dsh-zotero/scholarly/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export interface ScholarlyConfig {
    enabled?: Volatile<boolean>;
    email?: Volatile<string>;
    s2Key?: Volatile<string>;
    ncbiKey?: Volatile<string>;
    openalexKey?: Volatile<string>;
    maxResults?: Volatile<number>;
    maxContentChars?: Volatile<number>;
}
/** The plain values {@link resolveScholarlyConfig} produces from a live section. */
export interface ResolvedScholarlyConfig {
    enabled: boolean;
    email?: string;
    s2Key?: string;
    ncbiKey?: string;
    openalexKey?: string;
    maxResults: number;
    maxContentChars: number;
}
export declare const ScholarlyConfig: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    email: Schema<string, string, "volatile">;
    s2Key: Schema<string, string, "volatile">;
    ncbiKey: Schema<string, string, "volatile">;
    openalexKey: Schema<string, string, "volatile">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    email: Schema<string, string, "volatile">;
    s2Key: Schema<string, string, "volatile">;
    ncbiKey: Schema<string, string, "volatile">;
    openalexKey: Schema<string, string, "volatile">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
}>>, "plain">;
export declare const ScholarlyConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    email: Schema<string, string, "volatile">;
    s2Key: Schema<string, string, "volatile">;
    ncbiKey: Schema<string, string, "volatile">;
    openalexKey: Schema<string, string, "volatile">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    email: Schema<string, string, "volatile">;
    s2Key: Schema<string, string, "volatile">;
    ncbiKey: Schema<string, string, "volatile">;
    openalexKey: Schema<string, string, "volatile">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
}>>, "plain">;
/**
 * Project one live config section into the plain values the tools read.
 *
 * Bounds are **not** re-applied here: the schema already refused anything
 * outside them at commit time, and a direct construction path (a test, an
 * embedder) is expected to supply values it validated itself.
 * @param input - the live section, as the loader delivered it.
 * @returns the resolved values.
 */
export declare function resolveScholarlyConfig(input?: Partial<ScholarlyConfig>): ResolvedScholarlyConfig;
//# sourceMappingURL=config.d.ts.map