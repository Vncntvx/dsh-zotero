/**
 * Configuration schema for the scholarly literature subsystem.
 *
 * The schema is the single authority for defaults and bounds: the loader
 * validates a committed section and refuses one outside these ranges, so the
 * resolver below only unwraps volatile references and trims credential
 * reference names. It does not re-implement `min`, `max`, or `default` — a
 * second copy of a rule is a second answer to the same question, and a
 * silently clamped typo is worse than a refused commit.
 *
 * The schema carries no enablement field. The component's presence is the
 * authorization: while `dsh-zotero/scholarly` is not mounted, this service
 * does not exist and no request can leave the host. The schema describes only
 * how the component behaves once it is mounted.
 *
 * Every field is volatile: a settings commit lands in the running fiber's
 * references without remounting, and each tool reads the live value per call.
 *
 * @module dsh-zotero/scholarly/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export interface ScholarlyConfig {
    email?: Volatile<string>;
    s2ApiKeyEnv?: Volatile<string>;
    ncbiApiKeyEnv?: Volatile<string>;
    openalexApiKeyEnv?: Volatile<string>;
    maxResults?: Volatile<number>;
    maxContentChars?: Volatile<number>;
    enableRunInBackground?: Volatile<boolean>;
    promoteOnTimeout?: Volatile<boolean>;
    foregroundWaitMs?: Volatile<number>;
}
/** The plain values {@link resolveScholarlyConfig} produces from a live section. */
export interface ResolvedScholarlyConfig {
    email?: string;
    s2ApiKeyEnv?: string;
    ncbiApiKeyEnv?: string;
    openalexApiKeyEnv?: string;
    maxResults: number;
    maxContentChars: number;
    enableRunInBackground: boolean;
    promoteOnTimeout: boolean;
    foregroundWaitMs: number;
}
export declare const ScholarlyConfig: Schema<Schemastery.ObjectS<NoInfer<{
    email: Schema<string, string, "volatile">;
    s2ApiKeyEnv: Schema<string, string, "volatile-defined">;
    ncbiApiKeyEnv: Schema<string, string, "volatile-defined">;
    openalexApiKeyEnv: Schema<string, string, "volatile-defined">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    email: Schema<string, string, "volatile">;
    s2ApiKeyEnv: Schema<string, string, "volatile-defined">;
    ncbiApiKeyEnv: Schema<string, string, "volatile-defined">;
    openalexApiKeyEnv: Schema<string, string, "volatile-defined">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, "plain">;
export declare const ScholarlyConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    email: Schema<string, string, "volatile">;
    s2ApiKeyEnv: Schema<string, string, "volatile-defined">;
    ncbiApiKeyEnv: Schema<string, string, "volatile-defined">;
    openalexApiKeyEnv: Schema<string, string, "volatile-defined">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    email: Schema<string, string, "volatile">;
    s2ApiKeyEnv: Schema<string, string, "volatile-defined">;
    ncbiApiKeyEnv: Schema<string, string, "volatile-defined">;
    openalexApiKeyEnv: Schema<string, string, "volatile-defined">;
    maxResults: Schema<number, number, "volatile-defined">;
    maxContentChars: Schema<number, number, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, "plain">;
/** Credential config fields of the pre-reference schema. */
export declare const LEGACY_CREDENTIAL_FIELDS: readonly ['s2Key', 'ncbiKey', 'openalexKey'];
/**
 * The legacy credential fields a raw section still carries, in schema order.
 * @param section - the raw section the loader delivered.
 * @returns the legacy field names present on the section.
 */
export declare function legacyCredentialFieldsOf(section: object): string[];
/**
 * Refuse a section that still carries the removed literal-key fields.
 *
 * The new schema cannot read them (they are no longer declared), and schemastery
 * keeps unknown keys, so without this gate an upgraded profile would silently
 * lose its API keys and fall back to anonymous access. A mount failure is the
 * loud answer: it names the fields and the migration, and never carries a value.
 * @param section - the raw section the loader delivered.
 * @throws {Error} when the section still declares a legacy literal-key field.
 */
export declare function assertNoLegacyCredentialFields(section: object): void;
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