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
interface ScholarlyHost {
    /** Exact hostname, as it appears in a URL. */
    readonly host: string;
    /**
     * Minimum milliseconds between two requests to this host. Chosen per the
     * publisher's stated rate limit; `0` means no client-side spacing.
     */
    readonly intervalMs: number;
    /**
     * Subdomains of `host` are accepted too (`sub.arxiv.org`). Only set where the
     * publisher documents a family of endpoints.
     */
    readonly subdomains?: boolean;
}
/**
 * Every host this component contacts, with its pacing.
 *
 * Intervals follow each publisher's documented anonymous limit, kept
 * deliberately conservative: exceeding a limit costs a retry, and a circuit
 * breaker trip costs the whole host for a minute.
 */
export declare const SCHOLARLY_HOSTS: readonly ScholarlyHost[];
/** The hostname → minimum interval map the pacer starts from. */
export declare const SCHOLARLY_HOST_INTERVALS: Readonly<Record<string, number>>;
/**
 * Whether a hostname is one this component may contact.
 * @param hostname - the URL hostname, already lowercased by `URL`.
 * @returns true for an exact entry or an accepted subdomain.
 */
export declare function isScholarlyHost(hostname: string): boolean;
/**
 * The pacing interval for one host, falling back to the longest configured
 * interval for an accepted subdomain whose parent declares one.
 * @param hostname - the URL hostname (may include a port when called with `host`).
 * @returns the interval in milliseconds.
 */
export declare function intervalForHost(hostname: string): number;
export {};
//# sourceMappingURL=hosts.d.ts.map