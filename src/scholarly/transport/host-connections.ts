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

import { lookup } from 'node:dns/promises'
import { Agent } from 'undici'
import {
  pinnedLookup,
  validatingLookup,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from './network.js'

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
