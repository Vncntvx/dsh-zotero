/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body, not as a generated
 * `./typert` artifact: Typert's generator runs only inside a workspace root
 * that contains both `tsconfig.host.json` and `packages/`, and this
 * repository is a standalone checkout with neither, so no artifact can be
 * generated here. The registry documents `ctx.typert.register()` as the path
 * for hand-written wire schemas. No `./typert` export is declared on purpose:
 * the production Loader row is the bare package name `dsh-zotero`, which
 * dsh-typert-loader's entry discovery would resolve, and registering the same
 * `package#face` again fails with "already registered" (see service.ts).
 * The strict registry is the Host Gateway's preferred resolution path for
 * `zotero/status` and needs no `@Remote` markers.
 *
 * Invocations come from `status-codec.ts` (host zod factories); the client half
 * mounts its own codecs in `client/status-codec.ts`. Both arms materialize the
 * same strict schemas from the client-safe `wire-schemas.ts`. Structural
 * endpoint identity is shared through `contract.ts`; only the codec arm differs
 * by side. The service key spells {@link ZOTERO_STATUS_SERVICE_KEY}, the same
 * constant the host Remote service and the invocation descriptor use.
 *
 * The manifest declares the `zoteroLibrary` service of the separate
 * `dsh-zotero/library` bundle row. Deliberate: Typert binds endpoints by
 * composed service at runtime, so with the row disabled nothing answers, but
 * the declaration stays here because the manifest is one static contribution
 * per package. The browser-side `whileServed('library')` watch
 * (`client/index.ts`) is therefore the only gate that keeps the panels from
 * calling unbound endpoints.
 * @module dsh-zotero/typert
 */
import { ZOTERO_DIAGNOSTICS_METHOD, ZOTERO_LIBRARY_BROWSE_METHOD, ZOTERO_LIBRARY_CHILD_PAGE_METHOD, ZOTERO_LIBRARY_EXPORT_METHOD, ZOTERO_LIBRARY_ITEM_METHOD, ZOTERO_LIBRARY_SEARCH_METHOD, ZOTERO_LIBRARY_SERVICE_KEY, ZOTERO_LIBRARY_WRITE_METHOD, ZOTERO_OPEN_PROTOCOL_METHOD, ZOTERO_REMOTE_PACKAGE, ZOTERO_REPORT_CLIENT_ERROR_METHOD, ZOTERO_RESOLVE_ATTACHMENT_METHOD, ZOTERO_REVOKE_WRITE_GRANT_METHOD, ZOTERO_STATUS_METHOD, ZOTERO_STATUS_SERVICE_KEY, ZOTERO_SOURCE_PAGE_METHOD, ZOTERO_SEMANTIC_MODEL_STATUS_METHOD, ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD, ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD, ZOTERO_SEMANTIC_MODEL_DELETE_METHOD, ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD, ZOTERO_START_DOCUMENT_PARSE_METHOD, ZOTERO_DOCUMENT_ARTIFACT_METHOD, ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD, ZOTERO_LIST_PARSED_DOCUMENTS_METHOD, ZOTERO_DISCARD_PARSED_DOCUMENT_METHOD, ZOTERO_ENRICHMENT_SERVICE_KEY, } from './contract.js';
import { ZOTERO_INVOCATIONS } from './status-codec.js';
/** The zotero namespace's host manifest (strict codecs owned by this half). */
export const TYPERT_MANIFEST = {
    package: ZOTERO_REMOTE_PACKAGE,
    face: 'host',
    schemas: [],
    model: {
        services: [
            {
                key: ZOTERO_STATUS_SERVICE_KEY,
                exportName: 'ZoteroRuntime',
                description: 'Serves live Zotero connectivity facts to the dedicated web tab.',
                tags: [],
                members: [
                    {
                        kind: 'method',
                        name: ZOTERO_STATUS_METHOD,
                        signature: 'status(signal: AbortSignal): Promise<ZoteroStatusView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
                        signature: 'resolveAttachment(ref: string, signal: AbortSignal): Promise<ZoteroAttachmentLocationView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_DIAGNOSTICS_METHOD,
                        signature: 'diagnostics(signal: AbortSignal): Promise<ZoteroDiagnosticsView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_REPORT_CLIENT_ERROR_METHOD,
                        signature: 'reportClientError(report: ZoteroClientErrorReport, signal: AbortSignal): Promise<ZoteroReportResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_OPEN_PROTOCOL_METHOD,
                        signature: 'openProtocol(url: string, signal: AbortSignal): Promise<ZoteroOpenProtocolResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_REVOKE_WRITE_GRANT_METHOD,
                        signature: 'revokeWriteGrant(signal: AbortSignal): Promise<ZoteroWriteGrantRevokeView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SOURCE_PAGE_METHOD,
                        signature: 'sourcePage(request: ZoteroSourcePageRequestView, signal: AbortSignal): Promise<ZoteroSourcePageResultView>',
                    },
                ],
                types: [],
            },
            {
                key: ZOTERO_ENRICHMENT_SERVICE_KEY,
                exportName: 'EnrichmentService',
                description: 'Serves the optional enrichment component: explicit session-owned document parsing, artifact receipts, and local semantic-model management. Answers only while the component row is composed.',
                tags: [],
                members: [
                    {
                        kind: 'method',
                        name: ZOTERO_START_DOCUMENT_PARSE_METHOD,
                        signature: 'startDocumentParse(request: ZoteroStartDocumentParseRequestView, signal: AbortSignal): Promise<ZoteroStartDocumentParseResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_DOCUMENT_ARTIFACT_METHOD,
                        signature: 'documentArtifact(request: ZoteroDocumentArtifactRequestView, signal: AbortSignal): Promise<ZoteroDocumentArtifactResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD,
                        signature: 'documentParseReceipt(request: ZoteroDocumentParseReceiptRequestView, signal: AbortSignal): Promise<ZoteroDocumentParseReceiptResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIST_PARSED_DOCUMENTS_METHOD,
                        signature: 'listParsedDocuments(request: ZoteroListParsedDocumentsRequestView, signal: AbortSignal): Promise<ZoteroListParsedDocumentsResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_DISCARD_PARSED_DOCUMENT_METHOD,
                        signature: 'discardParsedDocument(request: ZoteroDiscardParsedDocumentRequestView, signal: AbortSignal): Promise<ZoteroDiscardParsedDocumentResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SEMANTIC_MODEL_STATUS_METHOD,
                        signature: 'semanticModelStatus(request: ZoteroSemanticModelStatusRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelStatusResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD,
                        signature: 'downloadSemanticModel(request: ZoteroSemanticModelDownloadRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelDownloadResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD,
                        signature: 'cancelSemanticModelDownload(request: ZoteroSemanticModelCancelRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelCancelResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SEMANTIC_MODEL_DELETE_METHOD,
                        signature: 'deleteSemanticModel(request: ZoteroSemanticModelDeleteRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelDeleteResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD,
                        signature: 'verifySemanticModel(request: ZoteroSemanticModelVerifyRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelStatusResultView>',
                    },
                ],
                types: [],
            },
            {
                key: ZOTERO_LIBRARY_SERVICE_KEY,
                exportName: 'ZoteroLibraryService',
                description: 'Serves library panel listings, user PDF reads, and approved mutations.',
                tags: [],
                members: [
                    {
                        kind: 'method',
                        name: 'releaseUrlPdf',
                        signature: 'releaseUrlPdf(request: { lease: string }, signal: AbortSignal): Promise<{ released: true }>',
                    },
                    {
                        kind: 'method',
                        name: 'readUrlPdf',
                        signature: 'readUrlPdf(request: { ref: string }, signal: AbortSignal): Promise<ZoteroUrlPdfView>',
                    },
                    {
                        kind: 'method',
                        name: 'collectionPath',
                        signature: 'collectionPath(request: ZoteroCollectionPathRequestView, signal: AbortSignal): Promise<ZoteroCollectionPathResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_BROWSE_METHOD,
                        signature: 'browse(request: ZoteroLibraryBrowseRequestView, signal: AbortSignal): Promise<ZoteroLibraryBrowseResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_SEARCH_METHOD,
                        signature: 'search(request: ZoteroLibrarySearchRequestView, signal: AbortSignal): Promise<ZoteroSearchResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_ITEM_METHOD,
                        signature: 'item(request: ZoteroLibraryItemRequestView, signal: AbortSignal): Promise<ZoteroItemDetailView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_CHILD_PAGE_METHOD,
                        signature: 'childPage(request: ZoteroLibraryChildPageRequestView, signal: AbortSignal): Promise<ZoteroChildPageView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_EXPORT_METHOD,
                        signature: 'export(request: ZoteroLibraryExportRequestView, signal: AbortSignal): Promise<ZoteroLibraryExportResultView>',
                    },
                    {
                        kind: 'method',
                        name: ZOTERO_LIBRARY_WRITE_METHOD,
                        signature: 'write(request: ZoteroLibraryWriteRequestView, signal: AbortSignal): Promise<ZoteroLibraryWriteResultView>',
                    },
                ],
                types: [],
            },
        ],
        events: [],
        objects: [],
    },
    invocations: ZOTERO_INVOCATIONS,
};
//# sourceMappingURL=typert.js.map