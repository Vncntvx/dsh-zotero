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
import { Agent, fetch as undiciFetch } from 'undici'
import {
  pinnedLookup,
  validatingLookup,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from './network.js'

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
 * Build the undici agent whose connector resolves live through the DNS seam
 * at connect time and refuses any non-public answer, so every socket the
 * pool opens is judged by the addresses it actually uses. One agent serves
 * the transport's whole allowlist traffic; its pool keeps connections warm.
 * @param resolver - the DNS seam to resolve through.
 * @returns the dispatcher and its pool handle.
 */
export function createValidatingDispatcher(resolver: AddressResolver): PinnedDispatcher {
  const agent = new Agent({ connect: { lookup: validatingLookup(resolver) } })
  return { dispatcher: agent, close: async () => await agent.close() }
}

/**
 * The host seams both scholarly arms need, as one composition-ready object
 * for `createScholarlyHttp`'s `publicAccess` option: the DNS resolver, the
 * closed-set pinned dispatcher factory for the open-access PDF arm, and the
 * validating pool factory every allowlist fetch connects through.
 */
export const scholarlyPublicAccess = {
  resolver: dnsAddressResolver,
  createDispatcher: createPinnedDispatcher,
  createValidatingDispatcher: () => createValidatingDispatcher(dnsAddressResolver),
} as const
