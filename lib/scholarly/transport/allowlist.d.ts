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
/**
 * A URL outside the public/allowlisted set.
 *
 * Defined here, beside the check that raises it, so the transport can treat it
 * as final without importing back into this module.
 */
export declare class ScholarlySecurityError extends Error {
    constructor(message: string);
}
/**
 * Validates that a URL is a legitimate public web address, rejecting
 * private/loopback addresses.
 *
 * IPv6 literal hosts are refused as a class, not by a prefix blacklist.
 * A blacklist cannot enumerate the spellings: WHATWG URL normalizes
 * `[0:0:0:0:0:0:0:1]` to `[::1]` but leaves `[::0.0.0.1]` (dotted-quad
 * tail), `[fec0::1]` (site-local, past the `fc`/`fd` prefixes),
 * `[64:ff9b::7f00:1]` (NAT64), and expanded IPv4-mapped forms such as
 * `[0:0:0:0:0:ffff:127.0.0.1]` untouched — each resolves to loopback or
 * a private network. Every host this plugin can legitimately reach is a
 * DNS name (the `hosts.ts` allowlist carries no literals, and open-access
 * PDFs live on publisher DNS names), so a literal has no valid use here
 * and refusing the whole class closes every spelling at once. The
 * harness's unicast whitelist (`web-fetch-http/src/network.ts`) exists
 * for general web retrieval, which must admit public IPv6 literals;
 * `ipaddr.js` is not in this dependency tree and this class closure needs
 * no dependency.
 * @param urlString - the address to check.
 * @returns true when the address is public HTTP(S).
 */
export declare function isPublicUrl(urlString: string): boolean;
/**
 * Checks if a hostname belongs to the approved scholarly index endpoints.
 * @param host - the hostname to check.
 * @returns true when the host (or an accepted subdomain) is declared.
 */
export declare function isAllowedScholarlyHost(host: string): boolean;
/**
 * Asserts that the URL is safe and permitted.
 * @param urlString - The URL to validate.
 * @param allowPublicOnly - If true, permits any public URL (used for resolving OA PDFs).
 */
export declare function assertAllowedScholarlyUrl(urlString: string, allowPublicOnly?: boolean): void;
//# sourceMappingURL=allowlist.d.ts.map