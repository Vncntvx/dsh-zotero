/**
 * `ctx.zotero`: the stable research-domain boundary of the plugin.
 *
 * The service owns provider selection (configured id must be registered —
 * there is no cross-provider fallback and no request replay), capability
 * gating, and the domain methods the model-facing tools consume. The HTTP
 * transport and the Zotero object model stay below this boundary.
 *
 * The plugin is request-driven by design: loading it never touches Zotero
 * (no probes, no timers, no background work). The only request sources are
 * the tools, invoked because the user asked about their library, and
 * the `/zotero status` command the user invokes explicitly.
 *
 * The effective config is live: while a settings service is composed, the
 * `zotero` settings namespace (composition entry as its base layer) is the
 * authority, and every committed section rebuilds the HTTP client and the
 * `local` provider so web-edited values apply without a restart.
 * @module dsh-zotero/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.typert` Context merge into this program.
import type {} from '@deepseek-ai/dsh-typert-registry'
import { ZoteroHttpClient } from './http-client.js'
import { registerStatusCommand } from './command.js'
import { ZoteroRuntime } from './remote.js'
import { TYPERT_MANIFEST } from './typert.js'
import {
  Config as ConfigSchema,
  resolveConfig,
  type Config,
  type ResolvedConfig,
} from './config.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from './errors.js'
import { LocalApiProvider } from './local/provider.js'
import type { LocalApiLimits } from './local/limits.js'
import { registerPromptSection } from './prompt.js'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'
import { registerAttachmentTool } from './tools/attachment.js'
import { registerBrowseTool } from './tools/browse.js'
import { registerChangesTool } from './tools/changes.js'
import { registerChildrenTool } from './tools/children.js'
import { registerGetTool } from './tools/get.js'
import { registerExportTool } from './tools/export.js'
import { registerRetrieveTool } from './tools/retrieve.js'
import { registerSearchTool } from './tools/search.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroProvider,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroStatus,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    zotero: ZoteroService
  }
}

export class ZoteroService extends Service {
  static inject = ['tools', 'systemPrompt']

  static Config = ConfigSchema

  private readonly providers = new Map<string, ZoteroProvider>()
  /** Current config authority: the settings section while one is attached, the composition entry otherwise. */
  private source: () => ResolvedConfig
  /** Disposer of the currently registered `local` provider, released before a rebuild re-registers it. */
  private providerDispose: (() => void) | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'zotero')
    // Schemastery fills every schema default before the constructor runs; the
    // extra constraints resolveConfig enforces are what make the entry sound.
    const entry = resolveConfig(config)
    this.source = () => entry
    this.rebuild()
    registerStatusCommand(ctx, this)
    registerPromptSection(ctx, () => this.config)
    registerSearchTool(ctx, this)
    registerGetTool(ctx, this)
    registerChildrenTool(ctx, this)
    registerAttachmentTool(ctx, this)
    registerRetrieveTool(ctx, this)
    registerExportTool(ctx, this)
    registerBrowseTool(ctx, this)
    registerChangesTool(ctx, this)
    // The settings attach runs through a cordis fiber, never synchronously
    // inside the install: when a settings service is composed, setSource
    // switches the config authority and onChange rebuilds shortly after this
    // constructor — the entry-config build here serves headless compositions
    // and the window before that attach.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, ZOTERO_SETTINGS_NAMESPACE, ConfigSchema, entry, {
        validate: resolveConfig,
        setSource: (current) => {
          // The settings-resolved value carries every schema default and has
          // passed the resolveConfig validate hook, so it is ResolvedConfig at
          // runtime even though the seam types it as Config.
          this.source = current as () => ResolvedConfig
        },
        onChange: () => {
          this.rebuild()
        },
      })
    })
    // The settings page's data channel: the Remote service binds the wire
    // namespace, and the strict manifest claims its endpoints. See typert.ts
    // for why the manifest self-registers through ctx.inject(['typert']).
    new ZoteroRuntime(ctx)
    ctx.inject(['typert'], (host) => {
      host.effect(() => {
        const dispose = host.typert.register(TYPERT_MANIFEST)
        return () => {
          void dispose()
        }
      }, 'dsh-zotero: typert manifest')
    })
  }

  /**
   * The currently effective configuration: schema defaults, then the
   * composition entry, then the settings document's `zotero:` section.
   * @returns the live resolved config.
   */
  get config(): ResolvedConfig {
    return this.source()
  }

  /**
   * Rebuild the HTTP client and the `local` provider from the current config.
   * The previous provider registration is disposed first so the duplicate-id
   * guard never fires; a request already in flight finishes on the client it
   * started with, and later calls resolve the fresh provider.
   */
  private rebuild(): void {
    this.providerDispose?.()
    this.providerDispose = undefined
    const config = this.config
    const client = new ZoteroHttpClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    })
    this.providerDispose = this.registerProvider(
      new LocalApiProvider(client, localProviderLimits(config)),
    )
  }

  /**
   * Register a provider into the seam. Effect-scoped: unloading the
   * registering fiber removes the provider.
   * @throws {ZoteroError} `ZOTERO_PROVIDER_UNAVAILABLE` on a duplicate id.
   * @returns the registration disposer.
   */
  registerProvider(provider: ZoteroProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ZoteroError(
        `A Zotero provider with id "${provider.id}" is already registered.`,
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    }
    const providers = this.providers
    const dispose = this.ctx.effect(() => {
      providers.set(provider.id, provider)
      return () => {
        providers.delete(provider.id)
      }
    }, 'zotero.registerProvider()')
    return () => {
      void dispose()
    }
  }

  /**
   * Connectivity probe — the only health check; ordinary calls fail with typed errors instead.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns live connectivity facts for the configured provider.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    return this.resolveProvider().status(signal)
  }

  /**
   * Discover candidates; the provider resolves scopes and serves the compact records.
   * @param request - the search request with scope, mode, filters, and pagination.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the resolved scope plus the compact hit records and pagination facts.
   */
  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'search')
    return await provider.search(request, signal)
  }

  /**
   * Read one item's metadata plus optionally requested child content.
   * @param request - the item ref and the child kinds to include.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the normalized item detail.
   */
  async get(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'metadata')
    return await provider.getItem(request, signal)
  }

  /**
   * Explore one item's or attachment's child-object graph.
   * @param request - the item/attachment ref and the child kinds to return.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the bounded child collections with their totals.
   */
  async children(
    request: ZoteroChildrenRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroChildrenResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'metadata')
    return await provider.children(request, signal)
  }

  /**
   * Resolve an attachment ref to its on-disk file or linked URL.
   * @param ref - the item or attachment ref to resolve.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the verified file path or linked URL.
   */
  async attachment(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'attachments')
    return await provider.getAttachmentLocation(ref, signal)
  }

  /**
   * Gather ranked evidence passages for one item across the requested sources.
   * @param request - the item ref, ranking query, sources, and passage cap.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the bounded ranked evidence with a truncation flag.
   */
  async retrieve(
    request: ZoteroRetrieveRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRetrieveResult> {
    const provider = this.resolveProvider()
    // Retrieve is ranked evidence across sources — a broader contract than
    // raw fulltext access, so it gates on its own capability.
    this.requireCapability(provider, 'retrieve')
    return await provider.retrieve(request, signal)
  }

  /**
   * Export citations, a bibliography, or translator formats for the requested items.
   * @param request - the item refs and the export format plus optional style/locale.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns per-ref citations or the joined export text.
   */
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'citation')
    return await provider.export(request, signal)
  }

  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'browse')
    return await provider.browse(request, signal)
  }

  /**
   * Diff the library against a local transaction version.
   * @param request - the baseline version and the resource kinds to diff.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns changed/deleted keys plus the library's current version.
   */
  async changes(request: ZoteroChangesRequest, signal?: AbortSignal): Promise<ZoteroChangesResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'changes')
    return await provider.changes(request, signal)
  }

  protected resolveProvider(): ZoteroProvider {
    const provider = this.providers.get(this.config.provider)
    if (provider === undefined) {
      throw new ZoteroError(
        `No Zotero provider "${this.config.provider}" is registered.`,
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    }
    return provider
  }

  protected requireCapability(provider: ZoteroProvider, capability: ZoteroCapability): void {
    if (!provider.capabilities.has(capability)) {
      throw new ZoteroError(
        `Zotero provider "${provider.id}" does not support the ${capability} capability.`,
        ZOTERO_CAPABILITY_UNAVAILABLE,
      )
    }
  }
}

/**
 * Project one resolved config onto the `local` provider's limits. Shared by
 * the initial build and every live rebuild so both always agree.
 * @param config - the resolved config to project.
 * @returns the provider limits the transport and ranking behavior read.
 */
function localProviderLimits(config: ResolvedConfig): LocalApiLimits {
  return {
    maxNoteScanRecords: config.maxNoteScanRecords,
    maxDetailChars: config.maxDetailChars,
    maxNoteBodyChars: config.maxNoteBodyChars,
    maxNoteChars: config.maxNoteChars,
    maxNoteRecords: config.maxNoteRecords,
    maxAnnotationRecords: config.maxAnnotationRecords,
    fulltextChunkWords: config.fulltextChunkWords,
    maxEvidenceChars: config.maxEvidenceChars,
    maxEvidencePassages: config.maxEvidencePassages,
    maxFulltextChars: config.maxFulltextChars,
    maxExportChars: config.maxExportChars,
    maxBrowseResults: config.maxBrowseResults,
    defaultStyle: config.defaultStyle,
    defaultLocale: config.defaultLocale,
  }
}

export default ZoteroService
