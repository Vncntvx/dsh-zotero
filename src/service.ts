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
 * The effective config is live: every schema field is `volatile`, so a
 * settings commit lands in the running fiber's references without remounting
 * and tools read it per request. Structural flips (transport fields, the
 * write flags) rebuild on `loader/volatile-update` on this same instance —
 * never a service replacement, and never a new `ConnectivityRecovery`
 * (that gate is service-lifetime state; swapping it on rebuild would stack
 * duplicate connectivity cards). A violating commit is vetoed in
 * `internal/config` before it lands, so the live read only ever observes
 * values `resolveConfig` accepts.
 * @module dsh-zotero/service
 */

import { Service, type Context, type Fiber } from '@deepseek-ai/cordis'
// Type-only: brings the loader `loader/volatile-update` Events merge into
// this program (the structural-flip reaction below).
import type {} from '@deepseek-ai/cordis-plugin-loader'
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
  readResolvedConfig,
  resolveConfig,
  toLiveEntry,
  type Config,
  type Options,
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
  ZoteroCreateNoteCommittedOutcome,
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

/**
 * Whether an `internal/config` waterfall `this` is this plugin's fiber.
 * The Loader passes the fiber itself; `ctx.plugin()` returns
 * `Object.create(fiber)`, so the prototype-linked face counts as the same
 * fiber. Anything else is another plugin's config resolution.
 * @param thisArg - the waterfall's bound `this`.
 * @param own - the fiber that owns this service.
 * @returns true when the candidate config belongs to this plugin.
 */
function isOwnConfigFiber(thisArg: unknown, own: Fiber): boolean {
  if (thisArg === own) return true
  return typeof thisArg === 'object' && thisArg !== null && Object.getPrototypeOf(thisArg) === own
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
   * a config generation. A volatile commit calls `buildTransport`, which
   * replaces HTTP clients and the `local` provider on this same instance; it
   * must not replace this gate. Swapping recovery on rebuild would fork the
   * conversation (in-flight waiters on the old gate, new failures on a new
   * one) and stack duplicate cards — the opposite of this class's purpose.
   * Retry paths re-enter `service.*` at call time and therefore see the
   * rebuilt provider without touching the gate.
   */
  readonly recovery = new ConnectivityRecovery()
  /**
   * The live entry config: Loader-delivered volatile references (commits
   * write those same refs) or a complete plain snapshot. Tools read through
   * {@link config} per request so settings edits apply without a restart.
   */
  private readonly entry: Config | Options
  /** Disposer of the currently registered `local` provider, released before a rebuild re-registers it. */
  private providerDispose: (() => void) | undefined
  /** Disposers of the conditionally registered write tools, tracked for the writeEnabled flip. */
  private writeToolDisposes: Array<() => void> = []
  /** The resolved config the transport stack was last built from. */
  private lastBuilt: ResolvedConfig
  /** Cached resolved config; invalidated on any loader/volatile-update. */
  private cachedConfig?: ResolvedConfig

  constructor(ctx: Context, config: Config | Options = {}) {
    super(ctx, 'zotero')
    // Fail the load loud on a violating entry; the same gate vetoes
    // violating settings commits in `internal/config` below.
    resolveConfig(config)
    this.entry = toLiveEntry(config)
    this.lastBuilt = this.config
    this.buildTransport(this.lastBuilt)
    // Veto a settings commit the schema alone cannot refuse (loopback-only
    // baseUrl, positive limits): throwing here refuses the commit before it
    // lands, so the live read only ever observes accepted values. The guard
    // scopes the veto to this plugin's fiber: the loader passes the fiber
    // itself as the waterfall `this`, while `ctx.plugin()` returns
    // `Object.create(fiber)` — a prototype-linked face of the same fiber.
    ctx.on('internal/config', function (this: Fiber | null, _raw, next) {
      const raw = next()
      if (!isOwnConfigFiber(this, ctx.fiber)) return raw
      resolveConfig(raw as Config | Options)
      return raw
    })
    // Structural flips land without remounting: rebuild the transport stack
    // and reconcile the write tools on this same instance. Limit-only edits
    // need no reaction — the provider's per-call limits getter reads them.
    // Loader emits
    // `loader/volatile-update` fiber-filtered (`owner.fiber === fiber`), so a
    // listener on this fiber's ctx receives own updates without `global`.
    // Failures are logged, never thrown into the dispatch.
    ctx.on('loader/volatile-update', (paths: readonly (readonly string[])[]) => {
      this.cachedConfig = undefined
      if (!touchesTransport(paths)) return
      try {
        const config = this.config
        if (sameTransportConfig(config, this.lastBuilt)) return
        this.buildTransport(config)
        this.reconcileWriteTools(config.writeEnabled)
        this.lastBuilt = config
      } catch (error) {
        ctx.logger.error('dsh-zotero: failed to apply a configuration update')
        ctx.logger.error(error)
      }
    })
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
    // The status channel: the Remote service binds the wire namespace, and
    // the strict manifest claims its endpoints. See typert.ts for why the
    // manifest self-registers through ctx.inject(['typert']).
    new ZoteroRuntime(ctx)
    ctx.inject(['typert'], (host) => {
      host.effect(() => {
        const dispose = host.typert.register(TYPERT_MANIFEST)
        return () => {
          void dispose()
        }
      }, 'dsh-zotero: typert manifest')
    })
    this.reconcileWriteTools(this.config.writeEnabled)
  }

  /**
   * The currently effective configuration, read live from the entry's
   * volatile references on every access — tools call this per request, so
   * settings edits apply without a restart. Commits only land after passing
   * {@link resolveConfig} (load gate + `internal/config` veto), so the read
   * observes accepted values. Schemastery is not re-applied here; see
   * {@link readResolvedConfig}.
   * @returns the live resolved config.
   */
  get config(): ResolvedConfig {
    if (this.cachedConfig === undefined) {
      this.cachedConfig = readResolvedConfig(this.entry)
    }
    return this.cachedConfig
  }

  /**
   * Build the transport stack from the given config: HTTP client, write
   * client, write authorizer, and the `local` provider registration (the
   * previous registration is disposed first so the duplicate-id guard never
   * fires). A request already in flight finishes on the client it started
   * with; later calls resolve the fresh provider.
   *
   * The write transport and authorizer exist only while `writeEnabled` is
   * set: without them the provider declares no `write` capability, so the
   * gate answers before any network happens.
   */
  private buildTransport(config: ResolvedConfig): void {
    this.providerDispose?.()
    this.providerDispose = undefined
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
            credentials: () => this.credentials(),
            persistKey: () => this.config.writePersistKey,
          })
    this.providerDispose = this.registerProvider(
      new LocalApiProvider(client, () => localProviderLimits(this.config), {}, writer, authorizer),
    )
  }

  /**
   * Register or retire the write tools as `writeEnabled` flips. When the
   * flag is off the tools are absent from the model's surface entirely — a
   * tool that can only ever answer "write capability is disabled" would
   * invite the model to retry it. Runs once at construction and again on
   * every structural volatile-update.
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
    // Retrieve and changes consume full-text sources internally; the public
    // domain gate is the capability for the requested operation, not a raw-text method.
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
  ): Promise<ZoteroCreateNoteCommittedOutcome> {
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
 * Top-level config keys whose change rebuilds the transport stack: the HTTP
 * client identity and bounds, and the write-capability flip (writer,
 * authorizer, and tool set). `provider` and `writePersistKey` are live reads
 * (`resolveProvider()` and the authorizer's `persistKey` callback) and never
 * rebuild; limits and `writeConfirm`/`webEnabled` are read per request.
 */
export const TRANSPORT_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig> = new Set([
  'baseUrl',
  'timeoutMs',
  'maxResponseBytes',
  'writeEnabled',
])

/**
 * Whether a `loader/volatile-update` path list touches a transport key.
 * A root path (`[]`) means the whole config moved as one reference.
 * @param paths - the changed field paths the loader reported.
 * @returns true when the transport stack may need a rebuild.
 */
export function touchesTransport(paths: readonly (readonly string[])[]): boolean {
  return paths.some(
    (path) =>
      path.length === 0 ||
      (path[0] !== undefined && TRANSPORT_CONFIG_KEYS.has(path[0] as keyof ResolvedConfig)),
  )
}

/**
 * Whether two resolved configs agree on every field the transport stack is
 * built from. Limits and display fields are read per request and never
 * trigger a rebuild.
 * @param current - the live resolved config.
 * @param built - the config the transport was last built from.
 * @returns true when no rebuild is needed.
 */
function sameTransportConfig(current: ResolvedConfig, built: ResolvedConfig): boolean {
  for (const key of TRANSPORT_CONFIG_KEYS) {
    if (current[key] !== built[key]) return false
  }
  return true
}

/**
 * Project one resolved config onto the `local` provider's limits. Called
 * per request through the provider's live getter, so limit-only edits apply
 * without rebuilding the transport.
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
