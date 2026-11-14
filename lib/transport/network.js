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
import { PublicAddressError } from './public-url.js';
import { errorMessageOf } from '../errors.js';
import { raceWithSignal } from '../race-signal.js';
/**
 * Parse one dotted-quad into its four octets.
 * @param ip - the candidate literal.
 * @returns the octets, or undefined when the spelling is not an IPv4 literal.
 */
function ipv4OctetsOf(ip) {
    const parts = ip.split('.');
    // Only decimal digits spell an octet: `Number()` would also accept an empty
    // string, a hex literal, exponent notation, and surrounding whitespace.
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
        return undefined;
    const values = parts.map((part) => Number(part));
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return undefined;
    }
    const [a, b, c, d] = values;
    if (a === undefined || b === undefined || c === undefined || d === undefined)
        return undefined;
    return [a, b, c, d];
}
/**
 * Whether one dotted-quad is a public unicast IPv4 address.
 *
 * The refused set is every non-global range: this-network, private,
 * carrier-grade NAT, loopback, link-local, the IETF documentation blocks,
 * the 6to4 relay anycast address, benchmarking, multicast, and reserved
 * (including the broadcast address).
 */
function isPublicIpv4(ip) {
    const octets = ipv4OctetsOf(ip);
    if (octets === undefined)
        return false;
    const [a, b, c] = octets;
    if (a === 0)
        return false; // this network
    if (a === 10)
        return false; // private
    if (a === 100 && b >= 64 && b <= 127)
        return false; // carrier-grade NAT
    if (a === 127)
        return false; // loopback
    if (a === 169 && b === 254)
        return false; // link-local
    if (a === 172 && b >= 16 && b <= 31)
        return false; // private
    if (a === 192 && b === 0 && (c === 0 || c === 2))
        return false; // protocol assignments / TEST-NET-1
    if (a === 192 && b === 88 && c === 99)
        return false; // 6to4 relay anycast
    if (a === 192 && b === 168)
        return false; // private
    if (a === 198 && (b === 18 || b === 19))
        return false; // benchmarking
    if (a === 198 && b === 51 && c === 100)
        return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113)
        return false; // TEST-NET-3
    if (a >= 224)
        return false; // multicast, reserved, broadcast
    return true;
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
export function isIpv4Literal(host) {
    return ipv4OctetsOf(host) !== undefined;
}
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
export function isFakeIpAddress(ip) {
    const octets = ipv4OctetsOf(ip);
    if (octets === undefined)
        return false;
    const [a, b] = octets;
    return a === 198 && (b === 18 || b === 19);
}
/**
 * Expand one IPv6 literal into its eight hextets. `::` compresses anywhere;
 * an embedded dotted-quad tail (`::ffff:192.168.1.1`) becomes two hextets.
 * @returns the hextets, or undefined when the literal is not valid IPv6.
 */
function expandIpv6(ip) {
    const halves = ip.split('::');
    if (halves.length > 2)
        return undefined;
    const parseGroup = (group) => {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group))
            return undefined;
        return Number.parseInt(group, 16);
    };
    const parseTail = (group) => {
        if (!group.includes('.'))
            return undefined;
        const dotted = group.split('.');
        if (dotted.length !== 4)
            return undefined;
        const values = dotted.map((octet) => Number(octet));
        if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
            return undefined;
        }
        return [(values[0] << 8) | values[1], (values[2] << 8) | values[3]];
    };
    const left = halves[0] === '' ? [] : halves[0].split(':');
    const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : [];
    const head = [];
    for (const group of left) {
        if (group === '')
            return undefined;
        const tail = parseTail(group);
        if (tail !== undefined) {
            head.push(...tail);
            continue;
        }
        const value = parseGroup(group);
        if (value === undefined)
            return undefined;
        head.push(value);
    }
    const foot = [];
    for (const group of right) {
        if (group === '')
            return undefined;
        const tail = parseTail(group);
        if (tail !== undefined) {
            foot.push(...tail);
            continue;
        }
        const value = parseGroup(group);
        if (value === undefined)
            return undefined;
        foot.push(value);
    }
    const missing = 8 - head.length - foot.length;
    if (missing < 0)
        return undefined;
    if (halves.length === 2) {
        // `::` must stand for at least one group; `a::b` with all eight groups
        // spelled out is not a legal compression.
        if (missing === 0)
            return undefined;
        return [...head, ...Array.from({ length: missing }, () => 0), ...foot];
    }
    if (head.length !== 8)
        return undefined;
    return head;
}
/**
 * Whether one IPv6 literal is a public unicast address.
 *
 * Only global-unicast `2000::/3` passes, except special-purpose ranges within
 * it. IPv4-mapped and the well-known NAT64 prefix are judged by their embedded
 * IPv4 address; IPv4-compatible addresses and other special-purpose ranges
 * are refused. All other space, including site-local, ULA, link-local, and
 * multicast, is outside global unicast and is refused.
 */
function isPublicIpv6(ip) {
    const groups = expandIpv6(ip);
    if (groups === undefined || groups.length !== 8)
        return false;
    if (groups.every((group) => group === 0))
        return false; // unspecified
    if (groups.slice(0, 5).every((group) => group === 0)) {
        if (groups[5] === 0xffff) {
            const g6 = groups[6];
            const g7 = groups[7];
            const embedded = `${Math.floor(g6 / 256)}.${g6 % 256}.${Math.floor(g7 / 256)}.${g7 % 256}`;
            return isPublicIpv4(embedded); // IPv4-mapped
        }
        return false; // IPv4-compatible ::/96
    }
    if (groups[0] === 0x0064 &&
        groups[1] === 0xff9b &&
        groups.slice(2, 6).every((group) => group === 0)) {
        const g6 = groups[6];
        const g7 = groups[7];
        const embedded = `${Math.floor(g6 / 256)}.${g6 % 256}.${Math.floor(g7 / 256)}.${g7 % 256}`;
        return isPublicIpv4(embedded); // well-known NAT64 prefix, 64:ff9b::/96
    }
    const first = groups[0];
    if (first < 0x2000 || first > 0x3fff)
        return false; // outside global unicast 2000::/3
    if (first === 0x2001) {
        const second = groups[1];
        if (second <= 0x01ff)
            return false; // IETF special-purpose assignments, 2001::/23
        if (second === 0x0db8)
            return false; // documentation
    }
    if (first === 0x2002)
        return false; // 6to4
    if (first === 0x3ffe)
        return false; // returned 6bone, formerly 3ffe::/16
    if (first === 0x2620 && groups[1] === 0x004f && groups[2] === 0x8000) {
        return false; // AS112 direct delegation
    }
    if (first === 0x3fff && groups[1] <= 0x0fff)
        return false; // documentation
    return true;
}
/**
 * Whether one literal IP address is a public unicast address. Anything that
 * is not a valid IPv4 or IPv6 literal is refused: this function is the last
 * word on "may a socket connect here".
 * @param ip - the literal address, as DNS answered it.
 * @returns true when the address is public unicast.
 */
export function isPublicIpAddress(ip) {
    if (ip.includes(':'))
        return isPublicIpv6(ip);
    if (ip.includes('.'))
        return isPublicIpv4(ip);
    return false;
}
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
export async function resolvePublicAddresses(hostname, resolver, options = {}) {
    const { signal, acceptFakeIp = false } = options;
    let answers;
    try {
        const resolution = signal === undefined ? resolver(hostname) : resolver(hostname, signal);
        answers = await raceWithSignal(resolution, signal);
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        throw new PublicAddressError(`Security rejection: "${hostname}" did not resolve (${errorMessageOf(error)}).`, 'resolution-failed');
    }
    if (answers.length === 0) {
        throw new PublicAddressError(`Security rejection: "${hostname}" did not resolve to any address.`, 'resolution-failed');
    }
    const offender = answers.find((answer) => !isPublicIpAddress(answer.address) && !(acceptFakeIp && isFakeIpAddress(answer.address)));
    if (offender !== undefined) {
        const hint = isFakeIpAddress(offender.address)
            ? ' A local DNS proxy (Clash/mihomo TUN) answers with this fake-IP placeholder; add the host to its fake-ip-filter or switch the DNS mode to redir-host.'
            : '';
        throw new PublicAddressError(`Security rejection: "${hostname}" resolves to a non-public address (${offender.address}).${hint}`, 'non-public-address');
    }
    return answers;
}
/**
 * Answer one connector lookup from an already-validated address set: honor
 * the requested family, reject a family with no answer, and serve both the
 * `all` and the single-address contract.
 */
function answerFrom(addresses, options, callback) {
    const wanted = options.family === 4 || options.family === 'IPv4'
        ? 4
        : options.family === 6 || options.family === 'IPv6'
            ? 6
            : undefined;
    const candidates = wanted === undefined ? addresses : addresses.filter((answer) => answer.family === wanted);
    if (candidates.length === 0) {
        // The connector reads the addresses only when the error is null, so the
        // empty address here is a placeholder the callback contract requires.
        callback(Object.assign(new Error('No pinned address matches the requested address family.'), {
            code: 'EPINNEDFAMILY',
        }), '');
        return;
    }
    if (options.all === true) {
        // The mutable-array parameter is the node:dns contract; the answers are
        // freshly built per call, so handing over the owned copy is safe.
        callback(null, candidates.map((answer) => ({ ...answer })));
        return;
    }
    const first = candidates[0];
    callback(null, first.address, first.family);
}
/**
 * Build a `lookup` function that answers only with the already-validated
 * address set. undici's connector calls it for the socket it opens, so the
 * connection cannot be re-bound to a different address after the security
 * check (DNS rebinding).
 * @param addresses - the addresses `resolvePublicAddresses` validated.
 * @returns the pinned lookup.
 */
export function pinnedLookup(addresses) {
    return (_hostname, options, callback) => {
        answerFrom(addresses, options, callback);
    };
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
export function validatingLookup(resolver, acceptFakeIpFor) {
    return (hostname, options, callback) => {
        void resolvePublicAddresses(hostname, resolver, {
            acceptFakeIp: acceptFakeIpFor?.(hostname) === true,
        }).then((addresses) => {
            answerFrom(addresses, options, callback);
        }, (error) => {
            callback(error instanceof Error ? error : new Error(String(error)), '');
        });
    };
}
//# sourceMappingURL=network.js.map