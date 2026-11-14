import { pathToFileURL } from 'node:url';
import { PdfReadingFiles } from './pdf-files.js';
import { UrlPdfReader } from './url-pdf.js';
import { dnsAddressResolver, createPinnedDispatcher, publicFetch, } from '../transport/connections.js';
import { zoteroReadUrlPdfRequestSchema, zoteroReleaseUrlPdfSchema } from '../wire-schemas.js';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { isOwnConfigFiber } from '../service-lifecycle.js';
import { domainCall, invalid, ZoteroError } from '../errors.js';
import { assertExportRefsWithinCap } from '../export-limits.js';
import { executeLibraryWrite } from '../library-write.js';
import { browseRequestOf, browseViewOf, childPageRequestOf, childPageViewOf, exportRequestOf, exportViewOf, itemRequestOf, itemViewOf, searchOptionsOf, searchRequestOf, searchViewOf, } from '../library-views.js';
import { requireZoteroService } from '../service.js';
import { ZOTERO_LIBRARY_SERVICE_KEY, ZOTERO_SETTINGS_NAMESPACE, } from '../contract.js';
import { LibraryConfigSchema, resolveLibraryConfig } from './config.js';
/** The library panel's host service: browse, search, item detail, child page, export, and approved writes. */
export class ZoteroLibraryService extends TypertRemoteService {
    config;
    urlPdf;
    pdfFiles = new PdfReadingFiles();
    reading = new Set();
    static Config = LibraryConfigSchema;
    static inject = ['zotero'];
    constructor(ctx, config = {}) {
        super(ctx, ZOTERO_LIBRARY_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE });
        this.config = config;
        resolveLibraryConfig(config);
        this.urlPdf = new UrlPdfReader({
            allowed: () => resolveLibraryConfig(this.config).allowUrlPdfRead,
            resolver: dnsAddressResolver,
            dispatcher: createPinnedDispatcher,
            fetch: publicFetch,
        });
        ctx.on('loader/volatile-update', () => this.urlPdf.revoke());
        ctx.effect(() => async () => {
            await Promise.allSettled([...this.reading]);
            await this.pdfFiles.dispose();
        });
        ctx.on('internal/config', (fiber, next) => {
            const raw = next();
            if (isOwnConfigFiber(fiber, ctx.fiber))
                resolveLibraryConfig(raw);
            return raw;
        });
        // Configuration comes from the client's SettingsSection; the framework
        // does not generate a settings page from the schema.
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        });
    }
    /** Read one existing URL attachment after independent user-reading authorization. */
    async readUrlPdf(request, signal) {
        const task = domainCall(async () => {
            if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
                throw new ZoteroError('URL PDF reading is disabled in Literature panel settings.', 'ZOTERO_URL_PDF_DISABLED');
            const ref = zoteroReadUrlPdfRequestSchema.parse(request).ref;
            const attachment = await requireZoteroService(this.ctx, signal).resolveAttachment(ref, signal);
            return await this.readResolvedUrlPdf(attachment, signal);
        });
        this.reading.add(task);
        try {
            return await task;
        }
        finally {
            this.reading.delete(task);
        }
    }
    async readResolvedUrlPdf(attachment, signal) {
        if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
            throw new ZoteroError('URL PDF reading is disabled in Literature panel settings.', 'ZOTERO_URL_PDF_DISABLED');
        const fs = this.ctx.get('fs');
        if (!fs)
            throw new Error('The host filesystem required for PDF reading is unavailable.');
        const pdf = await this.urlPdf.read(attachment, signal);
        const file = await this.pdfFiles.stage(pdf.data, signal);
        try {
            const mapped = fs.processPathFromHostPath(file.path);
            if (!mapped)
                throw new Error('The session filesystem cannot read host PDF files.');
            const target = await fs.resolve(mapped, { signal });
            if (fs.fileUrl(target) !== pathToFileURL(file.path).href)
                throw new Error('The session filesystem has no verified mapping for this PDF.');
            signal.throwIfAborted();
            if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
                throw new ZoteroError('URL PDF reading permission was revoked.', 'ZOTERO_URL_PDF_DISABLED');
            return {
                ref: pdf.ref,
                title: pdf.title,
                contentType: pdf.contentType,
                path: fs.processPath(target),
                lease: file.lease,
            };
        }
        catch (error) {
            await this.pdfFiles.release(file.lease);
            throw error;
        }
    }
    async releaseUrlPdf(request, signal) {
        signal.throwIfAborted();
        return domainCall(async () => {
            await this.pdfFiles.release(zoteroReleaseUrlPdfSchema.parse(request).lease);
            return { released: true };
        });
    }
    /**
     * The exact parent chain of one collection, read fresh under the caller's
     * library version. Read-only and gated on the browse capability, because it
     * walks the same collection endpoints the browse listings do.
     * @param request - the library, the collection ref, and the version to prove.
     * @param signal - caller cancellation.
     * @returns the rows from root to target and the version they were read at.
     */
    async collectionPath(request, signal) {
        return domainCall(() => requireZoteroService(this.ctx, signal).collectionPath(request, signal));
    }
    /**
     * The panel's page size is the request's, clamped to the core read bounds:
     * the panel consumes the same provider limits the tools honor, so a lowered
     * `maxBrowseResults`/`maxSearchResults` narrows its pages. The view echoes
     * the effective size for the client's pager.
     */
    async browse(request, signal) {
        return await domainCall(async () => {
            const service = requireZoteroService(this.ctx, signal);
            const domain = browseRequestOf(request);
            const limit = Math.min(domain.limit, service.config.maxBrowseResults);
            return browseViewOf(await service.browse({ ...domain, limit }, signal), limit);
        });
    }
    async search(request, signal) {
        return await domainCall(async () => {
            const service = requireZoteroService(this.ctx, signal);
            const domain = searchRequestOf(request);
            const limit = Math.min(domain.limit, service.config.maxSearchResults);
            return searchViewOf(await service.search({ ...domain, limit }, signal, searchOptionsOf(request)), limit);
        });
    }
    async item(request, signal) {
        return await domainCall(async () => {
            const service = requireZoteroService(this.ctx, signal);
            return itemViewOf(await service.get(itemRequestOf(request), signal));
        });
    }
    async childPage(request, signal) {
        return await domainCall(async () => {
            const service = requireZoteroService(this.ctx, signal);
            return childPageViewOf(await service.childPage(childPageRequestOf(request), signal));
        });
    }
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
    async export(request, signal) {
        return await domainCall(async () => {
            const service = requireZoteroService(this.ctx, signal);
            assertExportRefsWithinCap(request.refs.length, service.config.maxExportRefs, invalid);
            return exportViewOf(await service.exportText(exportRequestOf(request), signal));
        });
    }
    async write(request, signal) {
        // The whole pipeline rides `domainCall`, so a missing service, a disabled
        // write, and an unroutable session all answer with a stable code.
        return domainCall(() => executeLibraryWrite(this.ctx, request, signal));
    }
}
export default ZoteroLibraryService;
//# sourceMappingURL=service.js.map