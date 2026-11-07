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
import { isVolatile } from '@deepseek-ai/cosmokit';
import Schema from '@deepseek-ai/schemastery';
import { SCHOLARLY_CREDENTIAL_REFERENCE_NAMES } from '../credential-names.js';
export const ScholarlyConfig = Schema.object({
    email: Schema.string()
        .description('Contact email sent to Crossref, OpenAlex, and NCBI/Europe PMC (polite pool for higher rate limits)')
        .volatile(),
    s2ApiKeyEnv: Schema.string()
        .role('credential-ref')
        .default('')
        .description(`Credential reference for the Semantic Scholar API key (suggested: ${SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.semanticScholar}); empty disables the key.`)
        .volatile(),
    ncbiApiKeyEnv: Schema.string()
        .role('credential-ref')
        .default('')
        .description(`Credential reference for the NCBI / PubMed API key (suggested: ${SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.ncbi}); empty disables the key.`)
        .volatile(),
    openalexApiKeyEnv: Schema.string()
        .role('credential-ref')
        .default('')
        .description(`Credential reference for the OpenAlex API key (suggested: ${SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.openalex}); empty disables the key.`)
        .volatile(),
    maxResults: Schema.number()
        .default(20)
        .min(1)
        .max(100)
        .description('Maximum number of papers returned in a single search')
        .volatile(),
    maxContentChars: Schema.number()
        .default(12_000)
        .min(1_000)
        .max(50_000)
        .description('Character ceiling for chunked full-text reading')
        .volatile(),
    enableRunInBackground: Schema.boolean()
        .default(true)
        .description('Offer explicit background execution on long scholarly tools')
        .volatile(),
    promoteOnTimeout: Schema.boolean()
        .default(true)
        .description('Promote a long scholarly foreground call to a background job')
        .volatile(),
    foregroundWaitMs: Schema.number()
        .default(30_000)
        .min(1)
        .max(240_000)
        .description('Foreground wait before a long scholarly call is promoted')
        .volatile(),
});
export const ScholarlyConfigSchema = ScholarlyConfig;
/** Credential config fields of the pre-reference schema. */
export const LEGACY_CREDENTIAL_FIELDS = ['s2Key', 'ncbiKey', 'openalexKey'];
/**
 * The legacy credential fields a raw section still carries, in schema order.
 * @param section - the raw section the loader delivered.
 * @returns the legacy field names present on the section.
 */
export function legacyCredentialFieldsOf(section) {
    const present = new Set(Object.keys(section));
    return LEGACY_CREDENTIAL_FIELDS.filter((field) => present.has(field));
}
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
export function assertNoLegacyCredentialFields(section) {
    const legacy = legacyCredentialFieldsOf(section);
    if (legacy.length === 0)
        return;
    const names = SCHOLARLY_CREDENTIAL_REFERENCE_NAMES;
    throw new Error(`dsh-zotero/scholarly: config field(s) ${legacy.join(', ')} were removed in favor of credential references. ` +
        `Remove them from the scholarly config in the profile's cordis.patch.yml, store each key in the host credentials store, ` +
        `and set s2ApiKeyEnv/ncbiApiKeyEnv/openalexApiKeyEnv to ${names.semanticScholar}/${names.ncbi}/${names.openalex} (or your own reference names). ` +
        'Rotate the old key: it was stored as plaintext configuration.');
}
/**
 * Read one live field's current value.
 * @param value - a volatile reference, a plain value, or nothing.
 * @returns the current value, or undefined when the field is absent.
 */
function current(value) {
    if (value === undefined || value === null)
        return undefined;
    return (isVolatile(value) ? value.get() : value);
}
/**
 * Project one live config section into the plain values the tools read.
 *
 * Bounds are **not** re-applied here: the schema already refused anything
 * outside them at commit time, and a direct construction path (a test, an
 * embedder) is expected to supply values it validated itself.
 * @param input - the live section, as the loader delivered it.
 * @returns the resolved values.
 */
export function resolveScholarlyConfig(input) {
    return {
        email: current(input?.email)?.trim() || undefined,
        s2ApiKeyEnv: current(input?.s2ApiKeyEnv)?.trim() || undefined,
        ncbiApiKeyEnv: current(input?.ncbiApiKeyEnv)?.trim() || undefined,
        openalexApiKeyEnv: current(input?.openalexApiKeyEnv)?.trim() || undefined,
        // The schema's defaults are the only source of these numbers and flags,
        // but a section that bypassed the schema still needs values to run with.
        // That is the one place a literal belongs: it mirrors the schema, and the
        // schema owns validation.
        maxResults: current(input?.maxResults) ?? 20,
        maxContentChars: current(input?.maxContentChars) ?? 12_000,
        enableRunInBackground: current(input?.enableRunInBackground) ?? true,
        promoteOnTimeout: current(input?.promoteOnTimeout) ?? true,
        foregroundWaitMs: current(input?.foregroundWaitMs) ?? 30_000,
    };
}
//# sourceMappingURL=config.js.map