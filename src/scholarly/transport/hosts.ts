/**
 * The one declaration of every scholarly host.
 *
 * A host list that exists three times has three answers: an allowlist entry
 * without a pacing entry leaves a busy index unthrottled, and a paced host the
 * adapter never calls throttles nothing. This table is the single source: the
 * allowlist derives its accepted set from it, and the pacer derives its
 * intervals from it. A host that wants to be fetched must be added here, which
 * is exactly the review this list needs.
 *
 * @module dsh-zotero/scholarly/transport/hosts
 */

/** One host the scholarly subsystem may contact. */
export interface ScholarlyHost {
  /** Exact hostname, as it appears in a URL. */
  readonly host: string
  /**
   * Minimum milliseconds between two requests to this host. Chosen per the
   * publisher's stated rate limit; `0` means no client-side spacing.
   */
  readonly intervalMs: number
  /**
   * Subdomains of `host` are accepted too (`sub.arxiv.org`). Only set where the
   * publisher documents a family of endpoints.
   */
  readonly subdomains?: boolean
}

/**
 * Every host this component contacts, with its pacing.
 *
 * Intervals follow each publisher's documented anonymous limit, kept
 * deliberately conservative: exceeding a limit costs a retry, and a circuit
 * breaker trip costs the whole host for a minute.
 */
export const SCHOLARLY_HOSTS: readonly ScholarlyHost[] = [
  // arXiv asks for one request every 3 seconds on the API endpoint.
  { host: 'export.arxiv.org', intervalMs: 3_000 },
  { host: 'arxiv.org', intervalMs: 1_000, subdomains: true },
  // Crossref's polite pool tolerates far more, but bursts still cost.
  { host: 'api.crossref.org', intervalMs: 150, subdomains: true },
  // OpenAlex: 10 requests/second anonymous, 100 with a key.
  { host: 'api.openalex.org', intervalMs: 100 },
  // Semantic Scholar's unauthenticated pool is heavily shared.
  { host: 'api.semanticscholar.org', intervalMs: 1_000 },
  // NCBI E-utilities: 3/second anonymous, 10/second with a key.
  { host: 'eutils.ncbi.nlm.nih.gov', intervalMs: 350 },
  // Europe PMC's REST and full-text endpoints.
  { host: 'www.ebi.ac.uk', intervalMs: 350, subdomains: true },
  { host: 'dblp.org', intervalMs: 1_000 },
  // DOI resolution and the Unpaywall lookup.
  { host: 'doi.org', intervalMs: 200, subdomains: true },
  { host: 'api.unpaywall.org', intervalMs: 500 },
]

/** The exact hostnames, for set membership. */
export const SCHOLARLY_HOST_NAMES: ReadonlySet<string> = new Set(
  SCHOLARLY_HOSTS.map((entry) => entry.host),
)

/** The hostname → minimum interval map the pacer starts from. */
export const SCHOLARLY_HOST_INTERVALS: Readonly<Record<string, number>> = Object.fromEntries(
  SCHOLARLY_HOSTS.map((entry) => [entry.host, entry.intervalMs]),
)

/** Hosts whose subdomains are accepted. */
const SUBDOMAIN_HOSTS: readonly string[] = SCHOLARLY_HOSTS.filter(
  (entry) => entry.subdomains === true,
)
  .map((entry) => entry.host)
  .sort((a, b) => b.length - a.length)

/**
 * Whether a hostname is one this component may contact.
 * @param hostname - the URL hostname, already lowercased by `URL`.
 * @returns true for an exact entry or an accepted subdomain.
 */
export function isScholarlyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (SCHOLARLY_HOST_NAMES.has(normalized)) return true
  return SUBDOMAIN_HOSTS.some((parent) => normalized.endsWith(`.${parent}`))
}

/**
 * The pacing interval for one host, falling back to the longest configured
 * interval for an accepted subdomain whose parent declares one.
 * @param hostname - the URL hostname (may include a port when called with `host`).
 * @returns the interval in milliseconds.
 */
export function intervalForHost(hostname: string): number {
  const normalized = hostname.toLowerCase()
  const exact = SCHOLARLY_HOST_INTERVALS[normalized]
  if (exact !== undefined) return exact
  const parent = SUBDOMAIN_HOSTS.find((candidate) => normalized.endsWith(`.${candidate}`))
  return parent === undefined ? 0 : SCHOLARLY_HOST_INTERVALS[parent]
}
