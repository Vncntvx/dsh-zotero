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
 * the tools invoked because the user asked about their library, and client
 * panels and probes.
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
import { ZOTERO_SOURCE_PROJECTION_FAILED } from './contract.js';
import { Service } from '@deepseek-ai/cordis';
import { FIBER_STATE } from './fiber-state.js';
import { DiagnosticsRecorder, logMessageToPush, loggerNameMatches } from './diagnostics.js';
import { ZoteroHttpClient } from './http-client.js';
import { ZoteroRuntime } from './remote.js';
import { parseRef } from './refs.js';
import { TYPERT_MANIFEST } from './typert.js';
import { WriteAuthorizer } from './write-auth.js';
import { sourceLedgerProjection } from './session-projection/source-ledger.js';
import { ZoteroWriteHttpClient } from './write-http.js';
import { Config as ConfigSchema, readResolvedConfig, resolveConfig, toLiveEntry, } from './config.js';
import { WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_NOT_COMPOSED_MESSAGE, ZOTERO_PROVIDER_UNAVAILABLE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE, ZoteroError, errorMessageOf, } from './errors.js';
import { ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS, ZOTERO_TOOL_NAMES } from './constants.js';
import { ConcurrencyGate } from './concurrency.js';
import { LocalApiProvider } from './local/provider.js';
import { installParameterCorrection } from './parameter-correction.js';
import { localProviderLimits } from './service-config.js';
import { installServiceConfigLifecycle } from './service-lifecycle.js';
import { registerPromptSection } from './prompt.js';
import { installShellWriteApproval } from './shell-write-approval.js';
import { registerReadTools, registerWriteTools } from './tool-registration.js';
import { ResultDelivery } from './result-delivery.js';
import { registerResultRoute } from './result-route.js';
import { ZoteroJobRunner } from './job-runner.js';
import { installToolDiagnostics } from './tool-diagnostics.js';
import { createSubagentGuard } from './subagent-guard.js';
import { CORE_SOPS } from './skills/core.js';
import { registerResearchSkills } from './skills/register.js';
import { askPlanApproval, requestWriteApproval } from './write-approval.js';
/** Runtime mirror of Cordis's `LoggerLevel`, anchored the same way as `fiber-state.ts`. */
const LOGGER_LEVEL = { DEBUG: 3 };
/** The fiber-ownership check lives in `service-lifecycle.ts`; it is re-exported for the unit lane. */
export { isOwnConfigFiber } from './service-lifecycle.js';
/**
 * The composed Zotero service every strict endpoint reads. Abort is checked
 * first, so a cancelled caller observes its own cancellation; a missing
 * service fails with the one stable provider-unavailable code both Remote
 * services (and the panel's write pipeline) answer with.
 * @param ctx - the endpoint's own context.
 * @param signal - caller cancellation, when the caller carries one.
 */
export function requireZoteroService(ctx, signal) {
    signal?.throwIfAborted();
    const service = ctx.get('zotero');
    if (service === undefined) {
        throw new ZoteroError(ZOTERO_NOT_COMPOSED_MESSAGE, ZOTERO_PROVIDER_UNAVAILABLE);
    }
    return service;
}
export class ZoteroService extends Service {
    sourceProjectionState = { state: 'not-composed' };
    sourceProjectionFiber;
    sourceProjectionReady;
    sourceProjectionHandle;
    sourceProjectionGeneration = 0;
    static inject = ['tools', 'systemPrompt'];
    static Config = ConfigSchema;
    providers = new Map();
    /**
     * The live entry config: Loader-delivered volatile references (commits
     * write those same refs) or a complete plain snapshot. Tools read through
     * {@link config} per request so settings edits apply without a restart.
     */
    entry;
    /**
     * The write path's in-flight gate, created once for this service instance.
     * Serialization is a process-wide invariant of the read-modify-write cycles
     * the write domain performs, so the gate outlives every transport rebuild:
     * a rebuilt write client and a write already in flight cannot run side by
     * side.
     */
    writeGate = new ConcurrencyGate(ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS);
    /** Core-owned durable result delivery shared by every heavy read tool. */
    resultDelivery;
    /** Core-owned runner; its registry source follows late jobs composition. */
    jobRunner;
    /** Disposer of the currently registered `local` provider, released after a rebuild's new registration lands. */
    providerDispose;
    /** Disposers of the conditionally registered write tools, tracked for the writeEnabled flip. */
    writeToolDisposes = [];
    /** The live write authorizer; absent while writes are disabled. */
    authorizer;
    /** Child-scope restrictions that follow the live write-tool registration set. */
    subagentGuard;
    /** Cached resolved config; invalidated on any loader/volatile-update. */
    cachedConfig;
    /**
     * The plugin's own diagnostics record: ring, threshold, and the sink every
     * instrumented seam holds. Public so the remote endpoints (and the tools,
     * for degradation facts) can read it without a second service.
     */
    diagnostics = new DiagnosticsRecorder();
    /** Last observed probe connectivity; `undefined` until the first probe, so the initial state always records. */
    lastProbeConnected = undefined;
    constructor(ctx, config = {}) {
        super(ctx, 'zotero');
        this.subagentGuard = createSubagentGuard(ctx, this.diagnostics);
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
                if (!loggerNameMatches(message.name))
                    return;
                this.diagnostics.push(logMessageToPush(message));
            },
        });
        // Fail the load loud on a violating entry; the same gate vetoes
        // violating settings commits in `internal/config` below. A load-time
        // rejection is deliberately not logged into the ring: the ring dies with
        // this fiber, so the record nobody can read would be pretend work, and
        // the veto path below is the rejection a reader can actually observe.
        const resolved = resolveConfig(config);
        this.diagnostics.setThreshold(resolved.debug ? 'debug' : 'info');
        this.entry = toLiveEntry(config);
        this.resultDelivery = new ResultDelivery(ctx, () => this.config);
        this.jobRunner = new ZoteroJobRunner(() => ctx.get('jobs'), this.diagnostics.sink, this.resultDelivery);
        const initialConfig = this.config;
        this.buildTransport(initialConfig);
        installServiceConfigLifecycle(ctx, {
            diagnostics: this.diagnostics,
            initialConfig,
            configOf: () => this.config,
            invalidateConfig: () => {
                this.cachedConfig = undefined;
            },
            applyTransportConfig: (config) => {
                this.buildTransport(config);
                this.reconcileWriteTools(config.writeEnabled);
            },
        });
        registerPromptSection(ctx, () => this.config);
        ctx.effect(() => () => {
            this.subagentGuard.dispose();
            for (const dispose of this.writeToolDisposes)
                dispose();
            this.writeToolDisposes = [];
        }, 'zotero: dynamic tools and subagent guard teardown');
        installShellWriteApproval(ctx, () => this.config, this.diagnostics);
        installToolDiagnostics(ctx, this.diagnostics);
        installParameterCorrection(ctx, ZOTERO_TOOL_NAMES);
        // Background-capable tools keep their parameters static; execution refuses
        // requests the current composition cannot serve.
        registerReadTools(ctx, this, this.resultDelivery);
        registerResultRoute(ctx, this.resultDelivery);
        ctx.effect(() => () => {
            this.jobRunner.killAll('zotero service disposed');
        }, 'zotero: job teardown');
        // The literature trail is served as a session projection when the harness
        // composes the registry: the fold sees the whole log, not the bounded
        // history window the browser chat store receives. Optional assembly: a
        // headless composition without the registry reports not-composed.
        this.sourceProjectionFiber = ctx.inject(['sessionProjections'], (host) => {
            const generation = ++this.sourceProjectionGeneration;
            this.sourceProjectionState = { state: 'pending' };
            host.effect(() => () => {
                if (this.sourceProjectionGeneration !== generation)
                    return;
                if (this.sourceProjectionState.state !== 'failed') {
                    this.sourceProjectionState = { state: 'not-composed' };
                }
            }, 'zotero: source projection registration state');
            this.sourceProjectionReady = (async () => {
                try {
                    const handle = await host.sessionProjections.register(sourceLedgerProjection);
                    if (this.sourceProjectionGeneration !== generation) {
                        await handle.dispose();
                        return;
                    }
                    this.sourceProjectionHandle = handle;
                    this.sourceProjectionState = { state: 'ready' };
                }
                catch (error) {
                    if (this.sourceProjectionGeneration === generation) {
                        this.sourceProjectionState = {
                            state: 'failed',
                            code: ZOTERO_SOURCE_PROJECTION_FAILED,
                        };
                    }
                    this.diagnostics.sink.error('projection.register', errorMessageOf(error));
                }
            })();
            void this.sourceProjectionReady;
        });
        ctx.effect(() => () => {
            this.sourceProjectionGeneration++;
            const fiber = this.sourceProjectionFiber;
            const handle = this.sourceProjectionHandle;
            this.sourceProjectionFiber = undefined;
            this.sourceProjectionReady = undefined;
            this.sourceProjectionHandle = undefined;
            const fiberDisposal = fiber?.dispose();
            if (fiberDisposal !== undefined) {
                void Promise.resolve(fiberDisposal).catch((error) => {
                    this.diagnostics.sink.error('projection.dispose', errorMessageOf(error));
                });
            }
            return handle?.dispose();
        }, 'zotero: source projection teardown');
        registerResearchSkills(ctx, CORE_SOPS);
        // The status channel: the Remote service binds the wire namespace, and
        // the strict manifest claims its endpoints. See typert.ts for why the
        // manifest self-registers through ctx.inject(['typert']).
        new ZoteroRuntime(ctx);
        ctx.inject(['typert'], (host) => {
            // register() is itself a fiber-scoped effect: the manifest unwinds with
            // this inject fiber on unload, and no wrapper effect is needed.
            host.typert.register(TYPERT_MANIFEST);
        });
        // A plugin that ships its own settings page owns that page's presentation;
        // the automatic schema-generated one would be a second, conflicting
        // surface for the same namespace (`packages/settings/settings/README.md`).
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        });
        this.reconcileWriteTools(this.config.writeEnabled);
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
    get config() {
        if (this.cachedConfig === undefined) {
            this.cachedConfig = readResolvedConfig(this.entry);
        }
        return this.cachedConfig;
    }
    /**
     * Revoke this plugin's persisted Zotero write grant and forget the process's
     * copy. Local credential surgery only: no Zotero request and no approval.
     * @returns whether a stored grant was removed.
     * @throws {ZoteroError} `ZOTERO_CAPABILITY_UNAVAILABLE` while writes are disabled.
     */
    async revokeWriteGrant() {
        if (this.authorizer === undefined)
            throw new ZoteroError('Zotero writes are disabled.', ZOTERO_CAPABILITY_UNAVAILABLE);
        return await this.authorizer.revoke();
    }
    /**
     * The live write capability, read through {@link config} on every call.
     * Cross-component admission checks (the scholarly save tool) use it so a
     * disabled write surface never appears in a model step's tool set.
     * @returns whether writes are enabled in the current configuration.
     */
    writeEnabled() {
        return this.config.writeEnabled;
    }
    /**
     * Wait until the registration attempt behind a composed registry settles,
     * then report its state. The registration callback never rethrows (it logs
     * and latches `failed`), so the awaited fiber always settles normally.
     */
    async sourceProjectionStatus(signal) {
        signal.throwIfAborted();
        if (this.ctx.get('sessionProjections') === undefined)
            return { state: 'not-composed' };
        const fiber = this.sourceProjectionFiber;
        // Defensive: the fiber is assigned synchronously during composition, so
        // no status call on a composed registry can observe it unset in practice.
        if (fiber === undefined)
            return { state: 'pending' };
        await this.awaitRegistrationOrAbort(fiber.await(), signal);
        const ready = this.sourceProjectionReady;
        if (ready !== undefined)
            await this.awaitRegistrationOrAbort(ready, signal);
        signal.throwIfAborted();
        // Between composition and the callback's first tick the state is still
        // the constructed `not-composed`; that reads as pending, not as absence.
        if (this.sourceProjectionState.state === 'not-composed')
            return { state: 'pending' };
        return this.sourceProjectionState;
    }
    /** Wait for the registration fiber, converting an aborted signal into a rejection. */
    async awaitRegistrationOrAbort(registration, signal) {
        let rejectAbort;
        const aborted = new Promise((_, reject) => {
            rejectAbort = () => reject(signal.reason ?? new Error('Aborted'));
            if (signal.aborted)
                rejectAbort();
            else
                signal.addEventListener('abort', rejectAbort, { once: true });
        });
        try {
            await Promise.race([registration, aborted]);
        }
        finally {
            if (rejectAbort !== undefined)
                signal.removeEventListener('abort', rejectAbort);
        }
    }
    /**
     * Build the transport stack from the given config: HTTP client, write
     * client, write authorizer, and the `local` provider registration. The new
     * stack is fully constructed before the previous registration is released,
     * so a construction failure leaves the old stack serving; between the new
     * registration and the old release the seam answers with the new provider,
     * never with none. A request already in flight finishes on the client it
     * started with; later calls resolve the fresh provider.
     *
     * The write transport and authorizer exist only while `writeEnabled` is
     * set: without them the provider declares no `write` capability, so the
     * gate answers before any network happens. The write gate itself is not
     * rebuilt — serialization is a process-wide invariant, so every rebuild
     * shares this service's one slot.
     */
    buildTransport(config) {
        const client = new ZoteroHttpClient({
            baseUrl: config.baseUrl,
            timeoutMs: config.timeoutMs,
            maxResponseBytes: config.maxResponseBytes,
            maxInFlight: config.maxInFlightRequests,
            sink: this.diagnostics.sink,
        });
        const writeEnabled = config.writeEnabled;
        const writer = writeEnabled
            ? new ZoteroWriteHttpClient({
                baseUrl: config.baseUrl,
                timeoutMs: config.timeoutMs,
                maxResponseBytes: config.maxResponseBytes,
                authorizeDeadlineMs: config.writeAuthorizeDeadlineMs,
                gate: this.writeGate,
                sink: this.diagnostics.sink,
            })
            : undefined;
        const authorizer = writer === undefined
            ? undefined
            : new WriteAuthorizer({
                client: writer,
                credentials: () => this.credentials(),
                persistKey: () => this.config.writePersistKey,
            });
        const authorizerInstance = authorizer;
        const provider = new LocalApiProvider(client, () => localProviderLimits(this.config), writer, authorizer, this.diagnostics.sink);
        // The swap is synchronous: the new provider is in the seam before the
        // old registration is released, so a caller between the two steps — and
        // a construction failure before either — never sees zero providers. The
        // disposer is identity-checked, because the id is stable across swaps.
        this.providers.set(provider.id, provider);
        const previousDispose = this.providerDispose;
        this.providerDispose = this.ctx.effect(() => () => {
            if (this.providers.get(provider.id) === provider) {
                this.providers.delete(provider.id);
            }
        }, 'zotero.transportRegistration()');
        previousDispose?.();
        this.authorizer = authorizerInstance;
        this.diagnostics.sink.info('transport.built', 'Zotero transport stack built', { writeEnabled });
    }
    /**
     * Register or retire the write tools as `writeEnabled` flips. When the
     * flag is off the tools are absent from the model's surface entirely. A
     * tool that can only ever answer "write capability is disabled" would
     * invite the model to retry it. Runs once at construction and again on
     * every structural volatile-update.
     */
    reconcileWriteTools(enabled) {
        if (this.ctx.fiber.state !== FIBER_STATE.ACTIVE &&
            this.ctx.fiber.state !== FIBER_STATE.LOADING) {
            for (const dispose of this.writeToolDisposes)
                dispose();
            this.writeToolDisposes = [];
            this.subagentGuard.refresh(this.writeToolDisposes.length > 0);
            return;
        }
        if (enabled && this.writeToolDisposes.length === 0) {
            this.writeToolDisposes = registerWriteTools(this.ctx, this);
        }
        else if (!enabled && this.writeToolDisposes.length > 0) {
            for (const dispose of this.writeToolDisposes)
                dispose();
            this.writeToolDisposes = [];
        }
        this.subagentGuard.refresh(this.writeToolDisposes.length > 0);
    }
    /**
     * The host credentials seam, resolved lazily: a composition without a
     * credentials service keeps write grants in memory only, and the plugin
     * never hard-depends on the seam being mounted.
     */
    credentials() {
        return this.ctx.get('credentials');
    }
    /**
     * Register a provider into the seam. Effect-scoped: unloading the
     * registering fiber removes the provider.
     * @throws {ZoteroError} `ZOTERO_PROVIDER_UNAVAILABLE` on a duplicate id.
     * @returns the registration disposer.
     */
    registerProvider(provider) {
        if (this.providers.has(provider.id)) {
            throw new ZoteroError(`A Zotero provider with id "${provider.id}" is already registered.`, ZOTERO_PROVIDER_UNAVAILABLE);
        }
        const providers = this.providers;
        return this.ctx.effect(() => {
            providers.set(provider.id, provider);
            return () => {
                // Only remove the registration this effect installed: a transport
                // rebuild swaps a newer provider under the same id, and this older
                // disposer must not delete it.
                if (providers.get(provider.id) === provider) {
                    providers.delete(provider.id);
                }
            };
        }, 'zotero.registerProvider()');
    }
    /**
     * Connectivity probe: the only health check. Ordinary calls fail with typed errors instead.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns live connectivity facts for the configured provider.
     */
    async status(signal) {
        const status = await this.resolveProvider().status(signal);
        // Record flips only: a flapping connection shows as a short list of
        // transitions instead of one entry per probe, and the first probe always
        // records because `lastProbeConnected` starts unset.
        if (status.connected !== this.lastProbeConnected) {
            this.diagnostics.sink.info('probe.changed', status.connected
                ? 'Zotero connected'
                : `Zotero unreachable: ${status.diagnosis ?? 'unknown reason'}`, { connected: status.connected });
            this.lastProbeConnected = status.connected;
        }
        return status;
    }
    /**
     * Discover candidates; the provider resolves scopes and serves the compact records.
     * @param request - the search request with scope, mode, filters, and pagination.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param options - the caller's search policy (supplement, cache generation).
     * @returns the resolved scope plus the compact hit records and pagination facts.
     */
    async search(request, signal, options) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'search');
        const search = this.requireMethod(provider, 'search');
        return await search(request, signal, options);
    }
    /**
     * Read one item's metadata plus optionally requested child content.
     * @param request - the item ref and the child kinds to include.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the normalized item detail.
     */
    async get(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'metadata');
        const getItem = this.requireMethod(provider, 'getItem');
        return await getItem(request, signal);
    }
    /** Read multiple item refs with bounded concurrency and per-ref outcomes. */
    async getBatch(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'metadata');
        const getBatch = this.requireMethod(provider, 'getBatch');
        return await getBatch(request, signal);
    }
    /** Match external reference fingerprints against local Zotero metadata. */
    async matchReferences(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'metadata');
        const match = this.requireMethod(provider, 'matchReferences');
        return await match(request, signal);
    }
    /**
     * Read one page of a single child kind without re-reading the parent.
     * @param request - the item/attachment ref, kind, and page window.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the normalized child page.
     */
    async childPage(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'metadata');
        const childPage = this.requireMethod(provider, 'getChildPage');
        return await childPage(request, signal);
    }
    /**
     * Resolve an attachment ref to its on-disk file or linked URL.
     * @param ref - the item or attachment ref to resolve.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the verified file path or linked URL.
     */
    async attachment(ref, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'attachments');
        const getAttachmentLocation = this.requireMethod(provider, 'getAttachmentLocation');
        return await getAttachmentLocation(ref, signal);
    }
    /**
     * Resolve an attachment ref string for the Typert Remote caller.
     * @param ref - the item or attachment ref string to resolve.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the resolved location view with local file path or web URL.
     */
    async resolveAttachment(ref, signal) {
        const parsedRef = parseRef(ref);
        const loc = await this.attachment(parsedRef, signal);
        return {
            ref: loc.ref,
            kind: loc.kind,
            title: loc.title,
            contentType: loc.contentType,
            ...(loc.kind === 'file' ? { path: loc.path } : { url: loc.url }),
        };
    }
    /**
     * Gather ranked evidence passages for one item across the requested sources.
     * @param request - the item ref, ranking query, sources, and passage cap.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the bounded ranked evidence with a truncation flag.
     */
    async retrieve(request, signal) {
        const provider = this.resolveProvider();
        // Retrieve and changes consume full-text sources internally; the public
        // domain gate is the capability for the requested operation, not a raw-text method.
        this.requireCapability(provider, 'retrieve');
        const retrieve = this.requireMethod(provider, 'retrieve');
        return await retrieve(request, signal);
    }
    /**
     * Export citations, a bibliography, or translator formats for the requested items.
     * @param request - the item refs and the export format plus optional style/locale.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param onProgress - optional progress reporter.
     * @returns per-ref citations or the joined export text.
     */
    async export(request, signal, onProgress) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'citation');
        const doExport = this.requireMethod(provider, 'export');
        return await doExport(request, signal, onProgress);
    }
    /**
     * Export rendered text/citations for the requested items, without the
     * tool-side per-document itemization. This is the text arm the library
     * panel's export endpoint serves; the tool keeps {@link export}.
     * @param request - the item refs and the export format plus optional style/locale.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param onProgress - optional progress reporter.
     * @returns per-ref citations or the rendered export text.
     */
    async exportText(request, signal, onProgress) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'citation');
        const doExport = this.requireMethod(provider, 'exportText');
        return await doExport(request, signal, onProgress);
    }
    async collectionPath(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'browse');
        return this.requireMethod(provider, 'collectionPath')(request, signal);
    }
    async browse(request, signal) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'browse');
        const browse = this.requireMethod(provider, 'browse');
        return await browse(request, signal);
    }
    /**
     * Diff the library against a local transaction version.
     * @param request - the baseline version and the resource kinds to diff.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param onProgress - optional progress reporter.
     * @returns changed/deleted keys plus the library's current version.
     */
    async changes(request, signal, onProgress) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'changes');
        const changes = this.requireMethod(provider, 'changes');
        return await changes(request, signal, onProgress);
    }
    /**
     * Shared dispatch for personal library write operations: capability check,
     * provider method presence assertion, user approval gate, and execution.
     */
    async dispatchWrite(call, methodName, request) {
        const provider = this.resolveProvider();
        this.requireCapability(provider, 'write');
        // Method presence before the plan card: a provider that cannot serve the
        // write must not spend the user's approval on a call that cannot run.
        const method = this.requireMethod(provider, methodName);
        if (!(await this.approveWrite(call)))
            return { kind: 'declined' };
        const invoke = method;
        return await invoke(request, call.exec.signal);
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
    async createNote(request, call) {
        return await this.dispatchWrite(call, 'createNote', request);
    }
    /**
     * Update one item's tags (add/remove in one write).
     * @param request - the item ref and the tags to add/remove.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the merged tag list, the actual additions/removals, and versions,
     *   or `declined` when the user did not approve the plan.
     */
    async updateItemTags(request, call) {
        return await this.dispatchWrite(call, 'updateItemTags', request);
    }
    async updateNote(request, call) {
        return await this.dispatchWrite(call, 'updateNote', request);
    }
    /**
     * Update one item's collection membership (add/remove in one write).
     * @param request - the item ref and the collections to add/remove.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the resulting collections, the actual additions/removals, and versions,
     *   or `declined` when the user did not approve the plan.
     */
    async updateItemCollections(request, call) {
        return await this.dispatchWrite(call, 'updateItemCollections', request);
    }
    async updateCollection(request, call) {
        return await this.dispatchWrite(call, 'updateCollection', request);
    }
    /**
     * Create a collection, optionally under a parent.
     * @param request - the name and the optional parent ref or name.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the created collection, or `declined` when not approved.
     */
    async createCollection(request, call) {
        return await this.dispatchWrite(call, 'createCollection', request);
    }
    /**
     * Delete a collection by ref or name.
     * @param request - the collection ref or name.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the deletion receipt, or `declined` when not approved.
     */
    async deleteCollection(request, call) {
        return await this.dispatchWrite(call, 'deleteCollection', request);
    }
    /**
     * Create a bibliographic item from the closed field set.
     * @param request - the itemType plus title/url/date/doi/abstract/publicationTitle/creators.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the created item, or `declined` when not approved.
     */
    async createItem(request, call) {
        return await this.dispatchWrite(call, 'createItem', request);
    }
    /**
     * Update one item's scalar metadata fields.
     * @param request - the item ref and the closed-set field updates.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the changed fields and versions, or `declined` when not approved.
     */
    async updateItem(request, call) {
        return await this.dispatchWrite(call, 'updateItem', request);
    }
    /**
     * Delete tags library-wide. Irreversible.
     * @param request - the tag names to delete.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the deletion receipt, or `declined` when not approved.
     */
    async deleteLibraryTags(request, call) {
        return await this.dispatchWrite(call, 'deleteLibraryTags', request);
    }
    /**
     * Batch items operation: create/import, update tags/collections, delete.
     * @param request - the batch operations.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the outcome describing created, updated, and deleted items, or declined.
     */
    async batchItems(request, call) {
        return await this.dispatchWrite(call, 'batchItems', request);
    }
    async restoreItems(request, call) {
        return await this.dispatchWrite(call, 'restoreItems', request);
    }
    async createSavedSearch(request, call) {
        return await this.dispatchWrite(call, 'createSavedSearch', request);
    }
    async updateSavedSearch(request, call) {
        return await this.dispatchWrite(call, 'updateSavedSearch', request);
    }
    async deleteSavedSearch(request, call) {
        return await this.dispatchWrite(call, 'deleteSavedSearch', request);
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
    async approveWrite(call) {
        const policy = await requestWriteApproval(this.ctx, call);
        this.diagnostics.sink.info('write.gate', `write policy decision: ${policy}`, {
            tool: call.exec.name,
        });
        if (policy === 'declined')
            return false;
        if (policy === 'unavailable') {
            this.diagnostics.sink.error('write.gate', 'approval channel unavailable; write refused', {
                tool: call.exec.name,
            });
            throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE);
        }
        const approved = await askPlanApproval(this.ctx, call);
        this.diagnostics.sink.info('write.gate', approved ? 'plan review approved' : 'plan review declined', { tool: call.exec.name });
        return approved;
    }
    resolveProvider() {
        const provider = this.providers.get(this.config.provider);
        if (provider === undefined) {
            throw new ZoteroError(`No Zotero provider "${this.config.provider}" is registered.`, ZOTERO_PROVIDER_UNAVAILABLE);
        }
        return provider;
    }
    requireCapability(provider, capability) {
        if (!provider.capabilities.has(capability)) {
            this.diagnostics.sink.warn('capability.denied', `Zotero provider "${provider.id}" does not support the ${capability} capability.`, { capability, provider: provider.id });
            throw new ZoteroError(`Zotero provider "${provider.id}" does not support the ${capability} capability.`, ZOTERO_CAPABILITY_UNAVAILABLE);
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
    requireMethod(provider, method) {
        const fn = provider[method];
        if (typeof fn !== 'function') {
            throw new ZoteroError(`Zotero provider "${provider.id}" declares support but does not implement ${method}.`, ZOTERO_PROVIDER_UNAVAILABLE);
        }
        const bound = fn.bind(provider);
        return bound;
    }
}
export default ZoteroService;
//# sourceMappingURL=service.js.map