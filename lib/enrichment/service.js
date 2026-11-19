import { discardParsedDocument, listParsedDocuments, } from './artifact-management.js';
import { LRUCache } from 'lru-cache';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { errorMessageOf, domainCall, ZOTERO_INVALID_ARGUMENT, ZOTERO_FILE_UNREADABLE, ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZOTERO_PROVIDER_UNAVAILABLE, ZoteroError, } from '../errors.js';
import { zoteroSemanticModelStatusRequestSchema, zoteroSemanticModelDownloadRequestSchema, zoteroSemanticModelCancelRequestSchema, zoteroSemanticModelDeleteRequestSchema, zoteroSemanticModelVerifyRequestSchema, } from '../wire-schemas.js';
import { ZOTERO_ENRICHMENT_SERVICE_KEY, ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.js';
import { isPdfCandidateContentType, } from '../local/fulltext-enhancer.js';
import { EnrichmentConfigSchema, resolveEnrichmentConfig } from './config.js';
import { dnsAddressResolver, createPinnedDispatcher, publicFetch, } from '../transport/connections.js';
import { MineruClient } from './transport.js';
import { hostSourceBytesDeps, probeSource } from './source-bytes.js';
import { resolveOutputDir } from './output-dir.js';
import { ParsedArtifactStore, } from './artifact-store.js';
import { resolveArtifactTarget } from './artifact-target.js';
import { ParseFlight } from './parse-once.js';
import { parseDocument } from './parse-document.js';
import { DiskParseJobPersistence, EnrichmentParseJobs, } from './parse-jobs.js';
import { resolveMineruToken } from './credentials.js';
import { sourceKeyOf, stampMatches } from './source-stamp.js';
import { canonicalSourceIdentityOf } from './identity.js';
import { limitsFor } from './types.js';
import { AttachmentResolutionCache, probeAttachments, storedMetadata, } from './artifact-metadata.js';
import { resolveSemanticModelDir } from './model-dir.js';
import { ModelDownloadManager } from './model-downloader.js';
import { clearVerifiedSnapshots } from './model-bundle-inspector.js';
import { SemanticEmbedderLoader, semanticTargetOf, semanticUnavailable, } from './semantic/loader.js';
import { semanticEvidenceRanker } from './semantic/ranker.js';
import { admissionProfileOf } from './semantic/model-profiles.js';
import { createVectorCache, vectorCacheIdentityDigestOf, } from './semantic/vector-cache.js';
import { bm25EvidenceRanker, } from '../local/evidence-ranker.js';
/**
 * The one vector-cache identity for a model. The generation digest and the
 * cache's own key both derive from it, so a new identity field cannot change
 * one and miss the other.
 */
const VECTOR_SCORING_VERSION = 'fixed-floor-margin-v1';
function vectorCacheIdentityOf(spec) {
    return {
        key: spec.key,
        physicalKey: spec.physicalKey,
        revision: spec.revision,
        dimension: spec.dimension,
        maxTokens: spec.maxTokens,
        pooling: spec.pooling,
        normalize: spec.normalize,
        queryPrefix: spec.queryPrefix,
        documentPrefix: spec.documentPrefix,
        scoringVersion: VECTOR_SCORING_VERSION,
        fileDigests: Object.fromEntries(spec.files.map((file) => [file.path, file.sha256])),
    };
}
/** Wrap a bare error from a MinerU parse task: that task, not a read, failed. */
export function parseFailureOf(error) {
    return new ZoteroError(`MinerU parsing failed: ${errorMessageOf(error)}`, ZOTERO_ENRICHMENT_TASK_FAILED, {
        cause: error,
    });
}
/**
 * Wrap a bare error from a read-only artifact lookup. The lookup never talks
 * to MinerU, so the message must not borrow the parse task's wording: the
 * stored artifact could not be read from its own store. A ZoteroError already
 * carries its domain code and message, so it passes through unchanged.
 */
export function artifactReadFailureOf(error) {
    return error instanceof ZoteroError
        ? error
        : new ZoteroError(`The stored parsed artifact could not be read: ${errorMessageOf(error)}`, ZOTERO_FILE_UNREADABLE, { cause: error });
}
class DocumentCache {
    static MAX_ENTRIES = 2;
    static MAX_BYTES = 64 * 1024 * 1024;
    entries = new LRUCache({
        max: DocumentCache.MAX_ENTRIES,
        // ttlAutopurge keeps an idle entry from holding 64 MiB indefinitely; the
        // identity key already guarantees freshness, so the TTL is memory hygiene.
        ttl: DOCUMENT_CACHE_TTL_MS,
        ttlAutopurge: true,
    });
    hit(cacheKey, storeWrites) {
        return this.entries.get(documentCacheKeyOf(cacheKey, storeWrites));
    }
    put(cacheKey, storeWrites, hit) {
        if (Buffer.byteLength(hit.text, 'utf8') > DocumentCache.MAX_BYTES)
            return;
        this.entries.set(documentCacheKeyOf(cacheKey, storeWrites), hit);
    }
    /** Drop one artifact's entries: a discard retires readers and cache together. */
    retire(cacheKey) {
        for (const key of [...this.entries.keys()]) {
            if (key.startsWith(`${cacheKey}:`))
                this.entries.delete(key);
        }
    }
}
/** How long an untouched document stays cached; idle-timeout, not freshness. */
const DOCUMENT_CACHE_TTL_MS = 120_000;
/**
 * The cache key of one committed document: the artifact id and the store's
 * write counter. The counter is the one invalidation signal that covers every
 * commit path — a re-parse publishes through the same store — so the
 * fingerprint and generation do not need to ride in the key; the cached
 * entry's provenance states the identity it was read for.
 */
function documentCacheKeyOf(cacheKey, storeWrites) {
    return `${cacheKey}:${storeWrites}`;
}
export class EnrichmentService extends TypertRemoteService {
    config;
    static Config = EnrichmentConfigSchema;
    client;
    storeFactory;
    resolveAttachment;
    parsing;
    management;
    /** The enhancer installed into the core. Stable identity for cleanup. */
    enhancer;
    /** The resident embedder holder: one model at a time, released on disposal. */
    loader;
    /** The model-asset manager: status, download, cancel, verify, per service. */
    downloads;
    /** One bounded vector cache per model identity, ref-counted by admitted scopes. */
    vectorCache;
    /** The pending idle recycle for the resident model, restarted per admission. */
    semanticIdleTimer;
    /**
     * Restart the idle-recycle clock for the resident model. `retire()` marks
     * the instance retiring rather than disposing it: a ranking still holding
     * this scope keeps its model until it releases, exactly as the loader
     * documents, while the next admission opens a fresh instance.
     */
    armSemanticIdleRecycle(idleTimeoutMs, loader, target) {
        clearTimeout(this.semanticIdleTimer);
        this.semanticIdleTimer = undefined;
        if (idleTimeoutMs <= 0)
            return;
        this.semanticIdleTimer = setTimeout(() => {
            this.semanticIdleTimer = undefined;
            loader.retire(target);
        }, idleTimeoutMs);
        this.semanticIdleTimer.unref?.();
    }
    /**
     * The whole-document read-through cache behind `zotero_retrieve
     * mode:"fulltext"`: one lookup per window would otherwise re-read
     * meta.json and full.md for every window of the same document.
     */
    documents = new DocumentCache();
    /**
     * The badge-probe memo: one attachment resolution per ref per listing, so a
     * second page does not resolve the rows the first page already asked about.
     * Cleared on teardown with the other owned state.
     */
    attachmentResolutions = new AttachmentResolutionCache();
    /** Builds one loader per core-injection generation; tests inject a controlled one. */
    loaderFactory;
    /**
     * The ranker installed into the core. It reads the live config on every
     * call: disabled, it *is* the core's lexical ranker; enabled, it is the
     * hybrid one over the selected model, and a model that cannot serve fails
     * the call rather than degrading silently.
     */
    liveEvidenceRanker;
    constructor(ctx, config = {}, deps = {}) {
        super(ctx, ZOTERO_ENRICHMENT_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE });
        this.config = config;
        this.downloads = deps.downloads ?? new ModelDownloadManager();
        this.loaderFactory = deps.loader ?? (() => new SemanticEmbedderLoader());
        this.client =
            deps.client ??
                new MineruClient({
                    resolver: dnsAddressResolver,
                    dispatcher: createPinnedDispatcher,
                    fetch: publicFetch,
                });
        this.storeFactory =
            deps.store ?? (async (config, create) => await this.storeFor(config, create));
        this.resolveAttachment = async (ref, signal) => {
            const core = ctx.get('zotero');
            if (core === undefined) {
                throw new ZoteroError('The Zotero service is not composed; a local attachment cannot be resolved.', ZOTERO_PROVIDER_UNAVAILABLE);
            }
            return await core.resolveAttachment(ref, signal);
        };
        // The archive admission follows the configured reader limits. The policy is
        // read on every admission, so a configuration change applies to the next
        // operation without rebuilding the coordinator.
        const flight = deps.flight ?? new ParseFlight(() => resolveEnrichmentConfig(this.config).artifactReader);
        const persistence = deps.parsePersistence ?? new DiskParseJobPersistence();
        this.parsing = new EnrichmentParseJobs(ctx, {
            config: () => resolveEnrichmentConfig(this.config),
            resolveAttachment: this.resolveAttachment,
            store: async (config) => await this.storeFactory(config, false),
            execute: async ({ input, config, generation, signal, onProgress }) => await parseDocument(input, {
                config,
                generation,
                client: this.client,
                store: async (snapshot) => await this.storeFactory(snapshot, true),
                ...(deps.parse !== undefined ? { parse: deps.parse } : {}),
                flight,
                resolveAttachment: this.resolveAttachment,
                resolveToken: async (reference) => await resolveMineruToken(ctx, reference),
                onProgress,
            }, signal),
            displayCandidate: async (input, config, signal, targetLabel, record) => {
                try {
                    return await this.displayCandidate(input, config, signal, targetLabel, record);
                }
                catch (error) {
                    if (signal.aborted)
                        throw signal.reason;
                    throw artifactReadFailureOf(error);
                }
            },
            metadata: async (config, request, signal) => {
                try {
                    return await storedMetadata(this.metadataDeps(config), config, request, signal);
                }
                catch (error) {
                    if (signal.aborted)
                        throw signal.reason;
                    throw artifactReadFailureOf(error);
                }
            },
            probe: async (config, request, signal) => {
                try {
                    return await probeAttachments(this.metadataDeps(config), config, request, signal);
                }
                catch (error) {
                    if (signal.aborted)
                        throw signal.reason;
                    throw artifactReadFailureOf(error);
                }
            },
            persistence,
        });
        this.management = {
            store: async (config, create) => await this.storeFactory(config, create),
            config: () => resolveEnrichmentConfig(this.config),
            persistence,
            jobs: this.parsing,
        };
        // One admitted snapshot per foreground read. `admit()` runs before any
        // source I/O and fixes config, target, calibration and model generation;
        // `rank()` consumes the scope's own loader handle and cache generation, so
        // an unmount or a switch cannot release either while this request is still
        // ranking.
        const snapshots = new Map();
        const snapshotOf = () => {
            const cfg = resolveEnrichmentConfig(this.config);
            if (!cfg.enableSemanticSearch)
                return undefined;
            const target = semanticTargetOf(cfg, (physicalKey, configuredDir) => resolveSemanticModelDir(physicalKey, configuredDir));
            const spec = target.spec;
            const loader = this.loader;
            if (loader === undefined) {
                // Semantic ranking on with no core composed: fail closed instead of
                // degrading to lexical results behind the operator's back.
                throw new ZoteroError('Semantic ranking is enabled but no model loader is installed; the enrichment component needs the zotero core.', ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE);
            }
            // Admission fixes the model generation first: a closed loader throws here,
            // before this call can create a cache generation nobody would release.
            const loaderScope = loader.scope(target);
            // Every admitted scope restarts the idle clock: once no ranking has run
            // for the configured interval, the resident model is released and the
            // next admission re-opens it from disk. `0` opts out of recycling.
            this.armSemanticIdleRecycle(cfg.semanticIdleTimeoutMs, loader, target);
            // The vector cache is bound to the physical model identity: a different
            // revision or inference contract must not reuse another tier's vectors.
            const identity = vectorCacheIdentityOf(spec);
            const digest = vectorCacheIdentityDigestOf(identity);
            return {
                tier: spec.key,
                target,
                generation: this.acquireCacheGeneration(digest, identity),
                loaderScope,
            };
        };
        this.liveEvidenceRanker = {
            admit: () => {
                const snapshot = snapshotOf();
                const id = Symbol('ranking-scope');
                if (snapshot !== undefined)
                    snapshots.set(id, snapshot);
                return {
                    handle: id,
                    release: () => {
                        const held = snapshots.get(id);
                        snapshots.delete(id);
                        if (held === undefined)
                            return;
                        held.loaderScope.release();
                        this.releaseCacheGeneration(held.generation);
                    },
                };
            },
            rank: async (request) => {
                const admitted = request.scope === undefined ? undefined : snapshots.get(request.scope);
                const snapshot = admitted ?? snapshotOf();
                if (snapshot === undefined)
                    return await bm25EvidenceRanker.rank(request);
                try {
                    return await semanticEvidenceRanker({
                        embedder: (signal) => snapshot.loaderScope.embedder(signal),
                        profile: () => admissionProfileOf(snapshot.tier),
                        vectorCache: snapshot.generation.cache,
                    }).rank(request);
                }
                catch (error) {
                    // A cancelled request keeps its own reason; anything else that the
                    // model layer throws is a fail-closed semantic error, never a bare
                    // `Error` escaping into a retrieve.
                    if (request.signal?.aborted === true)
                        throw request.signal.reason ?? error;
                    throw semanticUnavailable(error);
                }
                finally {
                    // A direct rank() without an admitted scope borrowed both handles;
                    // release them in the same order an admitted scope does.
                    if (admitted === undefined) {
                        snapshot.loaderScope.release();
                        this.releaseCacheGeneration(snapshot.generation);
                    }
                }
            },
        };
        this.enhancer = {
            lookup: async (input, signal) => await this.lookup(input, signal),
            lookupArtifact: async (artifactId, signal) => await this.lookupArtifact(artifactId, signal),
        };
        // This component ships its own settings page; the schema-generated page
        // would be a second, conflicting surface for the same namespace. The
        // policy belongs to this plugin's own fiber, not to the zotero-injection
        // child, and it must be registered even when the core is not composed.
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        });
        // The component-level teardown: abort every owned download and release
        // the resident embedder and the vector cache, whether or not the core is
        // composed. Accepted scopes drain on their own release, exactly as the
        // loader documents. The owned workers are allSettled so a failing one
        // cannot skip the model and cache release: those hold real resources
        // (an ONNX session, vectors) and outlive any single job's cleanup.
        ctx.effect(() => async () => {
            const settled = await Promise.allSettled([this.parsing.dispose(), this.downloads.dispose()]);
            for (const outcome of settled) {
                if (outcome.status === 'rejected')
                    ctx.logger?.warn?.(`enrichment teardown: ${errorMessageOf(outcome.reason)}`);
            }
            this.retireActiveCache();
            // The idle recycle must not outlive the registration it was armed by.
            clearTimeout(this.semanticIdleTimer);
            this.semanticIdleTimer = undefined;
            // The bundle inspector's verification memo is process-wide state filled
            // by this registration; clear it so an unmounted row leaves no memory
            // behind for addresses it no longer serves.
            clearVerifiedSnapshots();
            // The probe memo answers for the Zotero instance this registration was
            // serving; an unmounted row keeps none of those answers.
            this.attachmentResolutions.clear();
            const loader = this.loader;
            this.loader = undefined;
            if (loader !== undefined)
                await loader.dispose();
        });
        // Install the enhancer and the ranking strategy into the core, and
        // withdraw both on disposal. The injected effect is fiber-scoped, so
        // unmounting the row clears the slots. Each injection generation gets its
        // own loader: the loader closes permanently on disposal, so re-running the
        // inject callback over the old instance left semantic ranking dead while
        // the namespace still reported ready.
        ctx.inject(['zotero'], (scoped) => {
            const zotero = scoped.zotero;
            const previous = this.loader;
            const loader = this.loaderFactory();
            this.loader = loader;
            if (previous !== undefined && previous !== loader) {
                void previous.dispose().catch(() => undefined);
            }
            zotero.setFulltextEnhancer(this.enhancer);
            zotero.setEvidenceRanker(this.liveEvidenceRanker);
            scoped.effect(() => async () => {
                zotero.setFulltextEnhancer(undefined);
                zotero.setEvidenceRanker(undefined);
                if (this.loader === loader)
                    this.loader = undefined;
                await loader.dispose();
            });
        });
    }
    /**
     * Retire a cache generation. Disposal waits for its last scope: the generation
     * is what an admitted `rank()` reads, and disposing it on a switch gave that
     * call a retired cache and a bare `Error`.
     */
    maybeDisposeCacheGeneration(generation) {
        if (!generation.retiring || generation.scopes > 0)
            return;
        generation.cache.dispose();
    }
    /** One admitted scope finished with this generation. */
    releaseCacheGeneration(generation) {
        generation.scopes -= 1;
        this.maybeDisposeCacheGeneration(generation);
    }
    /**
     * The generation a new admission runs against, created on an identity change.
     * The previous one is retired, not disposed: its admitted scopes still read it.
     */
    acquireCacheGeneration(digest, identity) {
        if (this.vectorCache === undefined || this.vectorCache.digest !== digest) {
            const previous = this.vectorCache;
            this.vectorCache = {
                digest,
                cache: createVectorCache(identity),
                scopes: 0,
                retiring: false,
            };
            if (previous !== undefined) {
                previous.retiring = true;
                this.maybeDisposeCacheGeneration(previous);
            }
        }
        const generation = this.vectorCache;
        generation.scopes += 1;
        return generation;
    }
    /** Teardown and model deletion: no new admission may reuse the current cache. */
    retireActiveCache() {
        const generation = this.vectorCache;
        this.vectorCache = undefined;
        if (generation === undefined)
            return;
        generation.retiring = true;
        this.maybeDisposeCacheGeneration(generation);
    }
    /** Parsing endpoints retain the current invocation context for action/session checks. */
    async startDocumentParse(request, signal) {
        return await domainCall(async () => await this.parsing.startDocumentParse(request, signal, this.ctx));
    }
    async documentArtifact(request, signal) {
        return await domainCall(async () => await this.parsing.documentArtifact(request, signal, this.ctx));
    }
    async documentParseReceipt(request, signal) {
        return await domainCall(async () => await this.parsing.documentParseReceipt(request, signal, this.ctx));
    }
    async listParsedDocuments(request, signal) {
        return await domainCall(async () => {
            this.parsing.authorizeManagement(request.sessionId, 'listParsedDocuments', this.ctx);
            return await listParsedDocuments(this.management, request, signal);
        });
    }
    async discardParsedDocument(request, signal) {
        return await domainCall(async () => {
            this.parsing.authorizeManagement(request.sessionId, 'discardParsedDocument', this.ctx);
            const result = await discardParsedDocument(this.management, request.artifactId, signal);
            // The artifact's files are gone (or its aliases were): retire the
            // document cache alongside the readers, so a discard is never followed
            // by a window read from bytes that no longer exist.
            if (result.kind === 'discarded')
                this.documents.retire(request.artifactId);
            return result;
        });
    }
    /** The model endpoints live here, on the component: unmounting the row
     * removes the egress capability along with it, exactly like the MinerU
     * authorization. Request fields override the committed settings; omitted
     * fields resolve from live config. A schema refusal is a model-facing
     * invalid argument, not an internal error. */
    parseWire(schema, request) {
        try {
            return schema.parse(request);
        }
        catch (error) {
            const issues = error instanceof Error ? error.message : String(error);
            throw new ZoteroError(`Invalid model request: ${issues}`, ZOTERO_INVALID_ARGUMENT);
        }
    }
    async semanticModelStatus(request, signal) {
        return await domainCall(async () => {
            signal.throwIfAborted();
            const parsed = this.parseWire(zoteroSemanticModelStatusRequestSchema, request);
            const cfg = resolveEnrichmentConfig(this.config);
            return await this.downloads.status(parsed.model ?? cfg.semanticModel, parsed.modelDir ?? cfg.semanticModelDir);
        });
    }
    async downloadSemanticModel(request, signal) {
        return await domainCall(async () => {
            signal.throwIfAborted();
            const parsed = this.parseWire(zoteroSemanticModelDownloadRequestSchema, request);
            const cfg = resolveEnrichmentConfig(this.config);
            return await this.downloads.start({
                model: parsed.model ?? cfg.semanticModel,
                source: parsed.source ?? cfg.semanticDownloadSource,
                modelDir: parsed.modelDir ?? cfg.semanticModelDir,
                force: parsed.force,
                onInstalled: (dir) => this.loader?.forgetBundleFailures(dir),
            });
        });
    }
    async cancelSemanticModelDownload(request, signal) {
        return await domainCall(async () => {
            signal.throwIfAborted();
            const parsed = this.parseWire(zoteroSemanticModelCancelRequestSchema, request);
            const cfg = resolveEnrichmentConfig(this.config);
            return {
                cancelled: await this.downloads.cancel(parsed.model ?? cfg.semanticModel, parsed.modelDir ?? cfg.semanticModelDir),
            };
        });
    }
    async deleteSemanticModel(request, signal) {
        return await domainCall(async () => {
            signal.throwIfAborted();
            const parsed = this.parseWire(zoteroSemanticModelDeleteRequestSchema, request);
            const cfg = resolveEnrichmentConfig(this.config);
            const model = parsed.model ?? cfg.semanticModel;
            const modelDir = parsed.modelDir ?? cfg.semanticModelDir;
            const result = await this.downloads.remove(model, modelDir, signal);
            // The pinned files are gone. A resident embedder would keep serving them
            // from memory, so the deletion would be invisible to the next read while
            // the settings page says the model is not installed; retire the instance
            // and the vectors it validated, and let the next admission re-open from
            // disk (where it now fails closed).
            if (result.success) {
                const target = semanticTargetOf({ semanticModel: model, semanticModelDir: modelDir }, (physicalKey, configuredDir) => resolveSemanticModelDir(physicalKey, configuredDir));
                this.loader?.retire(target);
                this.loader?.forgetBundleFailures(result.path);
                // Only the deleted tier's vectors are invalidated: deleting an unused
                // tier must not flush the warm cache of the configured model.
                const deletedDigest = vectorCacheIdentityDigestOf(vectorCacheIdentityOf(target.spec));
                if (this.vectorCache?.digest === deletedDigest)
                    this.retireActiveCache();
            }
            return result;
        });
    }
    async verifySemanticModel(request, signal) {
        return await domainCall(async () => {
            signal.throwIfAborted();
            const parsed = this.parseWire(zoteroSemanticModelVerifyRequestSchema, request);
            const cfg = resolveEnrichmentConfig(this.config);
            return await this.downloads.verify(parsed.model ?? cfg.semanticModel, parsed.modelDir ?? cfg.semanticModelDir);
        });
    }
    /**
     * Directory validation belongs to the accepted snapshot and is repeated on
     * every operation. One store instance is kept per resolved root, so its
     * per-generation caches (index snapshot, inventory) survive across calls.
     */
    resolvedStore;
    async storeFor(config, create) {
        const dir = await resolveOutputDir(config.outputDir, undefined, create ? { create: true } : { create: false, readOnly: true, allowMissing: true });
        if (this.resolvedStore?.dir !== dir) {
            this.resolvedStore = { dir, store: new ParsedArtifactStore(dir) };
        }
        return this.resolvedStore.store;
    }
    async displayCandidate(input, config, signal, targetLabel, resolvedRecord) {
        const store = await this.storeFactory(config, false);
        const identity = canonicalSourceIdentityOf(input.key);
        const source = canonicalSourceIdentityOf(input.source.kind === 'url' ? input.source.url : input.source.attachmentRef);
        if (identity !== source)
            throw new Error('The parsed source identity is inconsistent');
        // Artifact targets arrive with the record their expansion already read;
        // concrete targets look it up by source key.
        const record = resolvedRecord ?? (await store.sourceRecord(sourceKeyOf(identity)));
        signal.throwIfAborted();
        if (record === undefined)
            return { kind: 'missing' };
        const meta = await store.metadataFor(record);
        signal.throwIfAborted();
        if (meta === undefined)
            return { kind: 'expired' };
        const stamp = await probeSource(input, limitsFor(meta.mode).maxBytes, hostSourceBytesDeps(this.resolveAttachment, this.client), signal);
        signal.throwIfAborted();
        if (!stampMatches(record.stamp, stamp))
            return { kind: 'expired' };
        return {
            metadata: {
                sourceId: meta.sourceId,
                targetLabel,
                mode: meta.mode,
                artifactId: record.cacheKey,
                fingerprint: meta.contentFingerprint,
                characterCount: meta.characterCount,
                images: meta.images ?? [],
                ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
            },
            markdownBytes: meta.markdownBytes,
            read: () => store.readMarkdown(record.cacheKey, meta.characterCount, meta.markdownBytes, meta.markdownSha256),
            image: (name) => store.readImage(record.cacheKey, name, meta),
        };
    }
    /**
     * One composition per accepted snapshot: the store and its source seams.
     * The resolution memo is the component's, not the call's: it is what makes
     * two pages of one listing resolve each ref once.
     */
    metadataDeps(config) {
        return {
            store: async () => await this.storeFactory(config, false),
            resolveAttachment: this.resolveAttachment,
            client: this.client,
            resolutionCache: this.attachmentResolutions,
        };
    }
    /**
     * Read a stored artifact when the source has not changed. This arm never
     * obtains document bytes and never contacts MinerU; a local source is
     * `stat`ed and an indexed URL gets one HEAD. Selection is independent of
     * the currently configured parsing mode.
     */
    async lookup(input, signal, snapshot) {
        try {
            const cfg = snapshot ?? resolveEnrichmentConfig(this.config);
            if (!isPdfCandidateContentType(input.contentType))
                return { kind: 'miss', reason: 'absent' };
            const store = await this.storeFactory(cfg, false);
            return await this.lookupSource(input, store, signal);
        }
        catch (error) {
            return lookupFailureOf(error, signal);
        }
    }
    /**
     * Resolve an opaque artifact id back into its stored source, then read it
     * through the same read-only arm. The browser never holds a complete URL or
     * absolute path; the host reconstructs the target from the source index.
     */
    async lookupArtifact(artifactId, signal) {
        try {
            const cfg = resolveEnrichmentConfig(this.config);
            const store = await this.storeFactory(cfg, false);
            return await this.lookupArtifactFrom(artifactId, store, signal);
        }
        catch (error) {
            return lookupFailureOf(error, signal);
        }
    }
    /**
     * The artifactId read with its read-through cache. The cache entry carries
     * everything a committed artifact's window read needs — the resolved source
     * facts, provenance and Markdown — keyed by the artifact id and store's
     * write counter. A hit answers with zero file reads; a miss resolves the
     * target once and fills the entry.
     */
    async lookupArtifactFrom(artifactId, store, signal) {
        signal?.throwIfAborted();
        const cached = this.documents.hit(artifactId, store.writes);
        if (cached !== undefined)
            return { kind: 'hit', ...cached };
        const resolved = await resolveArtifactTarget(artifactId, store);
        const input = resolved.target.input;
        // The resolved target carries the safe display label and the concrete
        // source; the meta it already read rides along, so the artifact read
        // below re-reads neither the index nor meta.json. An orphan directory
        // has no index record: its meta is the only authority, and it was just
        // validated by the resolution.
        const display = {
            sourceKind: (input.source.kind === 'url' ? 'url' : 'attachment'),
            sourceLabel: resolved.target.targetLabel,
            ...(input.source.kind === 'local' ? { attachmentRef: input.source.attachmentRef } : {}),
        };
        const meta = resolved.stored.meta;
        const markdown = await store.readMarkdown(artifactId, meta.characterCount, meta.markdownBytes, meta.markdownSha256);
        signal?.throwIfAborted();
        if (markdown.trim() === '')
            throw new Error('The parsed artifact has no Markdown');
        const hit = {
            text: markdown,
            format: 'markdown',
            source: `MinerU (${meta.mode})`,
            ...display,
            provenance: {
                parser: 'mineru',
                mode: meta.mode,
                artifactId,
                fingerprint: meta.contentFingerprint,
                sourceId: meta.sourceId,
                generation: meta.generation,
            },
            ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
        };
        this.documents.put(artifactId, store.writes, hit);
        return { kind: 'hit', ...hit };
    }
    /**
     * Shared read-only lookup kernel for both direct and artifact-addressed
     * reads. `display` names the stored source when the caller already knows it
     * (an artifactId handle does not); `record` skips the source-index read when
     * the caller just resolved it. `probe` decides whether the live source is
     * revalidated before the stored bytes are trusted: a direct lookup names a
     * live source and checks it, while an artifactId read addresses the stored
     * artifact itself and never contacts the origin (AGENTS.md grants the
     * token-free HEAD to `lookup`, not to `lookupArtifact`).
     */
    async lookupSource(input, store, signal, display, record, captured, probe = true) {
        signal?.throwIfAborted();
        const identity = canonicalSourceIdentityOf(input.key);
        const sourceIdentity = canonicalSourceIdentityOf(input.source.kind === 'url' ? input.source.url : input.source.attachmentRef);
        if (identity !== sourceIdentity)
            throw new Error('The parsed source identity is inconsistent');
        const sourceKey = sourceKeyOf(identity);
        const candidate = record ?? (await store.sourceRecord(sourceKey));
        signal?.throwIfAborted();
        if (candidate === undefined)
            return { kind: 'miss', reason: 'absent' };
        const meta = captured?.meta ?? (await store.metadataFor(candidate));
        signal?.throwIfAborted();
        if (meta === undefined)
            return { kind: 'miss', reason: 'expired' };
        if (probe) {
            const stamp = await probeSource(input, limitsFor(meta.mode).maxBytes, hostSourceBytesDeps(this.resolveAttachment, this.client), signal);
            signal?.throwIfAborted();
            if (!stampMatches(candidate.stamp, stamp))
                return { kind: 'miss', reason: 'expired' };
        }
        // The meta (captured by the caller's resolution or read here) validates
        // the record before the bytes are read; the artifact read enforces the
        // meta's own byte and character counts.
        const markdown = await store.readMarkdown(candidate.cacheKey, meta.characterCount, meta.markdownBytes, meta.markdownSha256);
        signal?.throwIfAborted();
        if (markdown.trim() === '')
            throw new Error('The parsed artifact has no Markdown');
        return this.hitResultOf(candidate, meta, markdown, display, input);
    }
    /** The fulltext hit the lookup kernel returns, from validated meta and text. */
    hitResultOf(candidate, meta, markdown, display, input) {
        // A direct lookup knows its own source; an artifactId read receives the
        // facts from the resolved target instead.
        const sourceFacts = display ??
            (input?.source.kind === 'url'
                ? {
                    sourceKind: 'url',
                    sourceLabel: `${new URL(input.source.url).origin}/…`,
                }
                : {
                    sourceKind: 'attachment',
                    sourceLabel: input !== undefined ? input.source.attachmentRef : candidate.cacheKey,
                    ...(input !== undefined ? { attachmentRef: input.source.attachmentRef } : {}),
                });
        return {
            kind: 'hit',
            text: markdown,
            format: 'markdown',
            source: `MinerU (${meta.mode})`,
            ...sourceFacts,
            provenance: {
                parser: 'mineru',
                mode: meta.mode,
                artifactId: candidate.cacheKey,
                fingerprint: meta.contentFingerprint,
                sourceId: meta.sourceId,
                generation: meta.generation,
            },
            ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
        };
    }
}
/** Turn a lookup error into the read-only slot's miss or fault arm. */
function lookupFailureOf(error, signal) {
    if (signal?.aborted)
        throw signal.reason ?? error;
    if (error.code === 'ENOENT')
        return { kind: 'miss', reason: 'expired' };
    return { kind: 'fault', error: artifactReadFailureOf(error) };
}
export default EnrichmentService;
//# sourceMappingURL=service.js.map