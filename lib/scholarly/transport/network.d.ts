/**
 * Resolved-address guards for the scholarly transport.
 *
 * The lexical allowlist (`allowlist.ts`) decides which *names* may be
 * contacted, but a name is not an address: `localtest.me`, `*.nip.io`, and
 * `*.sslip.io` are ordinary DNS names that resolve to loopback or RFC1918
 * space, and no lexical check can see that. This module is the second gate:
 * the hostname is resolved, every answer must be a public unicast address,
 * and the resolved set is pinned into the connection so the socket cannot be
 * re-bound to a different address between check and connect (DNS rebinding).
 *
 * The module is deliberately free of node and undici imports: it is reachable
 * from the browser *type* program through the scholarly test fixtures, and
 * both node's and undici's declaration files merge global timer and fetch
 * declarations that collide with the DOM ones the client compiles against.
 * The production DNS resolver and the pinned undici dispatcher live in
 * `host-connections.ts`, which only the host-side composition imports.
 *
 * Only the open-access PDF arm leaves the allowlist (`allowPublicPdf`); it
 * resolves and pins a closed address set per attempt. The allowlist arm's
 * names are constants reviewed in `hosts.ts`, but a name is not an address:
 * its connections go through `validatingLookup`, which judges every DNS
 * answer public at connect time. The upstream harness fetch provider
 * explicitly answers intranet and loopback addresses and performs no address
 * judgment of its own (`packages/web/web-fetch-http`), so there is nothing
 * to inherit here.
 *
 * Rejections name the hostname and the offending address, never the URL.
 * @module dsh-zotero/scholarly/transport/network
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
 * Whether one literal IP address is a public unicast address. Anything that
 * is not a valid IPv4 or IPv6 literal is refused: this function is the last
 * word on "may a socket connect here".
 * @param ip - the literal address, as DNS answered it.
 * @returns true when the address is public unicast.
 */
export declare function isPublicIpAddress(ip: string): boolean;
/**
 * Resolve one hostname and require every answer to be public.
 * @param hostname - the name to resolve.
 * @param resolver - the DNS seam; production resolves through the
 *   `node:dns` adapter in `host-connections.ts`.
 * @returns the resolved addresses, all public, in answer order.
 * @throws {ScholarlySecurityError} when the name does not resolve, or any
 *   answer is a non-public address.
 */
export declare function resolvePublicAddresses(hostname: string, resolver: AddressResolver, signal?: AbortSignal): Promise<readonly ResolvedAddress[]>;
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
 * @param resolver - the DNS seam; production resolves through the
 *   `node:dns` adapter in `host-connections.ts`.
 * @returns the validating lookup.
 */
export declare function validatingLookup(resolver: AddressResolver): PinnedLookup;
//# sourceMappingURL=network.d.ts.map