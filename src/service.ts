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
import { Config as ConfigSchema, resolveConfig, type Config, type ResolvedConfig } from './config.js'
import { ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_PROVIDER_UNAVAILABLE, ZoteroError } from './errors.js'
import { LocalApiProvider } from './provider-local.js'
import { registerAttachmentTool } from './tools/attachment.js'
import { registerGetTool } from './tools/get.js'
import { registerSearchTool } from './tools/search.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroCapability,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroProvider,
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
    this.registerProvider(new LocalApiProvider(client, { maxDetailChars: this.config.maxDetailChars }))
    registerStatusCommand(ctx, this)
    registerSearchTool(ctx, this, this.config)
    registerGetTool(ctx, this)
    registerAttachmentTool(ctx, this)
  }

  /**
   * Register a provider into the seam. Effect-scoped: unloading the
   * registering fiber removes the provider.
   * @throws {ZoteroError} `ZOTERO_PROVIDER_UNAVAILABLE` on a duplicate id.
   * @returns the registration disposer.
   */
  registerProvider(provider: ZoteroProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ZoteroError(`A Zotero provider with id "${provider.id}" is already registered.`, ZOTERO_PROVIDER_UNAVAILABLE)
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

  /** Connectivity probe — the only health check; ordinary calls fail with typed errors instead. */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    return this.resolveProvider().status(signal)
  }

  /** Discover candidates; the provider resolves scopes and serves the compact records. */
  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'search')
    return await provider.search(request, signal)
  }

  /** Read one item's metadata plus optionally requested child content. */
  async get(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'metadata')
    return await provider.getItem(request, signal)
  }

  /** Resolve an attachment ref to its on-disk file or linked URL. */
  async attachment(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'attachments')
    return await provider.getAttachmentLocation(ref, signal)
  }

  protected resolveProvider(): ZoteroProvider {
    const provider = this.providers.get(this.config.provider)
    if (provider === undefined) {
      throw new ZoteroError(`No Zotero provider "${this.config.provider}" is registered.`, ZOTERO_PROVIDER_UNAVAILABLE)
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
