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
 * `local` provider so web-edited values apply without a restart. A settings
 * commit runs `rebuild()` on this same instance — it never replaces
 * `ctx.zotero` and never replaces the connectivity recovery gate.
 * @module dsh-zotero/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.typert` Context merge into this program.
import type {} from '@deepseek-ai/dsh-typert-registry'
// Type-only: brings the `ctx.credentials` Context merge into this program.
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ConnectivityRecovery } from './ask.js'
import { ZoteroHttpClient } from './http-client.js'
import { registerStatusCommand } from './command.js'
import { ZoteroRuntime } from './remote.js'
import { TYPERT_MANIFEST } from './typert.js'
import { WriteAuthorizer } from './write-auth.js'
import { ZoteroWriteHttpClient } from './write-http.js'
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
import { registerCreateNoteTool } from './tools/create-note.js'
import { registerAddTagsTool } from './tools/add-tags.js'
import { registerAddToCollectionTool } from './tools/add-to-collection.js'
import { writePolicyDecision } from './tools/write-approval.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroCollectionAddRequest,
  ZoteroCollectionAddResult,
  ZoteroCreateNoteRequest,
  ZoteroCreateNoteResult,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroProvider,
  ZoteroProviderMethod,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroStatus,
  ZoteroTagUpdateRequest,
  ZoteroTagUpdateResult,
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
  /**
   * Connectivity recovery gate for this service instance.
   *
   * Concurrent tool calls that hit the same ask-worthy failure (Zotero down,
   * local API disabled, no shared API version, timeout) share one question
   * instead of stacking a card per call. The gate's Map holds only in-flight
   * asks; each entry is deleted when that question settles, so a later
   * failure asks again.
   *
   * Owned by the `ZoteroService` instance for the fiber lifetime — **not** by
   * a config generation. A settings commit calls {@link rebuild}, which
   * replaces HTTP clients and the `local` provider on this same instance; it
   * must not replace this gate. Swapping recovery on rebuild would fork the
   * conversation (in-flight waiters on the old gate, new failures on a new
   * one) and stack duplicate cards — the opposite of this class's purpose.
   * Retry paths re-enter `service.*` at call time and therefore see the
   * rebuilt provider without touching the gate.
   */
  readonly recovery = new ConnectivityRecovery()
  /** Current config authority: the settings section while one is attached, the composition entry otherwise. */
  private source: () => ResolvedConfig
  /** Disposer of the currently registered `local` provider, released before a rebuild re-registers it. */
  private providerDispose: (() => void) | undefined
  /** Disposers of the conditionally registered write tools, tracked for the writeEnabled flip. */
  private writeToolDisposes: Array<() => void> = []

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
    // Pre-dispatch write policy: deny with ToolErrorInfo.reason when the
    // capability flipped off after the write tools were registered. The
    // listener stays synchronous on the allow path so a non-write call (and a
    // write call that passes) does not add an extra microtask before the tool
    // body — that hop would let fiber disposal unregister tools first and turn
    // an in-flight call into UNKNOWN_TOOL instead of its own domain result.
    ctx.effect(
      () =>
        ctx.on('tools/pre-execute', (exec, next) => {
          const decision = writePolicyDecision(this, exec)
          if (decision !== undefined) return Promise.resolve(decision)
          return next()
        }),
      'dsh-zotero: write policy gate',
    )
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
   * Rebuild the live transport stack from the current config on **this**
   * instance. The settings section's `onChange` (and the constructor's first
   * pass) both call this — never a service replacement.
   *
   * **Rebuilt:** HTTP client, write client, write authorizer, the `local`
   * provider registration (previous registration disposed first so the
   * duplicate-id guard never fires), and the write-tool set when
   * `writeEnabled` flips. A request already in flight finishes on the client
   * it started with; later calls resolve the fresh provider.
   *
   * **Not rebuilt:** `ZoteroService` identity and the `ctx.zotero` binding,
   * {@link recovery} (service-lifetime dedupe gate), read-tool registrations,
   * the prompt section, `/zotero`, and the Typert manifest.
   *
   * The write transport and authorizer exist only while `writeEnabled` is
   * set: without them the provider declares no `write` capability, so the
   * gate answers before any network happens.
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
    const writeEnabled = config.writeEnabled
    const writer = writeEnabled
      ? new ZoteroWriteHttpClient({
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
          maxResponseBytes: config.maxResponseBytes,
        })
      : undefined
    const authorizer =
      writer === undefined
        ? undefined
        : new WriteAuthorizer({
            client: writer,
            credentials: this.credentials(),
            persistKey: () => this.config.writePersistKey,
          })
    this.providerDispose = this.registerProvider(
      new LocalApiProvider(client, localProviderLimits(config), {}, writer, authorizer),
    )
    this.reconcileWriteTools(config.writeEnabled)
  }

  /**
   * Register or retire the write tools as `writeEnabled` flips. When the
   * flag is off the tools are absent from the model's surface entirely — a
   * tool that can only ever answer "write capability is disabled" would
   * invite the model to retry it — and a settings commit re-registers them
   * without a restart, like the provider itself.
   */
  private reconcileWriteTools(enabled: boolean): void {
    if (enabled && this.writeToolDisposes.length === 0) {
      this.writeToolDisposes = [
        registerCreateNoteTool(this.ctx, this),
        registerAddTagsTool(this.ctx, this),
        registerAddToCollectionTool(this.ctx, this),
      ]
    } else if (!enabled && this.writeToolDisposes.length > 0) {
      for (const dispose of this.writeToolDisposes) dispose()
      this.writeToolDisposes = []
    }
  }

  /**
   * The host credentials seam, resolved lazily: a composition without a
   * credentials service keeps write grants in memory only, and the plugin
   * never hard-depends on the seam being mounted.
   */
  private credentials(): CredentialProvider | undefined {
    return this.ctx.get('credentials')
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
    const search = this.requireMethod(provider, 'search')
    return await search(request, signal)
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
    const getItem = this.requireMethod(provider, 'getItem')
    return await getItem(request, signal)
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
    const children = this.requireMethod(provider, 'children')
    return await children(request, signal)
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
    const getAttachmentLocation = this.requireMethod(provider, 'getAttachmentLocation')
    return await getAttachmentLocation(ref, signal)
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
    const retrieve = this.requireMethod(provider, 'retrieve')
    return await retrieve(request, signal)
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
    const doExport = this.requireMethod(provider, 'export')
    return await doExport(request, signal)
  }

  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'browse')
    const browse = this.requireMethod(provider, 'browse')
    return await browse(request, signal)
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
    const changes = this.requireMethod(provider, 'changes')
    return await changes(request, signal)
  }

  /**
   * Create a research note (standalone, or a child note under a parent item)
   * with tags, collections, and source relations. The write capability gate
   * answers before any network; the plan-review approval the tool shows the
   * user happens before this method is called.
   * @param request - the markdown body, optional parent, collections, tags, and sources.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the created note's ref, version, and the saved collections/tags/relations.
   */
  async createNote(
    request: ZoteroCreateNoteRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateNoteResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'write')
    const createNote = this.requireMethod(provider, 'createNote')
    return await createNote(request, signal)
  }

  /**
   * Add tags to an item, preserving what it already carries.
   * @param request - the item ref and the tags to add.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the merged tag list, the additions, and the resulting versions.
   */
  async updateTags(
    request: ZoteroTagUpdateRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroTagUpdateResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'write')
    const updateTags = this.requireMethod(provider, 'updateTags')
    return await updateTags(request, signal)
  }

  /**
   * Add an item to a collection.
   * @param request - the item ref and the collection ref or name.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the resulting collection list and whether the membership is new.
   */
  async addToCollection(
    request: ZoteroCollectionAddRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCollectionAddResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'write')
    const addToCollection = this.requireMethod(provider, 'addToCollection')
    return await addToCollection(request, signal)
  }

  private resolveProvider(): ZoteroProvider {
    const provider = this.providers.get(this.config.provider)
    if (provider === undefined) {
      throw new ZoteroError(
        `No Zotero provider "${this.config.provider}" is registered.`,
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    }
    return provider
  }

  private requireCapability(provider: ZoteroProvider, capability: ZoteroCapability): void {
    if (!provider.capabilities.has(capability)) {
      throw new ZoteroError(
        `Zotero provider "${provider.id}" does not support the ${capability} capability.`,
        ZOTERO_CAPABILITY_UNAVAILABLE,
      )
    }
  }

  /**
   * Second gate behind `requireCapability`: the method itself must exist.
   * A provider that declares a capability but leaves the method undefined is
   * miswired, so this fails with `ZOTERO_PROVIDER_UNAVAILABLE` (provider bug)
   * rather than the capability code (unsupported domain). The returned
   * function is bound to the provider so class-method `this` survives the
   * detachment.
   */
  private requireMethod<M extends ZoteroProviderMethod>(
    provider: ZoteroProvider,
    method: M,
  ): NonNullable<ZoteroProvider[M]> {
    const fn: unknown = provider[method]
    if (typeof fn !== 'function') {
      throw new ZoteroError(
        `Zotero provider "${provider.id}" declares support but does not implement ${method}.`,
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    }
    const bound = (fn as (...args: never[]) => unknown).bind(provider)
    return bound as NonNullable<ZoteroProvider[M]>
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
    maxChangesResults: config.maxChangesResults,
    defaultStyle: config.defaultStyle,
    defaultLocale: config.defaultLocale,
  }
}

export default ZoteroService
