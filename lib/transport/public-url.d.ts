/**
 * Why the address gate refused a destination.
 *
 * - `non-public-address`: a DNS answer was a private, loopback, or fake-IP
 *   placeholder address. This is the local DNS/proxy condition the tools call
 *   out by name.
 * - `resolution-failed`: the resolver threw (for example `EAI_AGAIN`) or
 *   returned no answers. Transient, and the scholarly transport retries it.
 * - `policy`: a deterministic rule refused the URL — a name outside the
 *   allowlist, a redirect hop that left it, too many redirects, a downgraded
 *   protocol, or an unwired address resolver.
 *
 * The reason travels with the error so a wrapped `fetch failed` can be
 * classified without guessing from a message string.
 */
export type PublicAddressReason = 'non-public-address' | 'resolution-failed' | 'policy';
export declare class PublicAddressError extends Error {
    readonly reason: PublicAddressReason;
    constructor(message: string, reason: PublicAddressReason);
}
/**
 * Find a deterministic address refusal inside an error's cause chain.
 *
 * undici's fetch reports a connector `lookup` failure as a generic
 * `TypeError: fetch failed` with the real rejection in `cause`. Only this
 * module's own errors are returned, so no third-party message is surfaced.
 * A transient `resolution-failed` is deliberately excluded: the transport
 * retries it and records it against the host's circuit, while a deterministic
 * refusal is final — no retry and no circuit penalty.
 * @param error - any thrown value.
 * @returns the refusal, or undefined when the chain holds none.
 */
export declare function addressRefusalOf(error: unknown): PublicAddressError | undefined;
/**
 * Find a non-public DNS answer inside an error's cause chain.
 *
 * This is the only class of failure the scholarly tools describe as a local
 * DNS or proxy condition. Allowlist violations, redirect limits, and protocol
 * downgrades are deterministic policy refusals, not local network trouble.
 * @param error - any thrown value.
 * @returns the rejection, or undefined when the chain holds none.
 */
export declare function localAddressRejectionOf(error: unknown): PublicAddressError | undefined;
/**
 * Validates that a URL is a legitimate public web address, rejecting
 * private/loopback addresses and non-standard ports.
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
 * and refusing the whole class closes every spelling at once.
 *
 * This lexical gate is the first of two: a name is not an address, so the
 * transport additionally resolves the hostname and refuses non-public
 * answers before connecting (`network.ts`). That second gate is
 * policy-driven in exactly three places: a reviewed scholarly allowlist
 * hostname, an HTTPS open-access PDF target, and the MinerU transport's
 * HTTPS targets, may accept the local proxy's fake-IP placeholder because
 * TLS binds the peer to the requested name. Plain-HTTP targets and every
 * other non-public answer stay refused.
 * The upstream harness fetch provider performs no address judgment of its
 * own — it answers intranet and loopback addresses by design
 * (`packages/web/web-fetch-http`) — so there is no upstream guard to inherit
 * and none to defer to.
 * @param urlString - the address to check.
 * @returns true when the address is public HTTP(S) on port 80 or 443.
 */
export declare function isPublicUrl(urlString: string): boolean;
//# sourceMappingURL=public-url.d.ts.map