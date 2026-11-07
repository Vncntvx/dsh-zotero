/**
 * The host-side seams of the scholarly transport's address safety: the
 * production DNS resolver and the pinned undici dispatcher.
 *
 * This module imports `node:dns` and `undici`, so it must stay out of the
 * browser type program — both declaration sets merge global timer and fetch
 * declarations that collide with the DOM ones the client compiles against.
 * Only the host-side composition (`scholarly/service.ts`) imports it; the
 * browser-reachable transport (`http.ts`) receives the two seams through its
 * `publicAccess` option, typed against `network.ts`'s pure interfaces.
 * @module dsh-zotero/scholarly/transport/host-connections
 */
import { type AddressResolver, type ResolvedAddress } from './network.js';
/** The production resolver: every answer, IPv4 and IPv6, in answer order. */
export declare const dnsAddressResolver: (hostname: string) => Promise<readonly ResolvedAddress[]>;
/**
 * One pinned connection factory's answer: the dispatcher rides inside the
 * fetch `init` (undici's own `RequestInit` extension), and `close()` ends the
 * agent's pool once the attempt's response body has settled.
 */
export interface PinnedDispatcher {
    readonly dispatcher: unknown;
    close(): Promise<void>;
}
/**
 * Build the undici agent whose connector answers only with the
 * already-validated address set, so the socket cannot be re-bound to a
 * different address after the security check (DNS rebinding).
 * @param addresses - the addresses `resolvePublicAddresses` validated.
 * @returns the dispatcher and its pool handle.
 */
export declare function createPinnedDispatcher(addresses: readonly ResolvedAddress[]): PinnedDispatcher;
/**
 * Build the undici agent whose connector resolves live through the DNS seam
 * at connect time and refuses any non-public answer, so every socket the
 * pool opens is judged by the addresses it actually uses. One agent serves
 * the transport's whole allowlist traffic; its pool keeps connections warm.
 * @param resolver - the DNS seam to resolve through.
 * @returns the dispatcher and its pool handle.
 */
export declare function createValidatingDispatcher(resolver: AddressResolver): PinnedDispatcher;
/**
 * The host seams both scholarly arms need, as one composition-ready object
 * for `createScholarlyHttp`'s `publicAccess` option: the DNS resolver, the
 * closed-set pinned dispatcher factory for the open-access PDF arm, and the
 * validating pool factory every allowlist fetch connects through.
 */
export declare const scholarlyPublicAccess: {
    readonly resolver: typeof dnsAddressResolver;
    readonly createDispatcher: typeof createPinnedDispatcher;
    readonly createValidatingDispatcher: () => PinnedDispatcher;
};
//# sourceMappingURL=host-connections.d.ts.map