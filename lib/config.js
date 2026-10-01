/**
 * Plugin configuration. Every deployment-varying choice is a validated
 * `Config` field; the schema fills defaults and `resolveConfig` enforces the
 * constraints Schemastery cannot express (loopback-only `baseUrl`, positive
 * finite limits) at load time, failing loud on misconfiguration.
 *
 * Fields are `volatile`: the settings page edits the live entry without
 * remounting. `Config` is what the loader hands the constructor (references);
 * `Options` is what humans write (plain values); `resolveConfig` accepts
 * either, unwraps, and validates.
 * @module dsh-zotero/config
 */
import { isVolatile } from '@deepseek-ai/cosmokit';
import Schema from '@deepseek-ai/schemastery';
import { LOCAL_PROVIDER_ID } from './constants.js';
/**
 * Every field is `volatile`: the settings page edits the live entry, and the
 * loader commits volatile edits into the running fiber without remounting
 * (non-volatile edits would remount instead, and the settings write path
 * refuses them). The service re-reads the references per request and reacts
 * to `loader/volatile-update` for structural flips (transport, write tools).
 */
export const Config = Schema.object({
    baseUrl: Schema.string().default('http://127.0.0.1:23119/api').volatile(),
    provider: Schema.string().default(LOCAL_PROVIDER_ID).volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    maxInFlightRequests: Schema.number().default(8).volatile(),
    maxSearchResults: Schema.number().default(20).volatile(),
    maxNoteScanRecords: Schema.number().default(200).volatile(),
    searchConcurrency: Schema.number().default(4).volatile(),
    maxEvidenceChars: Schema.number().default(6000).volatile(),
    maxEvidencePassages: Schema.number().default(4).volatile(),
    maxDetailChars: Schema.number().default(3000).volatile(),
    maxNoteBodyChars: Schema.number().default(30_000).volatile(),
    maxNoteChars: Schema.number().default(2000).volatile(),
    maxNoteRecords: Schema.number().default(50).volatile(),
    maxAnnotationRecords: Schema.number().default(100).volatile(),
    fulltextChunkWords: Schema.number().default(200).volatile(),
    maxFulltextChars: Schema.number().default(250_000).volatile(),
    retrieveAttachmentCap: Schema.number().default(16).volatile(),
    graphConcurrency: Schema.number().default(4).volatile(),
    maxResponseBytes: Schema.number()
        .default(16 * 1024 * 1024)
        .volatile(),
    maxExportChars: Schema.number().default(1_000_000).volatile(),
    maxExportRefs: Schema.number().default(50).volatile(),
    maxBrowseResults: Schema.number().default(50).volatile(),
    maxChangesResults: Schema.number().default(50).volatile(),
    scopeListingTtlMs: Schema.number().default(30_000).volatile(),
    defaultStyle: Schema.string().default('apa').volatile(),
    defaultLocale: Schema.string().default('en-US').volatile(),
    writeEnabled: Schema.boolean().default(false).volatile(),
    writePersistKey: Schema.boolean().default(true).volatile(),
    writeNoteMaxChars: Schema.number().default(65_536).volatile(),
    writeListMaxItems: Schema.number().default(50).volatile(),
    writeAuthorizeDeadlineMs: Schema.number().default(120_000).volatile(),
    webEnabled: Schema.boolean().default(true).volatile(),
    enableRunInBackground: Schema.boolean().default(true).volatile(),
    promoteOnTimeout: Schema.boolean().default(true).volatile(),
    foregroundWaitMs: Schema.number().default(4000).volatile(),
});
/**
 * Hostnames that are loopback by definition. `localhost` is pinned to the
 * IPv4 literal before any request leaves the plugin; the set is the single
 * spelling authority for validation and for the shell-write detector's
 * host anchors, so the two can never drift.
 */
export const LOOPBACK_HOSTNAMES = new Set([
    '127.0.0.1',
    'localhost',
    '::1',
    '[::1]',
]);
/**
 * Pin a loopback hostname to a loopback IP literal. `localhost` would
 * otherwise resolve through the system resolver, whose answer a hosts-file
 * change can redirect after validation; rewriting it here locks every
 * request to a verified loopback address. The pin is a plain string rewrite
 * — `localhost` to the IPv4 loopback literal, the address every mainstream
 * platform resolves it to — keeping validation synchronous and the resolver
 * out of every request.
 */
function pinLoopbackHostname(hostname) {
    if (hostname !== 'localhost')
        return hostname;
    return '127.0.0.1';
}
function assertPositiveInteger(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`dsh-zotero: ${name} must be a positive integer; got ${value}`);
    }
}
function assertNonEmpty(name, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`dsh-zotero: ${name} must be a non-empty string`);
    }
}
/**
 * Read the current value behind a volatile reference. Plain values pass
 * through untouched, so callers holding pre-resolution input need no
 * wrapping.
 * @param value - a field value, possibly a volatile reference.
 * @returns the current plain value.
 */
function current(value) {
    return isVolatile(value) ? value.get() : value;
}
/**
 * Unwrap every top-level field of an entry to its plain value.
 * @param config - a Loader-resolved `Config` or human-written `Options`.
 * @returns the plain field map, without schema defaults.
 */
function unwrapConfig(config) {
    return Object.fromEntries(Object.entries(config ?? {}).map(([key, value]) => [key, current(value)]));
}
/** Schema defaults, computed once: `Config({})` then unwrapped. */
const SCHEMA_DEFAULTS = unwrapConfig(Config({}));
/**
 * Whether an entry already carries every `ResolvedConfig` field (after
 * unwrap). True for Loader/fiber-delivered config — that path applies the
 * same Schemastery schema before the constructor runs — and for a complete
 * `Options` object.
 */
export function isSchemaComplete(config) {
    const raw = unwrapConfig(config);
    return Object.keys(SCHEMA_DEFAULTS).every((key) => Object.hasOwn(raw, key));
}
/**
 * Normalize an entry for the service's live read. Schema-complete input is
 * kept as-is (Loader hands stable volatile references; live commits write
 * those same refs). Partial `Options` cannot observe volatile commits, so the
 * resolved snapshot is stored instead of re-applying Schemastery per request.
 * @param config - the constructor's entry, already accepted by {@link resolveConfig}.
 * @returns the entry the live getter reads.
 */
export function toLiveEntry(config) {
    return isSchemaComplete(config) ? config : resolveConfig(config);
}
/**
 * Constraint checks and the loopback hostname pin. Input must already carry
 * every `ResolvedConfig` field with a usable value (Schemastery applied, or
 * unwrapped from a complete entry).
 * @throws {Error} on loopback/URL/limit violations.
 */
export function assertResolvedConfig(plain) {
    if (typeof plain.baseUrl !== 'string') {
        throw new Error(`dsh-zotero: invalid baseUrl ${JSON.stringify(plain.baseUrl)}; expected an http:// loopback URL like http://127.0.0.1:23119/api`);
    }
    let url;
    try {
        url = new URL(plain.baseUrl);
    }
    catch (error) {
        throw new Error(`dsh-zotero: invalid baseUrl ${JSON.stringify(plain.baseUrl)}; expected an http:// loopback URL like http://127.0.0.1:23119/api`, { cause: error });
    }
    if (url.protocol !== 'http:') {
        throw new Error(`dsh-zotero: baseUrl must use the http: scheme (the Zotero Local API is plain loopback HTTP); got ${plain.baseUrl}`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new Error('dsh-zotero: baseUrl must not carry credentials (the Zotero Local API is unauthenticated)');
    }
    if (url.search !== '' || url.hash !== '') {
        throw new Error('dsh-zotero: baseUrl must not carry a query string or fragment (the Zotero Local API takes none)');
    }
    if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
        throw new Error(`dsh-zotero: baseUrl must point at loopback (127.0.0.1, localhost, or ::1) to reach the Zotero Local API; got ${plain.baseUrl}`);
    }
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
        throw new Error(`dsh-zotero: baseUrl path must be the Local API root (/api); got ${plain.baseUrl}`);
    }
    const hostname = pinLoopbackHostname(url.hostname);
    if (hostname !== url.hostname) {
        // The pin only rewrites `localhost` (to the IPv4 loopback literal), so
        // the assignment needs no bracket handling — IPv6 literals come back
        // unchanged and never enter this branch.
        url.hostname = hostname;
    }
    assertNonEmpty('provider', plain.provider);
    assertNonEmpty('defaultStyle', plain.defaultStyle);
    assertNonEmpty('defaultLocale', plain.defaultLocale);
    if (typeof plain.timeoutMs !== 'number' ||
        !Number.isFinite(plain.timeoutMs) ||
        plain.timeoutMs <= 0) {
        throw new Error(`dsh-zotero: timeoutMs must be a positive finite number; got ${plain.timeoutMs}`);
    }
    assertPositiveInteger('maxInFlightRequests', plain.maxInFlightRequests);
    assertPositiveInteger('maxSearchResults', plain.maxSearchResults);
    assertPositiveInteger('maxNoteScanRecords', plain.maxNoteScanRecords);
    assertPositiveInteger('searchConcurrency', plain.searchConcurrency);
    assertPositiveInteger('maxEvidenceChars', plain.maxEvidenceChars);
    assertPositiveInteger('maxEvidencePassages', plain.maxEvidencePassages);
    assertPositiveInteger('maxDetailChars', plain.maxDetailChars);
    assertPositiveInteger('maxNoteBodyChars', plain.maxNoteBodyChars);
    assertPositiveInteger('maxNoteChars', plain.maxNoteChars);
    assertPositiveInteger('maxNoteRecords', plain.maxNoteRecords);
    assertPositiveInteger('maxAnnotationRecords', plain.maxAnnotationRecords);
    assertPositiveInteger('fulltextChunkWords', plain.fulltextChunkWords);
    assertPositiveInteger('maxFulltextChars', plain.maxFulltextChars);
    assertPositiveInteger('retrieveAttachmentCap', plain.retrieveAttachmentCap);
    assertPositiveInteger('graphConcurrency', plain.graphConcurrency);
    assertPositiveInteger('maxResponseBytes', plain.maxResponseBytes);
    assertPositiveInteger('maxExportChars', plain.maxExportChars);
    assertPositiveInteger('maxExportRefs', plain.maxExportRefs);
    assertPositiveInteger('maxBrowseResults', plain.maxBrowseResults);
    assertPositiveInteger('maxChangesResults', plain.maxChangesResults);
    assertPositiveInteger('scopeListingTtlMs', plain.scopeListingTtlMs);
    assertPositiveInteger('foregroundWaitMs', plain.foregroundWaitMs);
    assertPositiveInteger('writeNoteMaxChars', plain.writeNoteMaxChars);
    assertPositiveInteger('writeListMaxItems', plain.writeListMaxItems);
    assertPositiveInteger('writeAuthorizeDeadlineMs', plain.writeAuthorizeDeadlineMs);
    // Every field above proved its type (schema application rejects mistyped
    // input; the asserts reject out-of-range values), so the spread is a
    // ResolvedConfig once the normalized URL is set.
    return { ...plain, baseUrl: url.toString() };
}
/**
 * Live read of a schema-complete entry (the Loader/fiber contract: every
 * field is present as a stable volatile reference or a plain value that
 * already passed {@link resolveConfig}). Unwrap + constraint checks only —
 * Schemastery is not re-applied on this path.
 * @throws {Error} on loopback/URL/limit violations, or when a field is missing.
 */
export function readResolvedConfig(entry) {
    return assertResolvedConfig(unwrapConfig(entry));
}
/**
 * Validate a raw config and fill schema defaults.
 *
 * The single schema+constraint authority: runs at load (a violating entry
 * fails loud) and as the `internal/config` veto (a violating settings commit
 * is refused before it lands). The service's per-request live read goes
 * through {@link readResolvedConfig} on an entry that already passed this
 * function (or arrived Loader schema-complete), so it never observes a value
 * this function would reject.
 * @throws {Error} on loopback/URL/limit violations; misconfiguration fails the plugin load.
 */
export function resolveConfig(config) {
    // Unwrap both sides of the schema: the loader hands parsed config whose
    // volatile fields are already references, while commits and tests hand
    // plain values — and application wraps every volatile field in a fresh
    // reference either way. Validation below always reads plain values.
    const applied = unwrapConfig(Config(unwrapConfig(config)));
    return assertResolvedConfig(applied);
}
//# sourceMappingURL=config.js.map