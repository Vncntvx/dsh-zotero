/**
 * One-line failure descriptions and shared outcome text for the scholarly tools.
 *
 * A transport failure must never read as "the index holds no such work". A
 * rate limit, a timeout, or an open circuit says nothing about existence, the
 * same distinction `scholarly_verify` draws between `unverified` and
 * `not_found`. Every tool that fans out over indexes funnels its failures
 * through here, so neither the one-line description nor the outcome wording
 * can drift between them.
 * @module dsh-zotero/scholarly/tools/failure
 */
/**
 * Format one registry-read rejection for a model-facing notice.
 *
 * A `ScholarlyHttpError` spells out `HTTP <status> from <host>` for every
 * status except 429, whose message reads `Rate limited by <host> (retry after
 * Ns)`, because an operator has to recognize a rate limit without knowing the
 * number. The status is prefixed only when the message does not already carry
 * it, so the note never reads as `HTTP 404 — HTTP 404 from host`. The
 * underlying transport code is appended when the message does not carry it
 * (`fetch failed (UND_ERR_INVALID_ARG)`), so a local dispatcher mismatch cannot
 * masquerade as an anonymous network failure.
 * @param error - the rejection from a registry read.
 * @returns a single-line description.
 */
export declare function failureTextOf(error: unknown): string;
/**
 * Whether a failure is the address gate refusing a non-public DNS answer.
 *
 * Only that class of rejection is a local DNS/proxy condition. Deterministic
 * policy refusals (a host outside the allowlist, a redirect limit, a protocol
 * downgrade) and transient resolution failures are something else, and the
 * tools must not send the reader to fix a local proxy for them.
 * @param error - a source or registry rejection.
 * @returns true when the cause chain holds a non-public-address rejection.
 */
export declare function isLocalAddressRejection(error: unknown): boolean;
/** What the tool was looking for when every index failed. */
export type SourceFailureSubject = 'these keywords' | 'this identifier';
/** The action to take when every failure was a local address condition. */
export declare const LOCAL_CONDITION_NOTE = "This is a local DNS or proxy condition, not an index outage; fix the local condition and retry.";
/** The action to take when at least one failure came from a remote source. */
export declare const REMOTE_RECOVERY_NOTE = "retry after the sources recover.";
/**
 * The full outcome text when every selected index failed.
 *
 * A local-only outage is not an index outage at all, so the leading sentence
 * changes with it; the two branches share the same format from here. Exported
 * so the tools and their specs quote one constant instead of restating it.
 * @param subject - what the tool was looking for.
 * @param query - the raw query or identifier, for the diagnostic line.
 * @param failedSources - the one-line descriptions, one per failed source.
 * @param localOnly - whether every failure was a non-public-address rejection.
 * @returns the model-facing outcome.
 */
export declare function allSourcesFailedText(subject: SourceFailureSubject, query: string, failedSources: readonly string[], localOnly: boolean): string;
/**
 * The trailing notice when some sources failed but others answered.
 * @param localRejections - how many failures were non-public-address refusals.
 * @param failedSources - how many sources failed in total.
 * @returns the recovery note, or the local condition note when all were local.
 */
export declare function someSourcesFailedText(localRejections: number, failedSources: number): string;
/**
 * The `Next:` line of a verification summary.
 * @param localRejections - how many unverified results came from the address gate.
 * @param unverifiedCount - how many references could not be verified.
 * @returns the next step, naming the local condition when it caused them all.
 */
export declare function verificationNextStepOf(localRejections: number, unverifiedCount: number): string;
//# sourceMappingURL=failure.d.ts.map