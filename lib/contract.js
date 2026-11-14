import { ZOTERO_SETTINGS_NAMESPACE, ZOTERO_ENRICHMENT_SERVICE_KEY } from './settings-namespace.js';
/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE };
/** Stable wire code reported when the full-session literature-trail projection fails to register. */
export const ZOTERO_SOURCE_PROJECTION_FAILED = 'ZOTERO_SOURCE_PROJECTION_FAILED';
/** Package identity every Typert contribution from this plugin claims. */
export const ZOTERO_REMOTE_PACKAGE = 'dsh-zotero';
/**
 * Success sentinel the host status probe writes into its total `diagnosis`
 * field (`src/local/provider.ts`). The wire view strips it: a connected probe
 * has nothing to diagnose: so this constant is the single spelling both the
 * writer and the stripper compare against.
 */
export const ZOTERO_DIAGNOSIS_OK = 'ok';
/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export const ZOTERO_STATUS_TYPE_SYMBOL = 'dsh-zotero#ZoteroStatusView';
/** Strict codec type symbol for the string ref parameter. */
export const ZOTERO_REF_PARAM_TYPE_SYMBOL = 'dsh-zotero#AttachmentRef';
/** Strict codec type symbol for {@link ZoteroAttachmentLocationView}. */
export const ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL = 'dsh-zotero#ZoteroAttachmentLocationView';
/** Strict codec type symbol for {@link ZoteroDiagnosticsView}. */
export const ZOTERO_DIAGNOSTICS_TYPE_SYMBOL = 'dsh-zotero#ZoteroDiagnosticsView';
/** Strict codec type symbol for {@link ZoteroClientErrorReport}. */
export const ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL = 'dsh-zotero#ZoteroClientErrorReport';
/** Strict codec type symbol for {@link ZoteroReportResultView}. */
export const ZOTERO_REPORT_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroReportResultView';
/** Strict codec type symbol for the string url parameter of openProtocol. */
export const ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL = 'dsh-zotero#ProtocolUrl';
/** Strict codec type symbol for {@link ZoteroOpenProtocolResultView}. */
export const ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroOpenProtocolResultView';
/** Strict codec type symbol for {@link ZoteroWriteGrantRevokeView}. */
export const ZOTERO_WRITE_GRANT_REVOKE_TYPE_SYMBOL = 'dsh-zotero#ZoteroWriteGrantRevokeView';
/** Globally stable invocation id for the status probe. */
export const ZOTERO_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/status';
/** Globally stable invocation id for resolveAttachment. */
const ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID = 'dsh-zotero#zotero/resolveAttachment';
/** Globally stable invocation id for the diagnostics snapshot. */
const ZOTERO_DIAGNOSTICS_INVOCATION_ID = 'dsh-zotero#zotero/diagnostics';
/** Globally stable invocation id for the client error report. */
const ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID = 'dsh-zotero#zotero/reportClientError';
/** Globally stable invocation id for openProtocol. */
const ZOTERO_OPEN_PROTOCOL_INVOCATION_ID = 'dsh-zotero#zotero/openProtocol';
/** Globally stable invocation id for revokeWriteGrant. */
const ZOTERO_REVOKE_WRITE_GRANT_INVOCATION_ID = 'dsh-zotero#zotero/revokeWriteGrant';
/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here, never as a second literal.
 */
export const ZOTERO_STATUS_SERVICE_KEY = 'zoteroRemote';
/** Wire method name for the status probe. */
export const ZOTERO_STATUS_METHOD = 'status';
/** Wire method name for resolveAttachment. */
export const ZOTERO_RESOLVE_ATTACHMENT_METHOD = 'resolveAttachment';
/** Wire method name for the diagnostics snapshot. */
export const ZOTERO_DIAGNOSTICS_METHOD = 'diagnostics';
/** Wire method name for the client error report. */
export const ZOTERO_REPORT_CLIENT_ERROR_METHOD = 'reportClientError';
/** Wire method name for openProtocol. */
export const ZOTERO_OPEN_PROTOCOL_METHOD = 'openProtocol';
/** Wire method name for revokeWriteGrant. */
export const ZOTERO_REVOKE_WRITE_GRANT_METHOD = 'revokeWriteGrant';
/** Invocation kind for direct service calls (no Context receiver). */
export const ZOTERO_STATUS_INVOCATION_KIND = 'direct';
/**
 * Build one status invocation descriptor around a result codec. Host and
 * client both call this so endpoint identity cannot drift; only the codec arm
 * differs by side. Every structural field is copied, so a caller never shares
 * a mutable reference with the descriptor it built.
 * @param result - the strict result codec for {@link ZoteroStatusView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroStatusInvocation(result) {
    return {
        id: ZOTERO_STATUS_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_STATUS_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [],
        result,
    };
}
/**
 * Build one revokeWriteGrant invocation descriptor: no parameters, direct
 * dispatch, and the caller's cancellation signal.
 * @param result - the strict result codec for {@link ZoteroWriteGrantRevokeView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroRevokeWriteGrantInvocation(result) {
    return {
        id: ZOTERO_REVOKE_WRITE_GRANT_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_REVOKE_WRITE_GRANT_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [],
        result,
    };
}
/**
 * Build one resolveAttachment invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the ref string.
 * @param result - the strict result codec for {@link ZoteroAttachmentLocationView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroResolveAttachmentInvocation(param, result) {
    return {
        id: ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [
            {
                name: 'ref',
                wire: 'ref',
                source: 'json',
                codec: param,
            },
        ],
        result,
    };
}
/**
 * Build one diagnostics invocation descriptor around a result codec. Zero
 * parameters, like the status probe: the endpoint serves its own capped
 * newest-first slice and the `debug` fact.
 * @param result - the strict result codec for {@link ZoteroDiagnosticsView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroDiagnosticsInvocation(result) {
    return {
        id: ZOTERO_DIAGNOSTICS_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_DIAGNOSTICS_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [],
        result,
    };
}
/**
 * Build one reportClientError invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for {@link ZoteroClientErrorReport}.
 * @param result - the strict result codec for {@link ZoteroReportResultView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroReportClientErrorInvocation(param, result) {
    return {
        id: ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_REPORT_CLIENT_ERROR_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [
            {
                name: 'report',
                wire: 'report',
                source: 'json',
                codec: param,
            },
        ],
        result,
    };
}
/**
 * Build one openProtocol invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the zotero:// URL string.
 * @param result - the strict result codec for {@link ZoteroOpenProtocolResultView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroOpenProtocolInvocation(param, result) {
    return {
        id: ZOTERO_OPEN_PROTOCOL_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_OPEN_PROTOCOL_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [
            {
                name: 'url',
                wire: 'url',
                source: 'json',
                codec: param,
            },
        ],
        result,
    };
}
export const ZOTERO_SOURCE_PAGE_METHOD = 'sourcePage';
export const ZOTERO_SOURCE_PAGE_INVOCATION_ID = 'dsh-zotero#zotero/sourcePage';
export const ZOTERO_SOURCE_PAGE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSourcePageRequestView';
export const ZOTERO_SOURCE_PAGE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSourcePageResultView';
/**
 * Build one sourcePage invocation descriptor around parameter and result codecs.
 *
 * The endpoint rides the core service: the literature trail is a conversation
 * surface, so it must page whether or not the optional library component is
 * mounted.
 * @param param - the strict parameter codec for the page request.
 * @param result - the strict result codec for the page result.
 * @returns a complete invocation descriptor.
 */
export function zoteroSourcePageInvocation(param, result) {
    return {
        id: ZOTERO_SOURCE_PAGE_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SOURCE_PAGE_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
/** The largest slice of a parsed document one read may return. */
export const ZOTERO_ARTIFACT_PAGE_CHARS = 65_536;
/** The largest figure one read may return, before base64 expansion. */
export const ZOTERO_ARTIFACT_IMAGE_BYTES = 8 * 1024 * 1024;
/**
 * The artifact id is the store's cache key: a SHA-256 hex string. One shared
 * pattern serves the wire schemas, the host modules and the client controller.
 */
export const ZOTERO_ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
export const ZOTERO_START_DOCUMENT_PARSE_METHOD = 'startDocumentParse';
export const ZOTERO_DOCUMENT_ARTIFACT_METHOD = 'documentArtifact';
export const ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD = 'documentParseReceipt';
export function zoteroDocumentParseInvocation(method, param, result) {
    return {
        id: `dsh-zotero#zotero/${method}`,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
export const ZOTERO_LIST_PARSED_DOCUMENTS_METHOD = 'listParsedDocuments';
export const ZOTERO_DISCARD_PARSED_DOCUMENT_METHOD = 'discardParsedDocument';
export const ZOTERO_SEMANTIC_MODEL_STATUS_METHOD = 'semanticModelStatus';
export const ZOTERO_SEMANTIC_MODEL_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/semanticModelStatus';
export const ZOTERO_SEMANTIC_MODEL_STATUS_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelStatusRequestView';
export const ZOTERO_SEMANTIC_MODEL_STATUS_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelStatusResultView';
export function zoteroSemanticModelStatusInvocation(param, result) {
    return {
        id: ZOTERO_SEMANTIC_MODEL_STATUS_INVOCATION_ID,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SEMANTIC_MODEL_STATUS_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD = 'downloadSemanticModel';
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_INVOCATION_ID = 'dsh-zotero#zotero/downloadSemanticModel';
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelDownloadRequestView';
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelDownloadResultView';
export function zoteroSemanticModelDownloadInvocation(param, result) {
    return {
        id: ZOTERO_SEMANTIC_MODEL_DOWNLOAD_INVOCATION_ID,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
export const ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD = 'cancelSemanticModelDownload';
export const ZOTERO_SEMANTIC_MODEL_CANCEL_INVOCATION_ID = 'dsh-zotero#zotero/cancelSemanticModelDownload';
export const ZOTERO_SEMANTIC_MODEL_CANCEL_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelCancelRequestView';
export const ZOTERO_SEMANTIC_MODEL_CANCEL_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelCancelResultView';
export function zoteroSemanticModelCancelInvocation(param, result) {
    return {
        id: ZOTERO_SEMANTIC_MODEL_CANCEL_INVOCATION_ID,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
export const ZOTERO_SEMANTIC_MODEL_DELETE_METHOD = 'deleteSemanticModel';
export const ZOTERO_SEMANTIC_MODEL_DELETE_INVOCATION_ID = 'dsh-zotero#zotero/deleteSemanticModel';
export const ZOTERO_SEMANTIC_MODEL_DELETE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelDeleteRequestView';
export const ZOTERO_SEMANTIC_MODEL_DELETE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelDeleteResultView';
export function zoteroSemanticModelDeleteInvocation(param, result) {
    return {
        id: ZOTERO_SEMANTIC_MODEL_DELETE_INVOCATION_ID,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SEMANTIC_MODEL_DELETE_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
/** Strict codec type symbol for {@link ZoteroLibraryBrowseRequestView}. */
export const ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryBrowseRequestView';
/** Strict codec type symbol for {@link ZoteroLibraryBrowseResultView}. */
export const ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryBrowseResultView';
/** Strict codec type symbol for {@link ZoteroLibrarySearchRequestView}. */
export const ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibrarySearchRequestView';
/** Strict codec type symbol for {@link ZoteroSearchResultView}. */
export const ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSearchResultView';
/** Strict codec type symbol for {@link ZoteroLibraryItemRequestView}. */
export const ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryItemRequestView';
/** Strict codec type symbol for {@link ZoteroItemDetailView}. */
export const ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroItemDetailView';
/** Strict codec type symbol for {@link ZoteroLibraryChildPageRequestView}. */
export const ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryChildPageRequestView';
/** Strict codec type symbol for {@link ZoteroChildPageView}. */
export const ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroChildPageView';
/** Strict codec type symbol for {@link ZoteroLibraryExportRequestView}. */
export const ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryExportRequestView';
/** Strict codec type symbol for {@link ZoteroLibraryExportResultView}. */
export const ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryExportResultView';
/** Globally stable invocation id for the library browse. */
const ZOTERO_LIBRARY_BROWSE_INVOCATION_ID = 'dsh-zotero#zotero/browse';
/** Globally stable invocation id for the library search. */
const ZOTERO_LIBRARY_SEARCH_INVOCATION_ID = 'dsh-zotero#zotero/search';
/** Globally stable invocation id for the library item detail. */
const ZOTERO_LIBRARY_ITEM_INVOCATION_ID = 'dsh-zotero#zotero/item';
/** Globally stable invocation id for the library child page. */
const ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID = 'dsh-zotero#zotero/childPage';
/** Globally stable invocation id for the library export. */
const ZOTERO_LIBRARY_EXPORT_INVOCATION_ID = 'dsh-zotero#zotero/export';
/** Wire method name for the library browse. */
export const ZOTERO_LIBRARY_BROWSE_METHOD = 'browse';
/** Wire method name for the library search. */
export const ZOTERO_LIBRARY_SEARCH_METHOD = 'search';
/** Wire method name for the library item detail. */
export const ZOTERO_LIBRARY_ITEM_METHOD = 'item';
/** Wire method name for one paged child listing. */
export const ZOTERO_LIBRARY_CHILD_PAGE_METHOD = 'childPage';
/** Wire method name for one citation/BibTeX export. */
export const ZOTERO_LIBRARY_EXPORT_METHOD = 'export';
/**
 * Settings namespace of the library panel's configuration section. Must spell
 * the `cordis.patch.yml` row id (`library`): the harness settings plane
 * addresses every section by its loader entry id, so any other spelling
 * leaves the form permanently unavailable.
 */
export const ZOTERO_LIBRARY_SETTINGS_NAMESPACE = 'library';
/** Cordis service key for the library panel remote service. */
export const ZOTERO_LIBRARY_SERVICE_KEY = 'zoteroLibrary';
export { ZOTERO_ENRICHMENT_SERVICE_KEY };
export const ZOTERO_LIBRARY_WRITE_METHOD = 'write';
export const ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryWriteRequestView';
export const ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryWriteResultView';
/**
 * Build one library invocation descriptor: every panel endpoint takes a single
 * named `request` object, so only the id and method differ between them.
 * @param id - the endpoint's generated identity.
 * @param method - the service method the endpoint calls.
 * @param param - the strict parameter codec for the request.
 * @param result - the strict result codec.
 * @returns a complete invocation descriptor.
 */
function libraryInvocation(id, method, param, result) {
    return {
        id,
        service: ZOTERO_LIBRARY_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
/** The panel write invocation (the plan-review card's own endpoint). */
export function zoteroLibraryWriteInvocation(param, result) {
    return libraryInvocation('dsh-zotero#zotero/write', ZOTERO_LIBRARY_WRITE_METHOD, param, result);
}
/** The panel browse invocation (one navigation listing). */
export function zoteroLibraryBrowseInvocation(param, result) {
    return libraryInvocation(ZOTERO_LIBRARY_BROWSE_INVOCATION_ID, ZOTERO_LIBRARY_BROWSE_METHOD, param, result);
}
/** The panel search invocation (one item-list page over one scope). */
export function zoteroLibrarySearchInvocation(param, result) {
    return libraryInvocation(ZOTERO_LIBRARY_SEARCH_INVOCATION_ID, ZOTERO_LIBRARY_SEARCH_METHOD, param, result);
}
/** The panel item-detail invocation (one ref plus its child pages). */
export function zoteroLibraryItemInvocation(param, result) {
    return libraryInvocation(ZOTERO_LIBRARY_ITEM_INVOCATION_ID, ZOTERO_LIBRARY_ITEM_METHOD, param, result);
}
/** The panel child-page invocation (one ref, one kind, one page window). */
export function zoteroLibraryChildPageInvocation(param, result) {
    return libraryInvocation(ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID, ZOTERO_LIBRARY_CHILD_PAGE_METHOD, param, result);
}
/** The panel export invocation (one item ref plus the citation/BibTeX format). */
export function zoteroLibraryExportInvocation(param, result) {
    return libraryInvocation(ZOTERO_LIBRARY_EXPORT_INVOCATION_ID, ZOTERO_LIBRARY_EXPORT_METHOD, param, result);
}
export const ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroCollectionPathRequestView';
export const ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroCollectionPathResultView';
export function zoteroCollectionPathInvocation(param, result) {
    return libraryInvocation('dsh-zotero#zotero/collectionPath', 'collectionPath', param, result);
}
export function zoteroReadUrlPdfInvocation(param, result) {
    return libraryInvocation('dsh-zotero#zotero/readUrlPdf', 'readUrlPdf', param, result);
}
export function zoteroReleaseUrlPdfInvocation(param, result) {
    return libraryInvocation('dsh-zotero#zotero/releaseUrlPdf', 'releaseUrlPdf', param, result);
}
export const ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD = 'verifySemanticModel';
export const ZOTERO_SEMANTIC_MODEL_VERIFY_INVOCATION_ID = 'dsh-zotero#zotero/verifySemanticModel';
export const ZOTERO_SEMANTIC_MODEL_VERIFY_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelVerifyRequestView';
export const ZOTERO_SEMANTIC_MODEL_VERIFY_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSemanticModelStatusResultView';
export function zoteroSemanticModelVerifyInvocation(param, result) {
    return {
        id: ZOTERO_SEMANTIC_MODEL_VERIFY_INVOCATION_ID,
        service: ZOTERO_ENRICHMENT_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
        result,
    };
}
//# sourceMappingURL=contract.js.map