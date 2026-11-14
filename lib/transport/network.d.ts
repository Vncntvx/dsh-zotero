/**
 * Shared public-address validation and DNS pinning for scholarly requests and
 * user-initiated URL PDF reading. By default every resolved address must be
 * public, and the validated answer set is pinned into the socket to prevent
 * DNS rebinding. A caller may accept the local proxy's fake-IP marker
 * (198.18.0.0/15) only where it can bind the peer's identity another way: a
 * reviewed allowlist hostname, or an HTTPS target whose certificate names the
 * host. Pure contracts stay browser-type-safe; production DNS/undici adapters
 * live in connections.ts. Errors identify hosts and addresses, never signed
 * URLs.
 * @module dsh-zotero/transport/network
 */
/** One DNS answer: the literal address and its family. */
export interface ResolvedAddress {
    readonly address: string;
    readonly family: 4 | 6;
}
/**
 * The DNS seam. Production resolves through `host-connections.ts`'s
 * `node:dns` adapter; a test stubs this to decide what a name resolves to.
 * There is no test-only bypass flag: the transport always resolves through
 * whatever resolver it was built with.
 */
export type AddressResolver = (hostname: string, signal?: AbortSignal) => Promise<readonly ResolvedAddress[]>;
/**
 * One pinned connection: the dispatcher rides in the fetch `init` (undici's
 * own `RequestInit` extension), and `close()` ends the connection pool once
 * the attempt's response body has settled. Declared here — the pure/host
 * split's shared vocabulary — so the factory in `connections.ts` and the
 * transport in `http.ts` cannot drift apart.
 */
export interface PinnedDispatcher {
    /**
     * Passed through to fetch as undici's `dispatcher` init extension. Only the
     * fetch from the same undici copy (`publicFetch` in `connections.ts`) accepts
     * it: the runtime's global `fetch` ships another copy and rejects the
     * dispatcher at the handler interface before a connection opens.
     */
    readonly dispatcher: unknown;
    close(): Promise<void>;
}
/**
 * Whether one hostname is an IPv4 literal rather than a DNS name.
 *
 * The fake-IP exception applies to a resolver's answer, never to a URL that
 * spells the placeholder itself. IPv6 literals never reach here: the lexical
 * gate refuses them as a class.
 * @param host - the URL hostname.
 * @returns true for a dotted-quad.
 */
export declare function isIpv4Literal(host: string): boolean;
/**
 * Whether one dotted-quad is inside the fake-IP block local DNS proxies use.
 *
 * `198.18.0.0/15` is the RFC 2544 benchmarking range, which mihomo and Clash
 * TUN mode reuse as the placeholder pool: the answer is not a destination,
 * only a handle the local proxy maps back to the requested name. The bare
 * public-address judgment still refuses it; `resolvePublicAddresses` accepts
 * it only when the caller's policy says the peer's identity is bound another
 * way. IPv6 fake-IP (a ULA answer) is deliberately not recognised here.
 * @param ip - the literal address, as DNS answered it.
 * @returns true when the address is a fake-IP placeholder.
 */
export declare function isFakeIpAddress(ip: string): boolean;
/**
 * Whether one literal IP address is a public unicast address. Anything that
 * is not a valid IPv4 or IPv6 literal is refused: this function is the last
 * word on "may a socket connect here".
 * @param ip - the literal address, as DNS answered it.
 * @returns true when the address is public unicast.
 */
export declare function isPublicIpAddress(ip: string): boolean;
/** How strict one resolution is, and whose cancellation bounds it. */
export interface PublicAddressOptions {
    /** The caller's cancellation, when one exists. */
    readonly signal?: AbortSignal;
    /**
     * Accept answers inside 198.18.0.0/15. The allowlist arm sets this for
     * reviewed hostnames; the open-access PDF and MinerU arms set it only for
     * HTTPS targets, where the TLS certificate names the host. Any other
     * non-public answer in the set still refuses the whole name.
     */
    readonly acceptFakeIp?: boolean;
}
/** A hostname predicate, shared by the address gate's validating pool. */
export type HostnamePredicate = (hostname: string) => boolean;
/**
 * Resolve one hostname and require every answer to be public.
 * @param hostname - the name to resolve.
 * @param resolver - the DNS seam; production resolves through the
 *   `node:dns` adapter in `host-connections.ts`.
 * @param options - the caller's cancellation and acceptance policy; absent
 *   means public-only.
 * @returns the resolved addresses, all acceptable, in answer order.
 * @throws {PublicAddressError} when the name does not resolve, or any
 *   answer is a non-public address the policy does not accept.
 */
export declare function resolvePublicAddresses(hostname: string, resolver: AddressResolver, options?: PublicAddressOptions): Promise<readonly ResolvedAddress[]>;
/**
 * The shape undici's connector hands to a `lookup` function: the node:dns
 * callback contract, in both the single-address and the `all` form. The
 * option and callback shapes are wider than what this module produces,
 * because the connector may ask for either address family and may hand back
 * generic lookup answers.
 */
export type PinnedLookup = (hostname: string, options: {
    family?: number | string | undefined;
    all?: boolean | undefined;
}, callback: (error: Error | null, address: string | {
    address: string;
    family: number;
}[], family?: number) => void) => void;
/**
 * Build a `lookup` function that answers only with the already-validated
 * address set. undici's connector calls it for the socket it opens, so the
 * connection cannot be re-bound to a different address after the security
 * check (DNS rebinding).
 * @param addresses - the addresses `resolvePublicAddresses` validated.
 * @returns the pinned lookup.
 */
export declare function pinnedLookup(addresses: readonly ResolvedAddress[]): PinnedLookup;
/**
 * Build a `lookup` function that resolves the hostname live through the DNS
 * seam at connect time and refuses any non-public answer. undici's connector
 * calls it for every socket it opens, so each connection is judged by the
 * very answer set the connector uses — the validation and the socket share
 * one resolution, leaving no check-then-connect window. This is the
 * allowlist arm's address gate: the names are reviewed constants, but a name
 * is not an address, and the DNS answer for a reviewed name still gets the
 * same public-unicast judgment the open-access arm applies.
 *
 * The optional predicate is the one exception: when it returns true for a
 * hostname, the connector also accepts the local proxy's fake-IP placeholder.
 * Only the scholarly allowlist supplies it, where the reviewed name and the
 * TLS certificate bind the peer's identity.
 * @param resolver - the DNS seam; production resolves through the
 *   `node:dns` adapter in `host-connections.ts`.
 * @param acceptFakeIpFor - per-hostname fake-IP acceptance; absent is strict.
 * @returns the validating lookup.
 */
export declare function validatingLookup(resolver: AddressResolver, acceptFakeIpFor?: HostnamePredicate): PinnedLookup;
//# sourceMappingURL=network.d.ts.map