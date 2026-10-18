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

import { isScholarlyHost } from './hosts.js'

/**
 * A URL outside the public/allowlisted set.
 *
 * Defined here, beside the check that raises it, so the transport can treat it
 * as final without importing back into this module.
 */
export class ScholarlySecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScholarlySecurityError'
  }
}

/** Loopback, link-local, and RFC1918 IPv4 ranges. */
const PRIVATE_IP_REGEX = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/

/**
 * Validates that a URL is a legitimate public web address, rejecting
 * private/loopback addresses.
 * @param urlString - the address to check.
 * @returns true when the address is public HTTP(S).
 */
export function isPublicUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const protocol = url.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') return false

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      (!host.includes('.') && !host.includes(':'))
    ) {
      return false
    }

    if (PRIVATE_IP_REGEX.test(host)) return false
    if (host.includes(':') && /^(::1|fe80:|fc|fd|::ffff:)/i.test(host)) return false

    return true
  } catch {
    return false
  }
}

/**
 * Checks if a hostname belongs to the approved scholarly index endpoints.
 * @param host - the hostname to check.
 * @returns true when the host (or an accepted subdomain) is declared.
 */
export function isAllowedScholarlyHost(host: string): boolean {
  return isScholarlyHost(host)
}

/**
 * The hostname a rejected URL carried, for a message that is safe to surface.
 * @param urlString - the rejected address.
 * @returns the hostname, or a placeholder when the address does not parse.
 */
function rejectedHostOf(urlString: string): string {
  try {
    return new URL(urlString).hostname || '(no host)'
  } catch {
    return '(unparseable)'
  }
}

/**
 * Asserts that the URL is safe and permitted.
 * @param urlString - The URL to validate.
 * @param allowPublicOnly - If true, permits any public URL (used for resolving OA PDFs).
 */
export function assertAllowedScholarlyUrl(urlString: string, allowPublicOnly = false): void {
  if (!isPublicUrl(urlString)) {
    throw new ScholarlySecurityError(
      `Security rejection: "${rejectedHostOf(urlString)}" is not a valid public HTTP(S) address.`,
    )
  }

  if (!allowPublicOnly) {
    const parsed = new URL(urlString)
    if (!isAllowedScholarlyHost(parsed.hostname)) {
      throw new ScholarlySecurityError(
        `Security rejection: Host "${parsed.hostname}" is not on the scholarly allowlist.`,
      )
    }
  }
}
