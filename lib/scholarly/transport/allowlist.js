/**
 * Strict URL safety guards for the scholarly transport.
 *
 * The accepted host set is **derived** from `hosts.ts`, never restated here:
 * a second copy of the allowlist is a second answer to "may we call this", and
 * the two drift (they did — the pacer had no `api.openalex.org` entry while the
 * adapters called it on every routing branch).
 *
 * Rejections name the hostname only. A message here reaches tool output and
 * diagnostic lines, and a scholarly URL can carry a credential
 * (`?api_key=…`, the only form NCBI accepts) or the DOI a user is researching.
 *
 * @module dsh-zotero/scholarly/transport/allowlist
 */
import { isScholarlyHost } from './hosts.js';
/**
 * A URL outside the public/allowlisted set.
 *
 * Defined here, beside the check that raises it, so the transport can treat it
 * as final without importing back into this module.
 */
export { PublicAddressError as ScholarlySecurityError, isPublicUrl, } from '../../transport/public-url.js';
import { PublicAddressError as ScholarlySecurityError, isPublicUrl, } from '../../transport/public-url.js';
/**
 * Checks if a hostname belongs to the approved scholarly index endpoints.
 * @param host - the hostname to check.
 * @returns true when the host (or an accepted subdomain) is declared.
 */
export function isAllowedScholarlyHost(host) {
    return isScholarlyHost(host);
}
/**
 * The hostname a rejected URL carried, for a message that is safe to surface.
 * @param urlString - the rejected address.
 * @returns the hostname, or a placeholder when the address does not parse.
 */
function rejectedHostOf(urlString) {
    try {
        return new URL(urlString).hostname || '(no host)';
    }
    catch {
        return '(unparseable)';
    }
}
/**
 * Asserts that the URL is safe and permitted.
 *
 * The allowlist arm is HTTPS-only: its fake-IP exception relies on the TLS
 * certificate binding the peer to a reviewed hostname, so a downgraded hop
 * must be refused here at both the initial URL and every redirect. The
 * open-access PDF arm may use plain HTTP, where the strict public-address
 * judgment still applies (no fake-IP placeholder).
 * @param urlString - The URL to validate.
 * @param allowPublicOnly - If true, permits any public URL (used for resolving OA PDFs).
 */
export function assertAllowedScholarlyUrl(urlString, allowPublicOnly = false) {
    if (!isPublicUrl(urlString)) {
        throw new ScholarlySecurityError(`Security rejection: "${rejectedHostOf(urlString)}" is not a valid public HTTP(S) address.`, 'policy');
    }
    if (!allowPublicOnly) {
        const parsed = new URL(urlString);
        if (parsed.protocol !== 'https:') {
            throw new ScholarlySecurityError(`Security rejection: scholarly requests must use HTTPS ("${parsed.hostname}").`, 'policy');
        }
        if (!isAllowedScholarlyHost(parsed.hostname)) {
            throw new ScholarlySecurityError(`Security rejection: Host "${parsed.hostname}" is not on the scholarly allowlist.`, 'policy');
        }
    }
}
//# sourceMappingURL=allowlist.js.map