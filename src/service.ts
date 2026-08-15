/**
 * `ctx.zotero`: the stable research-domain boundary of the plugin.
 *
 * The service owns provider selection (configured id must be registered —
 * there is no cross-provider fallback and no request replay), capability
 * gating, and the domain methods the model-facing tools consume. The HTTP
 * transport and the Zotero object model stay below this boundary.
 * @module dsh-zotero/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { ZoteroHttpClient } from './client.js'
import { registerStatusCommand } from './command.js'
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
import { LocalApiProvider } from './provider-local.js'
import { registerPromptSection } from './prompt.js'
import { registerAttachmentTool } from './tools/attachment.js'
import { registerGetTool } from './tools/get.js'
import { registerExportTool } from './tools/export.js'
import { registerRetrieveTool } from './tools/retrieve.js'
import { registerSearchTool } from './tools/search.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroCapability,
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
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'zotero')
    this.config = resolveConfig(config)
    const client = new ZoteroHttpClient({
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
    })
    this.registerProvider(
      new LocalApiProvider(client, {
        maxDetailChars: this.config.maxDetailChars,
        maxNoteBodyChars: this.config.maxNoteBodyChars,
        maxNoteChars: this.config.maxNoteChars,
        maxNoteRecords: this.config.maxNoteRecords,
        maxAnnotationRecords: this.config.maxAnnotationRecords,
        fulltextChunkWords: this.config.fulltextChunkWords,
        maxEvidenceChars: this.config.maxEvidenceChars,
        maxEvidencePassages: this.config.maxEvidencePassages,
        maxFulltextChars: this.config.maxFulltextChars,
        maxExportChars: this.config.maxExportChars,
        defaultStyle: this.config.defaultStyle,
        defaultLocale: this.config.defaultLocale,
      }),
    )
    registerStatusCommand(ctx, this)
    registerPromptSection(ctx)
    registerSearchTool(ctx, this, this.config)
    registerGetTool(ctx, this)
    registerAttachmentTool(ctx, this)
    registerRetrieveTool(ctx, this, this.config)
    registerExportTool(ctx, this, this.config)
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
    this.requireCapability(provider, 'fulltext')
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

export default ZoteroService
