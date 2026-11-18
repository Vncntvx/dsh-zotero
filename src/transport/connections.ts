/**
 * Host-only DNS and undici adapters for the shared public-address gate.
 *
 * This module owns the package's single undici copy: both the `Agent`
 * dispatchers that pin a validated address set and the `fetch` that carries
 * them come from here. A dispatcher is only accepted by the fetch from the
 * same copy — the runtime's global `fetch` ships another undici and rejects
 * it at the handler interface (`UND_ERR_INVALID_ARG: invalid onRequestStart
 * method`) before a socket opens. Every external transport injects
 * `publicFetch`; only the loopback and browser clients use the runtime fetch.
 * @module dsh-zotero/transport/connections
 */

import { lookup } from 'node:dns/promises'
import { createRequire } from 'node:module'
import { proxyRouteFor, type ProxyRoute } from '@deepseek-ai/dsh-http-proxy'
import {
  pinnedLookup,
  validatingLookup,
  type AddressResolver,
  type HostnamePredicate,
  type PinnedDispatcher,
  type ResolvedAddress,
} from './network.js'

// Harness owns the proxy dispatcher in its own installation. Resolve its
// Undici there so fetch and direct agents share the same module in a profile.
const requireProxyDependency = createRequire(import.meta.resolve('@deepseek-ai/dsh-http-proxy'))
const { Agent, fetch: undiciFetch }: typeof import('undici') = requireProxyDependency('undici')

/** The external transports' fetch seam: the runtime `fetch` shape. */
export type PublicFetch = typeof globalThis.fetch

/**
 * The one external fetch: undici's own, from the copy whose `Agent` classes
 * the pinned dispatchers below instantiate. The cast is deliberate — undici's
 * `RequestInit`/`Response` declarations describe the same web API but are
 * nominally incompatible with the runtime's (`ArrayBufferView` body variants),
 * so only this seam restates them as the runtime shape.
 */
export const publicFetch = undiciFetch as unknown as PublicFetch

/** The production resolver: every answer, IPv4 and IPv6, in answer order. */
export const dnsAddressResolver = async (hostname: string): Promise<readonly ResolvedAddress[]> => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }))
}

/**
 * Build the undici agent whose connector answers only with the
 * already-validated address set, so the socket cannot be re-bound to a
 * different address after the security check (DNS rebinding).
 * @param addresses - the addresses `resolvePublicAddresses` validated.
 * @returns the dispatcher and its pool handle.
 */
export function createPinnedDispatcher(addresses: readonly ResolvedAddress[]): PinnedDispatcher {
  const agent = new Agent({ connect: { lookup: pinnedLookup(addresses) } })
  return { dispatcher: agent, close: async () => await agent.close() }
}

/**
 * The route one external request must take, as decided by the harness proxy
 * policy. A proxied route carries the process-wide dispatcher the policy
 * installed: it is shared across the whole process and must never be closed
 * here, and the proxy performs the DNS, so no address pinning applies. A
 * direct route keeps the closed-set pinned path.
 */
export type EgressRoute =
  | { readonly proxied: true; readonly dispatcher: PinnedDispatcher['dispatcher'] }
  | { readonly proxied: false }

/**
 * Ask the harness proxy policy how one request to `url` must be sent.
 * `proxyRouteFor` reads the launch environment; the returned route's
 * dispatcher comes from the same undici installation as `publicFetch`.
 */
export function egressRouteFor(url: URL): EgressRoute {
  const route: ProxyRoute = proxyRouteFor(url)
  return route.proxied ? { proxied: true, dispatcher: route.dispatcher } : { proxied: false }
}

/**
 * Build the undici agent whose connector resolves live through the DNS seam
 * at connect time and refuses any non-public answer, so every socket the
 * pool opens is judged by the addresses it actually uses. One agent serves
 * the transport's whole allowlist traffic; its pool keeps connections warm.
 * @param resolver - the DNS seam to resolve through.
 * @param acceptFakeIpFor - per-hostname fake-IP acceptance, supplied by the
 *   scholarly allowlist; absent is strict.
 * @returns the dispatcher and its pool handle.
 */
export function createValidatingDispatcher(
  resolver: AddressResolver,
  acceptFakeIpFor?: HostnamePredicate,
): PinnedDispatcher {
  const agent = new Agent({ connect: { lookup: validatingLookup(resolver, acceptFakeIpFor) } })
  return { dispatcher: agent, close: async () => await agent.close() }
}

/**
 * The host seams both scholarly arms need, as one composition-ready object
 * for `createScholarlyHttp`'s `publicAccess` option: the DNS resolver, the
 * closed-set pinned dispatcher factory for the open-access PDF arm, and the
 * validating pool factory every allowlist fetch connects through. The pool
 * factory takes the allowlist's fake-IP acceptance predicate; the PDF arm's
 * policy is decided per URL by the transport and its dispatcher factory is
 * unchanged.
 */
export const scholarlyPublicAccess = {
  resolver: dnsAddressResolver,
  createDispatcher: createPinnedDispatcher,
  createValidatingDispatcher: (acceptFakeIpFor?: HostnamePredicate) =>
    createValidatingDispatcher(dnsAddressResolver, acceptFakeIpFor),
} as const
