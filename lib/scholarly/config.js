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
export const ScholarlyConfig = Schema.object({
    email: Schema.string()
        .description('Contact email sent to Crossref, OpenAlex, and NCBI/Europe PMC (polite pool for higher rate limits)')
        .volatile(),
    s2Key: Schema.string()
        .role('secret')
        .description('Semantic Scholar API Key (optional, avoids shared-pool rate limiting)')
        .volatile(),
    ncbiKey: Schema.string()
        .role('secret')
        .description('NCBI / PubMed API Key (optional, raises limit from 3 to 10 req/s)')
        .volatile(),
    openalexKey: Schema.string()
        .role('secret')
        .description('OpenAlex API Key (optional, raises limit to 100 req/s)')
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
});
export const ScholarlyConfigSchema = ScholarlyConfig;
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
        s2Key: current(input?.s2Key)?.trim() || undefined,
        ncbiKey: current(input?.ncbiKey)?.trim() || undefined,
        openalexKey: current(input?.openalexKey)?.trim() || undefined,
        // The schema's defaults are the only source of these two numbers, but a
        // section that bypassed the schema still needs a value to run with. That
        // is the one place a literal belongs: it mirrors the schema, it cannot
        // disagree with it silently because the schema owns validation.
        maxResults: current(input?.maxResults) ?? 20,
        maxContentChars: current(input?.maxContentChars) ?? 12_000,
    };
}
//# sourceMappingURL=config.js.map