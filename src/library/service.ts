/**
 * Cordis Service plugin providing `ctx.zoteroLibrary` and its Typert remote
 * endpoints: browse, search, item detail, citation/BibTeX export, and
 * approved writes.
 *
 * @module dsh-zotero/library/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { domainCall } from '../errors.js'
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
import { LibraryConfigSchema, type LibraryConfig } from './config.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    zoteroLibrary: ZoteroLibraryService
  }
}

/** The library panel's host service: browse, search, item detail, child page, export, and approved writes. */
export class ZoteroLibraryService extends TypertRemoteService {
  static readonly Config = LibraryConfigSchema
  static readonly inject = ['zotero']

  constructor(
    ctx: Context,
    public config: LibraryConfig = {},
  ) {
    super(ctx, ZOTERO_LIBRARY_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })

    // Configuration comes from the client's SettingsSection; the framework
    // does not generate a settings page from the schema.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
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
