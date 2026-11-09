import type {} from '@deepseek-ai/dsh-fs'
import { pathToFileURL } from 'node:url'
import { PdfReadingFiles } from './pdf-files.js'
import { UrlPdfReader } from './url-pdf.js'
import { dnsAddressResolver, createPinnedDispatcher } from '../transport/connections.js'
import { zoteroReadUrlPdfRequestSchema, zoteroReleaseUrlPdfSchema } from '../wire-schemas.js'
import type { ZoteroUrlPdfView } from '../contract.js'
import type { ZoteroAttachmentLocationView } from '../contract.js'
/**
 * Cordis Service plugin providing `ctx.zoteroLibrary` and its Typert remote
 * endpoints: browse, collection path, search, item detail, citation/BibTeX
 * export, and approved writes.
 *
 * @module dsh-zotero/library/service
 */

import type {
  ZoteroCollectionPathRequestView,
  ZoteroCollectionPathResultView,
} from '../contract.js'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { isOwnConfigFiber } from '../service-lifecycle.js'
import { domainCall, ZoteroError } from '../errors.js'
import { assertExportRefsWithinCap } from '../export-limits.js'
import { executeLibraryWrite } from '../library-write.js'
import {
  browseRequestOf,
  browseViewOf,
  childPageRequestOf,
  childPageViewOf,
  exportRequestOf,
  exportViewOf,
  itemRequestOf,
  itemViewOf,
  searchOptionsOf,
  searchRequestOf,
  searchViewOf,
} from '../library-views.js'
import { requireZoteroService } from '../service.js'
import {
  ZOTERO_LIBRARY_SERVICE_KEY,
  ZOTERO_SETTINGS_NAMESPACE,
  type ZoteroChildPageView,
  type ZoteroItemDetailView,
  type ZoteroLibraryBrowseRequestView,
  type ZoteroLibraryBrowseResultView,
  type ZoteroLibraryChildPageRequestView,
  type ZoteroLibraryExportRequestView,
  type ZoteroLibraryExportResultView,
  type ZoteroLibraryItemRequestView,
  type ZoteroLibrarySearchRequestView,
  type ZoteroLibraryWriteRequestView,
  type ZoteroLibraryWriteResultView,
  type ZoteroSearchResultView,
} from '../contract.js'
import { LibraryConfigSchema, resolveLibraryConfig, type LibraryConfig } from './config.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    zoteroLibrary: ZoteroLibraryService
  }
}

/** The library panel's host service: browse, search, item detail, child page, export, and approved writes. */
export class ZoteroLibraryService extends TypertRemoteService {
  private readonly urlPdf: UrlPdfReader
  private readonly pdfFiles = new PdfReadingFiles()
  private readonly reading = new Set<Promise<unknown>>()
  static readonly Config = LibraryConfigSchema
  static readonly inject = ['zotero']

  constructor(
    ctx: Context,
    public config: LibraryConfig = {},
  ) {
    super(ctx, ZOTERO_LIBRARY_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })

    resolveLibraryConfig(config)
    this.urlPdf = new UrlPdfReader({
      allowed: () => resolveLibraryConfig(this.config).allowUrlPdfRead,
      resolver: dnsAddressResolver,
      dispatcher: createPinnedDispatcher,
      fetch: globalThis.fetch,
    })
    ctx.on('loader/volatile-update', () => this.urlPdf.revoke())
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.reading])
      await this.pdfFiles.dispose()
    })
    ctx.on('internal/config', (fiber, next) => {
      const raw = next()
      if (isOwnConfigFiber(fiber, ctx.fiber)) resolveLibraryConfig(raw as LibraryConfig)
      return raw
    })

    // Configuration comes from the client's SettingsSection; the framework
    // does not generate a settings page from the schema.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /** Read one existing URL attachment after independent user-reading authorization. */
  async readUrlPdf(request: { ref: string }, signal: AbortSignal): Promise<ZoteroUrlPdfView> {
    const task = domainCall(async () => {
      if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
        throw new ZoteroError(
          'URL PDF reading is disabled in Literature panel settings.',
          'ZOTERO_URL_PDF_DISABLED',
        )
      const ref = zoteroReadUrlPdfRequestSchema.parse(request).ref
      const attachment = await requireZoteroService(this.ctx, signal).resolveAttachment(ref, signal)
      return await this.readResolvedUrlPdf(attachment, signal)
    })
    this.reading.add(task)
    try {
      return await task
    } finally {
      this.reading.delete(task)
    }
  }

  private async readResolvedUrlPdf(
    attachment: ZoteroAttachmentLocationView,
    signal: AbortSignal,
  ): Promise<ZoteroUrlPdfView> {
    if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
      throw new ZoteroError(
        'URL PDF reading is disabled in Literature panel settings.',
        'ZOTERO_URL_PDF_DISABLED',
      )
    const fs = this.ctx.get('fs')
    if (!fs) throw new Error('The host filesystem required for PDF reading is unavailable.')
    const pdf = await this.urlPdf.read(attachment, signal)
    const file = await this.pdfFiles.stage(pdf.data, signal)
    try {
      const mapped = fs.processPathFromHostPath(file.path)
      if (!mapped) throw new Error('The session filesystem cannot read host PDF files.')
      const target = await fs.resolve(mapped, { signal })
      if (fs.fileUrl(target) !== pathToFileURL(file.path).href)
        throw new Error('The session filesystem has no verified mapping for this PDF.')
      signal.throwIfAborted()
      if (!resolveLibraryConfig(this.config).allowUrlPdfRead)
        throw new ZoteroError('URL PDF reading permission was revoked.', 'ZOTERO_URL_PDF_DISABLED')
      return {
        ref: pdf.ref,
        title: pdf.title,
        contentType: pdf.contentType,
        path: fs.processPath(target),
        lease: file.lease,
      }
    } catch (error) {
      await this.pdfFiles.release(file.lease)
      throw error
    }
  }

  async releaseUrlPdf(
    request: { lease: string },
    signal: AbortSignal,
  ): Promise<{ released: true }> {
    signal.throwIfAborted()
    return domainCall(async () => {
      await this.pdfFiles.release(zoteroReleaseUrlPdfSchema.parse(request).lease)
      return { released: true }
    })
  }

  /**
   * The exact parent chain of one collection, read fresh under the caller's
   * library version. Read-only and gated on the browse capability, because it
   * walks the same collection endpoints the browse listings do.
   * @param request - the library, the collection ref, and the version to prove.
   * @param signal - caller cancellation.
   * @returns the rows from root to target and the version they were read at.
   */
  async collectionPath(
    request: ZoteroCollectionPathRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroCollectionPathResultView> {
    return domainCall(() => requireZoteroService(this.ctx, signal).collectionPath(request, signal))
  }

  /**
   * The panel's page size is the request's, clamped to the core read bounds:
   * the panel consumes the same provider limits the tools honor, so a lowered
   * `maxBrowseResults`/`maxSearchResults` narrows its pages. The view echoes
   * the effective size for the client's pager.
   */
  async browse(
    request: ZoteroLibraryBrowseRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryBrowseResultView> {
    const service = requireZoteroService(this.ctx, signal)
    const domain = browseRequestOf(request)
    const limit = Math.min(domain.limit, service.config.maxBrowseResults)
    return await domainCall(async () =>
      browseViewOf(await service.browse({ ...domain, limit }, signal), limit),
    )
  }

  async search(
    request: ZoteroLibrarySearchRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSearchResultView> {
    const service = requireZoteroService(this.ctx, signal)
    const domain = searchRequestOf(request)
    const limit = Math.min(domain.limit, service.config.maxSearchResults)
    return await domainCall(async () =>
      searchViewOf(
        await service.search({ ...domain, limit }, signal, searchOptionsOf(request)),
        limit,
      ),
    )
  }

  async item(
    request: ZoteroLibraryItemRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroItemDetailView> {
    const service = requireZoteroService(this.ctx, signal)
    return await domainCall(async () =>
      itemViewOf(await service.get(itemRequestOf(request), signal)),
    )
  }

  async childPage(
    request: ZoteroLibraryChildPageRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroChildPageView> {
    const service = requireZoteroService(this.ctx, signal)
    return await domainCall(async () =>
      childPageViewOf(await service.childPage(childPageRequestOf(request), signal)),
    )
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
  async export(
    request: ZoteroLibraryExportRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryExportResultView> {
    const service = requireZoteroService(this.ctx, signal)
    return await domainCall(async () => {
      assertExportRefsWithinCap(request.refs.length, service.config.maxExportRefs)
      return exportViewOf(await service.exportText(exportRequestOf(request), signal))
    })
  }

  async write(
    request: ZoteroLibraryWriteRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryWriteResultView> {
    // The whole pipeline rides `domainCall`, so a missing service, a disabled
    // write, and an unroutable session all answer with a stable code.
    return domainCall(() => executeLibraryWrite(this.ctx, request, signal))
  }
}

export default ZoteroLibraryService
