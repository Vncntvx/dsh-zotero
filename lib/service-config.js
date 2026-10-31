/**
 * @module dsh-zotero/service-config
 */
/**
 * Top-level config keys whose change rebuilds the transport stack: the HTTP
 * client identity and bounds (`baseUrl`, `timeoutMs`, `maxResponseBytes`,
 * `maxInFlightRequests`, the last of which sizes the client-wide concurrency
 * gate), the write client's human-scale dialog budget
 * (`writeAuthorizeDeadlineMs`), and the write-capability flip (writer,
 * authorizer, and tool set). `provider` and `writePersistKey` are live reads
 * (`resolveProvider()` and the authorizer's `persistKey` callback) and never
 * rebuild; every remaining bound, the scope-listing TTL included, is read
 * through the provider's live limits getter on the next call.
 */
export const TRANSPORT_CONFIG_KEYS = new Set([
    'baseUrl',
    'timeoutMs',
    'maxResponseBytes',
    'maxInFlightRequests',
    'writeAuthorizeDeadlineMs',
    'writeEnabled',
]);
export function touchesTransport(paths) {
    return paths.some((path) => path.length === 0 ||
        (path[0] !== undefined && TRANSPORT_CONFIG_KEYS.has(path[0])));
}
export function sameTransportConfig(current, built) {
    for (const key of TRANSPORT_CONFIG_KEYS) {
        if (current[key] !== built[key])
            return false;
    }
    return true;
}
export function localProviderLimits(config) {
    return {
        maxNoteScanRecords: config.maxNoteScanRecords,
        maxDetailChars: config.maxDetailChars,
        maxNoteBodyChars: config.maxNoteBodyChars,
        maxNoteChars: config.maxNoteChars,
        maxNoteRecords: config.maxNoteRecords,
        maxAnnotationRecords: config.maxAnnotationRecords,
        maxAttachmentRecords: config.maxAttachmentRecords,
        fulltextChunkWords: config.fulltextChunkWords,
        maxEvidenceChars: config.maxEvidenceChars,
        maxEvidencePassages: config.maxEvidencePassages,
        maxFulltextChars: config.maxFulltextChars,
        maxExportChars: config.maxExportChars,
        maxBrowseResults: config.maxBrowseResults,
        maxChangesResults: config.maxChangesResults,
        scopeListingTtlMs: config.scopeListingTtlMs,
        searchConcurrency: config.searchConcurrency,
        graphConcurrency: config.graphConcurrency,
        retrieveAttachmentCap: config.retrieveAttachmentCap,
        defaultStyle: config.defaultStyle,
        defaultLocale: config.defaultLocale,
    };
}
//# sourceMappingURL=service-config.js.map