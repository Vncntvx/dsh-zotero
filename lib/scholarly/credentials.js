/**
 * Resolve the scholarly API keys through the credentials seam.
 *
 * Configuration carries credential-reference names only; the values live in
 * the host credentials provider and are re-read before every external tool
 * call. An empty reference disables that optional key; a non-empty reference
 * that cannot be resolved is a configuration failure, never a silent
 * anonymous request.
 * @module dsh-zotero/scholarly/credentials
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE, ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED, ZoteroError, } from '../errors.js';
import { SCHOLARLY_KEY_FIELD_PAIRS as KEY_FIELDS } from '../credential-names.js';
/**
 * Resolve every configured key reference at one tool-call boundary.
 * @param ctx - the scholarly component's context.
 * @param config - the live resolved config section.
 * @returns the key values the source adapters send, or absent fields for unset references.
 * @throws {ZoteroError} when a configured reference is invalid, the credentials
 *   seam is absent, or the reference resolves to no value.
 */
export async function resolveScholarlyKeys(ctx, config) {
    const credentials = ctx.get('credentials');
    const resolved = {
        ...(config.email === undefined ? {} : { email: config.email }),
    };
    await Promise.all(KEY_FIELDS.map(async ([target, source]) => {
        const name = config[source]?.trim();
        if (name === undefined || name === '')
            return;
        let ref;
        try {
            ref = credentialRef(name);
        }
        catch (error) {
            throw new ZoteroError(`Scholarly credential reference "${name}" is not a valid environment-variable name.`, ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED, { cause: error });
        }
        if (credentials === undefined) {
            throw new ZoteroError(`Scholarly credential reference "${name}" is configured, but the credentials service is not composed.`, ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE);
        }
        const value = await credentials.resolve(ref);
        if (value === undefined || value.value.trim() === '') {
            throw new ZoteroError(`Scholarly credential reference "${name}" is configured but has no value. Store the key under that reference or clear the reference to use anonymous access.`, ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED);
        }
        resolved[target] = value.value.trim();
    }));
    return resolved;
}
//# sourceMappingURL=credentials.js.map