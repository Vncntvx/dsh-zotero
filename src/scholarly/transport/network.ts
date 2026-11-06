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

import { ScholarlySecurityError } from './allowlist.js'

/** One DNS answer: the literal address and its family. */
export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/**
 * The DNS seam. Production resolves through `host-connections.ts`'s
 * `node:dns` adapter; a test stubs this to decide what a name resolves to.
 * There is no test-only bypass flag: the transport always resolves through
 * whatever resolver it was built with.
 */
export type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

/**
 * Whether one dotted-quad is a public unicast IPv4 address.
 *
 * The refused set is every non-global range: this-network, private,
 * carrier-grade NAT, loopback, link-local, the IETF documentation blocks,
 * the 6to4 relay anycast address, benchmarking, multicast, and reserved
 * (including the broadcast address).
 */
function isPublicIpv4(ip: string): boolean {
  const octets = ip.split('.')
  if (octets.length !== 4) return false
  const values = octets.map((octet) => Number(octet))
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b, c] = values as [number, number, number]
  if (a === 0) return false // this network
  if (a === 10) return false // private
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 127) return false // loopback
  if (a === 169 && b === 254) return false // link-local
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // protocol assignments / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false // 6to4 relay anycast
  if (a === 192 && b === 168) return false // private
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

/**
 * Expand one IPv6 literal into its eight hextets. `::` compresses anywhere;
 * an embedded dotted-quad tail (`::ffff:192.168.1.1`) becomes two hextets.
 * @returns the hextets, or undefined when the literal is not valid IPv6.
 */
function expandIpv6(ip: string): readonly number[] | undefined {
  const halves = ip.split('::')
  if (halves.length > 2) return undefined
  const parseGroup = (group: string): number | undefined => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined
    return Number.parseInt(group, 16)
  }
  const parseTail = (group: string): readonly number[] | undefined => {
    if (!group.includes('.')) return undefined
    const dotted = group.split('.')
    if (dotted.length !== 4) return undefined
    const values = dotted.map((octet) => Number(octet))
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return undefined
    }
    return [(values[0]! << 8) | values[1]!, (values[2]! << 8) | values[3]!]
  }
  const left = halves[0] === '' ? [] : halves[0]!.split(':')
  const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  const head: number[] = []
  for (const group of left) {
    if (group === '') return undefined
    const tail = parseTail(group)
    if (tail !== undefined) {
      head.push(...tail)
      continue
    }
    const value = parseGroup(group)
    if (value === undefined) return undefined
    head.push(value)
  }
  const foot: number[] = []
  for (const group of right) {
    if (group === '') return undefined
    const tail = parseTail(group)
    if (tail !== undefined) {
      foot.push(...tail)
      continue
    }
    const value = parseGroup(group)
    if (value === undefined) return undefined
    foot.push(value)
  }
  const missing = 8 - head.length - foot.length
  if (missing < 0) return undefined
  if (halves.length === 2) {
    // `::` must stand for at least one group; `a::b` with all eight groups
    // spelled out is not a legal compression.
    if (missing === 0) return undefined
    return [...head, ...Array.from({ length: missing }, () => 0), ...foot]
  }
  if (head.length !== 8) return undefined
  return head
}

/**
 * Whether one IPv6 literal is a public unicast address.
 *
 * The refused set: unspecified, IPv4-compatible (`::/96` — the embedded space
 * has no legitimate modern global use), IPv4-mapped (judged by the embedded
 * IPv4), Teredo, documentation, NAT64 (judged by the embedded IPv4), ULA,
 * link-local, and multicast. Everything else — global unicast — passes.
 */
function isPublicIpv6(ip: string): boolean {
  const groups = expandIpv6(ip)
  if (groups === undefined || groups.length !== 8) return false
  if (groups.every((group) => group === 0)) return false // unspecified
  if (groups.slice(0, 5).every((group) => group === 0)) {
    if (groups[5] === 0xffff) {
      const g6 = groups[6]!
      const g7 = groups[7]!
      const embedded = `${Math.floor(g6 / 256)}.${g6 % 256}.${Math.floor(g7 / 256)}.${g7 % 256}`
      return isPublicIpv4(embedded) // IPv4-mapped
    }
    return false // IPv4-compatible ::/96
  }
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return false // Teredo
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false // documentation
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    const g6 = groups[6]!
    const g7 = groups[7]!
    const embedded = `${Math.floor(g6 / 256)}.${g6 % 256}.${Math.floor(g7 / 256)}.${g7 % 256}`
    return isPublicIpv4(embedded) // NAT64 tail
  }
  const first = groups[0]!
  if (first >= 0xfc00 && first <= 0xfdff) return false // unique local
  if (first >= 0xfe80 && first <= 0xfebf) return false // link-local
  if (first >= 0xff00) return false // multicast
  return true
}

/**
 * Whether one literal IP address is a public unicast address. Anything that
 * is not a valid IPv4 or IPv6 literal is refused: this function is the last
 * word on "may a socket connect here".
 * @param ip - the literal address, as DNS answered it.
 * @returns true when the address is public unicast.
 */
export function isPublicIpAddress(ip: string): boolean {
  if (ip.includes(':')) return isPublicIpv6(ip)
  if (ip.includes('.')) return isPublicIpv4(ip)
  return false
}

/**
 * Resolve one hostname and require every answer to be public.
 * @param hostname - the name to resolve.
 * @param resolver - the DNS seam; production resolves through the
 *   `node:dns` adapter in `host-connections.ts`.
 * @returns the resolved addresses, all public, in answer order.
 * @throws {ScholarlySecurityError} when the name does not resolve, or any
 *   answer is a non-public address.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolver: AddressResolver,
): Promise<readonly ResolvedAddress[]> {
  let answers: readonly ResolvedAddress[]
  try {
    answers = await resolver(hostname)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new ScholarlySecurityError(
      `Security rejection: "${hostname}" did not resolve (${reason}).`,
    )
  }
  if (answers.length === 0) {
    throw new ScholarlySecurityError(
      `Security rejection: "${hostname}" did not resolve to any address.`,
    )
  }
  const offender = answers.find((answer) => !isPublicIpAddress(answer.address))
  if (offender !== undefined) {
    throw new ScholarlySecurityError(
      `Security rejection: "${hostname}" resolves to a non-public address (${offender.address}).`,
    )
  }
  return answers
}

/**
 * The shape undici's connector hands to a `lookup` function: the node:dns
 * callback contract, in both the single-address and the `all` form. The
 * option and callback shapes are wider than what this module produces,
 * because the connector may ask for either address family and may hand back
 * generic lookup answers.
 */
export type PinnedLookup = (
  hostname: string,
  options: { family?: number | string | undefined; all?: boolean | undefined },
  callback: (
    error: Error | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void

/**
 * Answer one connector lookup from an already-validated address set: honor
 * the requested family, reject a family with no answer, and serve both the
 * `all` and the single-address contract.
 */
function answerFrom(
  addresses: readonly ResolvedAddress[],
  options: { family?: number | string | undefined; all?: boolean | undefined },
  callback: Parameters<PinnedLookup>[2],
): void {
  const wanted =
    options.family === 4 || options.family === 'IPv4'
      ? 4
      : options.family === 6 || options.family === 'IPv6'
        ? 6
        : undefined
  const candidates =
    wanted === undefined ? addresses : addresses.filter((answer) => answer.family === wanted)
  if (candidates.length === 0) {
    // The connector reads the addresses only when the error is null, so the
    // empty address here is a placeholder the callback contract requires.
    callback(
      Object.assign(new Error('No pinned address matches the requested address family.'), {
        code: 'EPINNEDFAMILY',
      }),
      '',
    )
    return
  }
  if (options.all === true) {
    // The mutable-array parameter is the node:dns contract; the answers are
    // freshly built per call, so handing over the owned copy is safe.
    callback(
      null,
      candidates.map((answer) => ({ ...answer })),
    )
    return
  }
  const first = candidates[0]!
  callback(null, first.address, first.family)
}

/**
 * Build a `lookup` function that answers only with the already-validated
 * address set. undici's connector calls it for the socket it opens, so the
 * connection cannot be re-bound to a different address after the security
 * check (DNS rebinding).
 * @param addresses - the addresses `resolvePublicAddresses` validated.
 * @returns the pinned lookup.
 */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    answerFrom(addresses, options, callback)
  }
}

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
export function validatingLookup(resolver: AddressResolver): PinnedLookup {
  return (hostname, options, callback) => {
    void resolvePublicAddresses(hostname, resolver).then(
      (addresses) => {
        answerFrom(addresses, options, callback)
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), '')
      },
    )
  }
}
