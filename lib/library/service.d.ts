import type { ZoteroUrlPdfView } from '../contract.js';
/**
 * Cordis Service plugin providing `ctx.zoteroLibrary` and its Typert remote
 * endpoints: browse, collection path, search, item detail, citation/BibTeX
 * export, and approved writes.
 *
 * @module dsh-zotero/library/service
 */
import type { ZoteroCollectionPathRequestView, ZoteroCollectionPathResultView } from '../contract.js';
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type ZoteroChildPageView, type ZoteroItemDetailView, type ZoteroLibraryBrowseRequestView, type ZoteroLibraryBrowseResultView, type ZoteroLibraryChildPageRequestView, type ZoteroLibraryExportRequestView, type ZoteroLibraryExportResultView, type ZoteroLibraryItemRequestView, type ZoteroLibrarySearchRequestView, type ZoteroLibraryWriteRequestView, type ZoteroLibraryWriteResultView, type ZoteroSearchResultView } from '../contract.js';
import { type LibraryConfig } from './config.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        zoteroLibrary: ZoteroLibraryService;
    }
}
/** The library panel's host service: browse, search, item detail, child page, export, and approved writes. */
export declare class ZoteroLibraryService extends TypertRemoteService {
    config: LibraryConfig;
    private readonly urlPdf;
    private readonly pdfFiles;
    private readonly reading;
    static readonly Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        rightSidebarEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        listDensity: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        titleLines: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        detailExpandedSections: import("@deepseek-ai/schemastery").default<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
        localPdfOpenTarget: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        urlPdfOpenTarget: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        allowUrlPdfRead: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        reopenBehavior: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        scopeChangeBehavior: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        defaultCopyFormat: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        chatInsertContent: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        rightSidebarEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        listDensity: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        titleLines: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        detailExpandedSections: import("@deepseek-ai/schemastery").default<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
        localPdfOpenTarget: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        urlPdfOpenTarget: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        allowUrlPdfRead: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        reopenBehavior: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        scopeChangeBehavior: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        defaultCopyFormat: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        chatInsertContent: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
    }>>, "plain">;
    static readonly inject: string[];
    constructor(ctx: Context, config?: LibraryConfig);
    /** Read one existing URL attachment after independent user-reading authorization. */
    readUrlPdf(request: {
        ref: string;
    }, signal: AbortSignal): Promise<ZoteroUrlPdfView>;
    private readResolvedUrlPdf;
    releaseUrlPdf(request: {
        lease: string;
    }, signal: AbortSignal): Promise<{
        released: true;
    }>;
    /**
     * The exact parent chain of one collection, read fresh under the caller's
     * library version. Read-only and gated on the browse capability, because it
     * walks the same collection endpoints the browse listings do.
     * @param request - the library, the collection ref, and the version to prove.
     * @param signal - caller cancellation.
     * @returns the rows from root to target and the version they were read at.
     */
    collectionPath(request: ZoteroCollectionPathRequestView, signal: AbortSignal): Promise<ZoteroCollectionPathResultView>;
    /**
     * The panel's page size is the request's, clamped to the core read bounds:
     * the panel consumes the same provider limits the tools honor, so a lowered
     * `maxBrowseResults`/`maxSearchResults` narrows its pages. The view echoes
     * the effective size for the client's pager.
     */
    browse(request: ZoteroLibraryBrowseRequestView, signal: AbortSignal): Promise<ZoteroLibraryBrowseResultView>;
    search(request: ZoteroLibrarySearchRequestView, signal: AbortSignal): Promise<ZoteroSearchResultView>;
    item(request: ZoteroLibraryItemRequestView, signal: AbortSignal): Promise<ZoteroItemDetailView>;
    childPage(request: ZoteroLibraryChildPageRequestView, signal: AbortSignal): Promise<ZoteroChildPageView>;
    /**
     * Export the requested refs as citations, a bibliography, or a translator
     * format. The panel renders the rendered text only: it takes the provider's
     * text arm through `service.exportText`, so no per-document itemization
     * runs. The live `maxExportRefs` cap refuses an over-long list with the
     * same message the tool uses, and style/locale are forwarded only when the
     * panel supplied them so the export domain's configured defaults apply.
     * The cap check rides `domainCall` so the panel receives the same stable
     * `ZOTERO_INVALID_ARGUMENT` the tool reports, not a generic gateway error.
     */
    export(request: ZoteroLibraryExportRequestView, signal: AbortSignal): Promise<ZoteroLibraryExportResultView>;
    write(request: ZoteroLibraryWriteRequestView, signal: AbortSignal): Promise<ZoteroLibraryWriteResultView>;
}
export default ZoteroLibraryService;
//# sourceMappingURL=service.d.ts.map