/**
 * `ctx.zotero`: the stable research-domain boundary of the plugin.
 *
 * The service owns provider selection (a configured id must be registered,
 * with no cross-provider fallback and no request replay), capability gating,
 * and the domain methods the model-facing tools consume. The HTTP
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
 * write capability) rebuild on `loader/volatile-update` on this same
 * instance, never as a service replacement. A violating commit is vetoed in
 * `internal/config` before it lands, so the live read only ever observes
 * values `resolveConfig` accepts.
 * @module dsh-zotero/service
 */

import {
  Service,
  type Context,
  type Fiber,
  type FiberState,
  type LoggerLevel,
} from '@deepseek-ai/cordis'
// Type-only: brings the loader `loader/volatile-update` Events merge into
// this program (the structural-flip reaction below).
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: brings the `ctx.typert` Context merge into this program.
import type {} from '@deepseek-ai/dsh-typert-registry'
// Type-only: brings the `ctx.credentials` Context merge into this program.
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
// Type-only: brings the `ctx.sessionProjections` Context merge into this program.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
import { DiagnosticsRecorder, logMessageToPush, loggerNameMatches } from './diagnostics.js'
import type { DiagnosticDetail } from './diagnostics.js'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ZoteroHttpClient } from './http-client.js'
import { registerStatusCommand } from './command.js'
import { ZoteroRuntime } from './remote.js'
import { parseRef } from './refs.js'
import type { ZoteroAttachmentLocationView } from './contract.js'
import { ZOTERO_STATUS_PROJECTION } from './status-projection.js'
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
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  errorMessageOf,
  ZoteroError,
} from './errors.js'
import { LocalApiProvider } from './local/provider.js'
import type { LocalApiLimits } from './local/limits.js'
import { registerPromptSection } from './prompt.js'
import { detectShellWrite, SHELL_TOOL_NAMES } from './shell-write-detector.js'
import { registerAttachmentTool } from './tools/attachment.js'
import { registerBrowseTool } from './tools/browse.js'
import { registerChangesTool } from './tools/changes.js'
import { registerChildrenTool } from './tools/children.js'
import { registerGetTool } from './tools/get.js'
import { registerExportTool } from './tools/export.js'
import { registerRetrieveTool } from './tools/retrieve.js'
import { registerSearchTool } from './tools/search.js'
import { registerCreateNoteTool } from './tools/create-note.js'
import { registerUpdateItemTagsTool } from './tools/update-item-tags.js'
import { registerUpdateItemCollectionsTool } from './tools/update-item-collections.js'
import { registerCreateCollectionTool } from './tools/create-collection.js'
import { registerDeleteCollectionTool } from './tools/delete-collection.js'
import { registerCreateItemTool } from './tools/create-item.js'
import { registerUpdateItemTool } from './tools/update-item.js'
import { registerDeleteLibraryTagsTool } from './tools/delete-library-tags.js'
import { registerBatchItemsTool } from './tools/batch-items.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroCreateCollectionCommittedOutcome,
  ZoteroCreateCollectionRequest,
  ZoteroCreateItemCommittedOutcome,
  ZoteroCreateItemRequest,
  ZoteroCreateNoteRequest,
  ZoteroCreateNoteCommittedOutcome,
  ZoteroDeleteCollectionRequest,
  ZoteroDeleteCollectionResult,
  ZoteroDeleteLibraryTagsRequest,
  ZoteroDeleteLibraryTagsResult,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroProgressEvent,
  ZoteroProvider,
  ZoteroProviderMethod,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroStatus,
  ZoteroUpdateItemCollectionsRequest,
  ZoteroUpdateItemCollectionsResult,
  ZoteroUpdateItemRequest,
  ZoteroUpdateItemResult,
  ZoteroUpdateItemTagsRequest,
  ZoteroUpdateItemTagsResult,
  ZoteroBatchItemsOutcome,
  ZoteroBatchItemsRequest,
  ZoteroWriteCall,
  ZoteroWriteDeclined,
} from './types.js'
import { askPlanApproval, requestWriteApproval } from './write-approval.js'

type ZoteroWriteMethod =
  | 'createNote'
  | 'updateItemTags'
  | 'updateItemCollections'
  | 'batchItems'
  | 'createCollection'
  | 'deleteCollection'
  | 'createItem'
  | 'updateItem'
  | 'deleteLibraryTags'

declare module '@deepseek-ai/cordis' {
  interface Context {
    zotero: ZoteroService
  }
}

/**
 * Runtime mirror of Cordis's `FiberState`.
 *
 * Cordis compiles `FiberState` as a `const enum`, so no runtime object exists to
 * import across packages. The values are anchored to the enum members instead
 * of spelled as bare numbers (`1 as FiberState.LOADING`), the same mirror
 * `packages/host/plugin-inventory/src/index.ts` keeps: a member that moves or
 * disappears then fails the typecheck rather than silently shifting the state
 * this plugin compares against.
 */
const FIBER_STATE = {
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
} as const

/** Runtime mirror of Cordis's `LoggerLevel`, anchored the same way as {@link FIBER_STATE}. */
const LOGGER_LEVEL = { DEBUG: 3 as LoggerLevel.DEBUG } as const

/**
 * One-line digest of a tool call for the debug ring: the wire name plus the
 * argument JSON, bounded so a pathological argument cannot dominate an
 * entry. Arguments can quote the user's library content; they reach the ring
 * only at `debug`, which the `debug` config flag gates.
 */
function toolCallDigest(execution: { name: string; arguments: unknown }): string {
  let digest = ''
  try {
    digest = JSON.stringify(execution.arguments) ?? ''
  } catch {
    digest = ''
  }
  const args = digest.length > 300 ? `${digest.slice(0, 299)}…` : digest
  return args === '' ? execution.name : `${execution.name} ${args}`
}

/**
 * Whether an `internal/config` waterfall `this` is this plugin's fiber.
 * The Loader passes the fiber itself; `ctx.plugin()` returns
 * `Object.create(fiber)`, so the prototype-linked face counts as the same
 * fiber. Anything else is another plugin's config resolution. Exported for
 * the unit lane: the false arms need a foreign `this` no in-lane waterfall
 * can carry.
 * @param thisArg - the waterfall's bound `this`.
 * @param own - the fiber that owns this service.
 * @returns true when the candidate config belongs to this plugin.
 */
export function isOwnConfigFiber(thisArg: unknown, own: Fiber): boolean {
  if (thisArg === own) return true
  return typeof thisArg === 'object' && thisArg !== null && Object.getPrototypeOf(thisArg) === own
}

export class ZoteroService extends Service {
  static inject = ['tools', 'systemPrompt']

  static Config = ConfigSchema

  private readonly providers = new Map<string, ZoteroProvider>()
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
  /** Disposers of the conditionally registered heavy tools (export, changes), tracked for the background flip. */
  private heavyToolDisposes: Array<() => void> = []
  private heavyToolsBackgroundState: boolean | undefined = undefined
  /** The resolved config the transport stack was last built from. */
  private lastBuilt: ResolvedConfig
  /** Cached resolved config; invalidated on any loader/volatile-update. */
  private cachedConfig?: ResolvedConfig
  /**
   * The plugin's own diagnostics record: ring, threshold, and the sink every
   * instrumented seam holds. Public so the remote endpoints (and the tools,
   * for degradation facts) can read it without a second service.
   */
  readonly diagnostics = new DiagnosticsRecorder()
  /** Last observed probe connectivity; `undefined` until the first probe, so the initial state always records. */
  private lastProbeConnected: boolean | undefined = undefined

  constructor(ctx: Context, config: Config | Options = {}) {
    super(ctx, 'zotero')
    // Diagnostics come first: the exporter is a process-wide tap disposed
    // with this fiber, filtering this subtree's logger names into the ring.
    // Both spellings match: the explicit `zotero.*` names the seams choose,
    // and the fiber-derived `zotero-service` spelling under which Cordis
    // reports this fiber's own lifecycle failures. `levels.default` at DEBUG
    // defeats the INFO-only fallback that silently drops warn/debug
    // harness-wide, so even a plain `ctx.logger.error` from anywhere in the
    // subtree is recorded.
    ctx.logger.exporter({
      colors: false,
      levels: { default: LOGGER_LEVEL.DEBUG },
      export: (message) => {
        if (!loggerNameMatches(message.name)) return
        this.diagnostics.push(logMessageToPush(message))
      },
    })
    // Fail the load loud on a violating entry; the same gate vetoes
    // violating settings commits in `internal/config` below. A load-time
    // rejection is deliberately not logged into the ring: the ring dies with
    // this fiber, so the record nobody can read would be pretend work, and
    // the veto path below is the rejection a reader can actually observe.
    const resolved = resolveConfig(config)
    this.diagnostics.setThreshold(resolved.debug ? 'debug' : 'info')
    this.entry = toLiveEntry(config)
    this.lastBuilt = this.config
    this.buildTransport(this.lastBuilt)
    // Veto a settings commit the schema alone cannot refuse (loopback-only
    // baseUrl, positive limits): throwing here refuses the commit before it
    // lands, so the live read only ever observes accepted values. The guard
    // scopes the veto to this plugin's fiber: the loader passes the fiber
    // itself as the waterfall `this`, while `ctx.plugin()` returns
    // `Object.create(fiber)`, a prototype-linked face of the same fiber.
    const recorder = this.diagnostics
    ctx.on('internal/config', function (this: Fiber | null, _raw, next) {
      const raw = next()
      if (!isOwnConfigFiber(this, ctx.fiber)) return raw
      try {
        resolveConfig(raw as Config | Options)
      } catch (error) {
        recorder.sink.error('config.rejected', errorMessageOf(error), { scope: 'settings-commit' })
        throw error
      }
      return raw
    })
    // Structural flips land without remounting: rebuild the transport stack
    // and reconcile the write tools on this same instance. Limit-only edits
    // need no reaction, because the provider's per-call limits getter reads them.
    // Loader emits
    // `loader/volatile-update` fiber-filtered (`owner.fiber === fiber`), so a
    // listener on this fiber's ctx receives own updates without `global`.
    // Failures are logged, never thrown into the dispatch.
    ctx.on('loader/volatile-update', (paths: readonly (readonly string[])[]) => {
      this.cachedConfig = undefined
      // The debug flag is volatile like every other field: sync the ring's
      // threshold on any commit so a settings flip applies to the next
      // emission without a rebuild.
      this.diagnostics.setThreshold(this.config.debug ? 'debug' : 'info')
      try {
        if (touchesHeavyTools(paths)) {
          this.reconcileHeavyTools()
        }
        if (touchesTransport(paths)) {
          const config = this.config
          if (!sameTransportConfig(config, this.lastBuilt)) {
            this.buildTransport(config)
            this.reconcileWriteTools(config.writeEnabled)
            this.lastBuilt = config
          }
        }
      } catch (error) {
        // Into the diagnostics ring, never thrown into the dispatch: a
        // failing rebuild leaves the previous transport serving.
        this.diagnostics.sink.error('config.apply.failed', errorMessageOf(error))
      }
    })
    registerStatusCommand(ctx, this)
    registerPromptSection(ctx, () => this.config)
    ctx.effect(
      () => () => {
        for (const dispose of this.heavyToolDisposes) dispose()
        this.heavyToolDisposes = []
      },
      'zotero: heavy tools teardown',
    )
    // A shell command aimed at Zotero's own write API is not blocked outright:
    // it is made to ask. The harness's own approval request decides it before
    // the body runs, so the write happens only when the user confirms that one
    // call, and not when they decline, cancel, run under the `never` policy,
    // or have no approval channel. Registered as a listener on this fiber, so
    // the plugin's disposal unwinds it. The name gate runs before any config
    // read so non-shell tools never pay the detector (or the live getter).
    ctx.on('tools/pre-execute', (execution, next) => {
      if (!SHELL_TOOL_NAMES.has(execution.name)) return next()
      const attempt = detectShellWrite(this.config, execution)
      if (attempt === undefined) return next()
      this.diagnostics.sink.warn('shell.intercepted', attempt.reason, { tool: execution.name })
      return Promise.resolve({
        kind: 'ask',
        reason: attempt.reason,
        displayReason: attempt.displayReason,
      })
    })
    // One observe-only wrapper covers every tool: the dispatch waterfall's
    // `next()` is the actual tool body, so wrapping it times the call and
    // records the outcome without touching a single tool file. A successful
    // call is debug-level (the conversation already shows it); a typed
    // failure result is a warn; an unexpected throw is an error.
    ctx.on('tools/execute', async (execution, next) => {
      if (!execution.name.startsWith('zotero_')) return await next()
      const startedAt = Date.now()
      // The digest JSON-stringifies the arguments; building it below the
      // debug threshold would be spent work, so the gate is read before
      // construction.
      if (this.diagnostics.admits('debug')) {
        this.diagnostics.sink.debug('tool.call', toolCallDigest(execution))
      }
      try {
        const result: ToolExecutionResult = await next()
        const ms = Date.now() - startedAt
        if (result.isError) {
          // The registry parks the stable error code at `error.info.code`
          // (a plain throw folds without one); recording it gives the panel
          // the same grep anchor the transport failure lines carry.
          const detail: DiagnosticDetail = { ms }
          const code = result.error.info?.code
          if (code !== undefined) detail.errorCode = code
          this.diagnostics.sink.warn(
            'tool.result',
            `${execution.name} failed: ${result.error.message}`,
            detail,
          )
        } else {
          this.diagnostics.sink.debug('tool.result', `${execution.name} completed`, { ms })
        }
        return result
      } catch (error) {
        this.diagnostics.sink.error(
          'tool.result',
          `${execution.name} threw: ${errorMessageOf(error)}`,
          {
            ms: Date.now() - startedAt,
          },
        )
        throw error
      }
    })
    registerSearchTool(ctx, this)
    registerGetTool(ctx, this)
    registerChildrenTool(ctx, this)
    registerAttachmentTool(ctx, this)
    registerRetrieveTool(ctx, this)
    registerBrowseTool(ctx, this)
    this.reconcileHeavyTools()
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        this.reconcileHeavyTools()
        return () => this.reconcileHeavyTools()
      })
    })
    // The status channel: the Remote service binds the wire namespace, and
    // the strict manifest claims its endpoints. See typert.ts for why the
    // manifest self-registers through ctx.inject(['typert']).
    new ZoteroRuntime(ctx)
    ctx.inject(['typert'], (host) => {
      // register() is itself a fiber-scoped effect: the manifest unwinds with
      // this inject fiber on unload, and no wrapper effect is needed.
      host.typert.register(TYPERT_MANIFEST)
    })
    // The durable half of `/zotero`: the command handler appends a
    // `zotero/status` event and the card reads it back through this
    // projection instead of re-parsing the text it was handed. Optional seam:
    // a composition without the registry keeps the live probe as the only
    // source, and the card says nothing it cannot prove.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.effect(() =>
        projectionCtx.sessionProjections.register(ZOTERO_STATUS_PROJECTION),
      )
    })
    // A plugin that ships its own settings page owns that page's presentation;
    // the automatic schema-generated one would be a second, conflicting
    // surface for the same namespace (`packages/settings/settings/README.md`).
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
    this.reconcileWriteTools(this.config.writeEnabled)
  }

  /**
   * The currently effective configuration, read live from the entry's
   * volatile references on every access, so tools that call this per request
   * see settings edits without a restart. Commits only land after passing
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
      maxInFlight: config.maxInFlightRequests,
      sink: this.diagnostics.sink,
    })
    const writeEnabled = config.writeEnabled
    const writer = writeEnabled
      ? new ZoteroWriteHttpClient({
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
          maxResponseBytes: config.maxResponseBytes,
          authorizeDeadlineMs: config.writeAuthorizeDeadlineMs,
          sink: this.diagnostics.sink,
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
      new LocalApiProvider(
        client,
        () => localProviderLimits(this.config),
        writer,
        authorizer,
        this.diagnostics.sink,
      ),
    )
    this.diagnostics.sink.info('transport.built', 'Zotero transport stack built', { writeEnabled })
  }

  /**
   * Register or re-register the heavy tools (export, changes) dynamically as
   * `enableRunInBackground` or `ctx.jobs` flips. Exposes the `run_in_background`
   * parameter to the model only when background execution is actually usable.
   */
  private reconcileHeavyTools(): void {
    // Cordis Fiber lifecycle: LOADING = 1, ACTIVE = 2. When unloading (5) or
    // disposed (4), do not re-register tools onto the dying context.
    if (
      this.ctx.fiber.state !== FIBER_STATE.ACTIVE &&
      this.ctx.fiber.state !== FIBER_STATE.LOADING
    ) {
      for (const dispose of this.heavyToolDisposes) dispose()
      this.heavyToolDisposes = []
      this.heavyToolsBackgroundState = undefined
      return
    }
    const shouldEnable = this.config.enableRunInBackground && this.ctx.get('jobs') !== undefined
    if (this.heavyToolsBackgroundState === shouldEnable) {
      return
    }
    for (const dispose of this.heavyToolDisposes) dispose()
    this.heavyToolDisposes = [
      registerExportTool(this.ctx, this, shouldEnable),
      registerChangesTool(this.ctx, this, shouldEnable),
    ]
    this.heavyToolsBackgroundState = shouldEnable
  }

  /**
   * Register or retire the write tools as `writeEnabled` flips. When the
   * flag is off the tools are absent from the model's surface entirely. A
   * tool that can only ever answer "write capability is disabled" would
   * invite the model to retry it. Runs once at construction and again on
   * every structural volatile-update.
   */
  private reconcileWriteTools(enabled: boolean): void {
    if (enabled && this.writeToolDisposes.length === 0) {
      this.writeToolDisposes = [
        registerCreateNoteTool(this.ctx, this),
        registerUpdateItemTagsTool(this.ctx, this),
        registerUpdateItemCollectionsTool(this.ctx, this),
        registerBatchItemsTool(this.ctx, this),
        registerCreateCollectionTool(this.ctx, this),
        registerDeleteCollectionTool(this.ctx, this),
        registerCreateItemTool(this.ctx, this),
        registerUpdateItemTool(this.ctx, this),
        registerDeleteLibraryTagsTool(this.ctx, this),
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
    return this.ctx.effect(() => {
      providers.set(provider.id, provider)
      return () => {
        providers.delete(provider.id)
      }
    }, 'zotero.registerProvider()')
  }

  /**
   * Connectivity probe: the only health check. Ordinary calls fail with typed errors instead.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns live connectivity facts for the configured provider.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    const status = await this.resolveProvider().status(signal)
    // Record flips only: a flapping connection shows as a short list of
    // transitions instead of one entry per probe, and the first probe always
    // records because `lastProbeConnected` starts unset.
    if (status.connected !== this.lastProbeConnected) {
      this.diagnostics.sink.info(
        'probe.changed',
        status.connected
          ? 'Zotero connected'
          : `Zotero unreachable: ${status.diagnosis ?? 'unknown reason'}`,
        { connected: status.connected },
      )
      this.lastProbeConnected = status.connected
    }
    return status
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
   * Resolve an attachment ref string for the Typert Remote caller.
   * @param ref - the item or attachment ref string to resolve.
   * @param signal - caller cancellation; forwarded to the provider.
   * @returns the resolved location view with local file path or web URL.
   */
  async resolveAttachment(
    ref: string,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocationView> {
    const parsedRef = parseRef(ref)
    const loc = await this.attachment(parsedRef, signal)
    return {
      ref: loc.ref,
      kind: loc.kind,
      title: loc.title,
      contentType: loc.contentType,
      ...(loc.kind === 'file' ? { path: loc.path } : { url: loc.url }),
    }
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
   * @param onProgress - optional progress reporter.
   * @returns per-ref citations or the joined export text.
   */
  async export(
    request: ZoteroExportRequest,
    signal?: AbortSignal,
    onProgress?: (progress: ZoteroProgressEvent) => void,
  ): Promise<ZoteroExportResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'citation')
    const doExport = this.requireMethod(provider, 'export')
    return await doExport(request, signal, onProgress)
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
   * @param onProgress - optional progress reporter.
   * @returns changed/deleted keys plus the library's current version.
   */
  async changes(
    request: ZoteroChangesRequest,
    signal?: AbortSignal,
    onProgress?: (progress: ZoteroProgressEvent) => void,
  ): Promise<ZoteroChangesResult> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'changes')
    const changes = this.requireMethod(provider, 'changes')
    return await changes(request, signal, onProgress)
  }

  /**
   * Shared dispatch for personal library write operations: capability check,
   * provider method presence assertion, user approval gate, and execution.
   */
  private async dispatchWrite<M extends ZoteroWriteMethod>(
    call: ZoteroWriteCall,
    methodName: M,
    request: Parameters<NonNullable<ZoteroProvider[M]>>[0],
  ): Promise<Awaited<ReturnType<NonNullable<ZoteroProvider[M]>>> | ZoteroWriteDeclined> {
    const provider = this.resolveProvider()
    this.requireCapability(provider, 'write')
    // Method presence before the plan card: a provider that cannot serve the
    // write must not spend the user's approval on a call that cannot run.
    const method = this.requireMethod(provider, methodName)
    if (!(await this.approveWrite(call))) return { kind: 'declined' }
    const invoke = method as (
      req: Parameters<NonNullable<ZoteroProvider[M]>>[0],
      signal?: AbortSignal,
    ) => Promise<Awaited<ReturnType<NonNullable<ZoteroProvider[M]>>>>
    return await invoke(request, call.exec.signal)
  }

  /**
   * Create a note item, either standalone or attached to an existing item.
   *
   * Write boundary: personal library only (`zotero://user/0/...`); capability
   * answers before any network; the plan-review the user approves happens
   * here, at the seam, so no caller can skip it.
   * @param request - the markdown body, optional parent, collections, tags, and sources.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the created note's ref, version, and the saved collections/tags/relations,
   *   or `declined` when the user did not approve the plan.
   */
  async createNote(
    request: ZoteroCreateNoteRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroCreateNoteCommittedOutcome | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'createNote', request)
  }

  /**
   * Update one item's tags (add/remove in one write).
   * @param request - the item ref and the tags to add/remove.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the merged tag list, the actual additions/removals, and versions,
   *   or `declined` when the user did not approve the plan.
   */
  async updateItemTags(
    request: ZoteroUpdateItemTagsRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroUpdateItemTagsResult | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'updateItemTags', request)
  }

  /**
   * Update one item's collection membership (add/remove in one write).
   * @param request - the item ref and the collections to add/remove.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the resulting collections, the actual additions/removals, and versions,
   *   or `declined` when the user did not approve the plan.
   */
  async updateItemCollections(
    request: ZoteroUpdateItemCollectionsRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroUpdateItemCollectionsResult | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'updateItemCollections', request)
  }

  /**
   * Create a collection, optionally under a parent.
   * @param request - the name and the optional parent ref or name.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the created collection, or `declined` when not approved.
   */
  async createCollection(
    request: ZoteroCreateCollectionRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroCreateCollectionCommittedOutcome | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'createCollection', request)
  }

  /**
   * Delete a collection by ref or name.
   * @param request - the collection ref or name.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the deletion receipt, or `declined` when not approved.
   */
  async deleteCollection(
    request: ZoteroDeleteCollectionRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroDeleteCollectionResult | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'deleteCollection', request)
  }

  /**
   * Create a bibliographic item from the closed field set.
   * @param request - the itemType plus title/url/date/doi/abstract/publicationTitle/creators.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the created item, or `declined` when not approved.
   */
  async createItem(
    request: ZoteroCreateItemRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroCreateItemCommittedOutcome | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'createItem', request)
  }

  /**
   * Update one item's scalar metadata fields.
   * @param request - the item ref and the closed-set field updates.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the changed fields and versions, or `declined` when not approved.
   */
  async updateItem(
    request: ZoteroUpdateItemRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroUpdateItemResult | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'updateItem', request)
  }

  /**
   * Delete tags library-wide. Irreversible.
   * @param request - the tag names to delete.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the deletion receipt, or `declined` when not approved.
   */
  async deleteLibraryTags(
    request: ZoteroDeleteLibraryTagsRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroDeleteLibraryTagsResult | ZoteroWriteDeclined> {
    return await this.dispatchWrite(call, 'deleteLibraryTags', request)
  }

  /**
   * Batch items operation: create/import, update tags/collections, delete.
   * @param request - the batch operations.
   * @param call - the asking write call: its plan and its tool run.
   * @returns the outcome describing created, updated, and deleted items, or declined.
   */
  async batchItems(
    request: ZoteroBatchItemsRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroBatchItemsOutcome> {
    return await this.dispatchWrite(call, 'batchItems', request)
  }

  /**
   * The confirmation gates every write passes through, in order: the session
   * approval policy (`ctx.approval`, where `never` auto-rejects and the
   * request is audited), then the plan-review card. There is no opt-out and no
   * config field behind either: a write that cannot clear the policy or show
   * the user its plan does not happen. Both asks fail closed, and a missing
   * channel refuses the write rather than letting it through unapproved.
   * @param call - the asking write call.
   * @returns true when the write may proceed.
   */
  private async approveWrite(call: ZoteroWriteCall): Promise<boolean> {
    const policy = await requestWriteApproval(this.ctx, call)
    this.diagnostics.sink.info('write.gate', `write policy decision: ${policy}`, {
      tool: call.exec.name,
    })
    if (policy === 'declined') return false
    if (policy === 'unavailable') {
      this.diagnostics.sink.error('write.gate', 'approval channel unavailable; write refused', {
        tool: call.exec.name,
      })
      throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
    }
    const approved = await askPlanApproval(this.ctx, call)
    this.diagnostics.sink.info(
      'write.gate',
      approved ? 'plan review approved' : 'plan review declined',
      { tool: call.exec.name },
    )
    return approved
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
      this.diagnostics.sink.warn(
        'capability.denied',
        `Zotero provider "${provider.id}" does not support the ${capability} capability.`,
        { capability, provider: provider.id },
      )
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
 * client identity and bounds (`baseUrl`, `timeoutMs`, `maxResponseBytes`,
 * `maxInFlightRequests`, the last of which sizes the client-wide concurrency
 * gate), the write client's human-scale dialog budget
 * (`writeAuthorizeDeadlineMs`), and the write-capability flip (writer,
 * authorizer, and tool set). `provider` and `writePersistKey` are live reads
 * (`resolveProvider()` and the authorizer's `persistKey` callback) and never
 * rebuild; every remaining bound, the scope-listing TTL included, is read
 * through the provider's live limits getter on the next call.
 */
export const TRANSPORT_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig> = new Set([
  'baseUrl',
  'timeoutMs',
  'maxResponseBytes',
  'maxInFlightRequests',
  'writeAuthorizeDeadlineMs',
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

export const HEAVY_TOOL_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig> = new Set([
  'enableRunInBackground',
])

/**
 * Whether a `loader/volatile-update` path list touches the heavy tools' background capability.
 * A root path (`[]`) means the whole config moved as one reference.
 * @param paths - the changed field paths the loader reported.
 * @returns true when heavy tools may need re-registration.
 */
export function touchesHeavyTools(paths: readonly (readonly string[])[]): boolean {
  return paths.some(
    (path) =>
      path.length === 0 ||
      (path[0] !== undefined && HEAVY_TOOL_CONFIG_KEYS.has(path[0] as keyof ResolvedConfig)),
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
    maxAttachmentRecords: config.maxAttachmentRecords,
    fulltextChunkWords: config.fulltextChunkWords,
    maxEvidenceChars: config.maxEvidenceChars,
    maxEvidencePassages: config.maxEvidencePassages,
    maxFulltextChars: config.maxFulltextChars,
    maxExportChars: config.maxExportChars,
    maxBrowseResults: config.maxBrowseResults,
    maxChangesResults: config.maxChangesResults,
    scopeListingTtlMs: config.scopeListingTtlMs,
    searchConcurrency: config.searchConcurrency,
    graphConcurrency: config.graphConcurrency,
    retrieveAttachmentCap: config.retrieveAttachmentCap,
    defaultStyle: config.defaultStyle,
    defaultLocale: config.defaultLocale,
  }
}

export default ZoteroService
