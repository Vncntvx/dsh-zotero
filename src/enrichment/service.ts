import type { DisplayArtifactLookup } from './artifact-reads.js'
import {
  discardParsedDocument,
  listParsedDocuments,
  type ArtifactManagementDeps,
} from './artifact-management.js'
/**
 * Cordis Service plugin providing `ctx.enrichment`.
 *
 * The component registers no model tools, prompt section, or skill. Ordinary
 * read tools consume committed artifacts through a read-only FulltextEnhancer.
 * Explicit enrichment jobs own document acquisition and MinerU submission.
 *
 * **Dependency direction.** enrichment → core. The core defines the pure
 * `FulltextEnhancer` type and holds an optional slot; enrichment imports that
 * type and installs itself. The core never imports `src/enrichment/**`, owns no
 * MinerU transport, host table, or credentials, and keeps its loopback path
 * byte-for-byte unchanged when the slot is empty.
 *
 * **Cache before bytes.** `lookup` checks the source index before probing a
 * local attachment with stat or an indexed URL with HEAD. A hit only reads
 * local artifacts. The active-parse domain re-checks remote access, the
 * session, and the user's explicit submission of the one target before any
 * source probe or document acquisition; mounting the component is what
 * authorizes egress at all.
 *
 * **Failures propagate.** Configuration, authorization, source, protocol,
 * task, archive, and storage failures are explicit errors. The output path
 * is resolved before any document bytes are obtained or uploaded.
 * @module dsh-zotero/enrichment/service
 */

import { Context } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  errorMessageOf,
  domainCall,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../errors.js'
import {
  zoteroSemanticModelStatusRequestSchema,
  zoteroSemanticModelDownloadRequestSchema,
  zoteroSemanticModelCancelRequestSchema,
  zoteroSemanticModelDeleteRequestSchema,
  zoteroSemanticModelVerifyRequestSchema,
} from '../wire-schemas.js'
import type {
  ZoteroSemanticModelStatusRequestView,
  ZoteroSemanticModelStatusResultView,
  ZoteroSemanticModelDownloadRequestView,
  ZoteroSemanticModelDownloadResultView,
  ZoteroSemanticModelCancelRequestView,
  ZoteroSemanticModelCancelResultView,
  ZoteroSemanticModelDeleteRequestView,
  ZoteroSemanticModelDeleteResultView,
  ZoteroSemanticModelVerifyRequestView,
  ZoteroAttachmentLocationView,
  ZoteroStartDocumentParseRequestView,
  ZoteroStartDocumentParseResultView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptRequestView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroListParsedDocumentsRequestView,
  ZoteroListParsedDocumentsResultView,
  ZoteroDiscardParsedDocumentRequestView,
  ZoteroDiscardParsedDocumentResultView,
} from '../contract.js'
import {
  ENRICHMENT_DOCUMENT_LIMITS,
  type EnrichmentPreferences,
} from '../enrichment-preferences.js'
import { ZOTERO_ENRICHMENT_SERVICE_KEY, ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.js'
import {
  isPdfCandidateContentType,
  type FulltextEnhancer,
  type FulltextEnhancerInput,
  type FulltextLookupResult,
} from '../local/fulltext-enhancer.js'
import { EnrichmentConfigSchema, resolveEnrichmentConfig, type EnrichmentConfig } from './config.js'
import {
  dnsAddressResolver,
  createPinnedDispatcher,
  publicFetch,
} from '../transport/connections.js'
import { MineruClient } from './transport.js'
import { hostSourceBytesDeps, probeSource } from './source-bytes.js'
import { resolveOutputDir } from './output-dir.js'
import { ParsedArtifactStore, type SourceIndexRecord } from './artifact-store.js'
import { ParseFlight, type parseOnce } from './parse-once.js'
import { parseDocument } from './parse-document.js'
import {
  DiskParseJobPersistence,
  EnrichmentParseJobs,
  type ParseJobPersistence,
} from './parse-jobs.js'
import { resolveMineruToken } from './credentials.js'
import { sourceKeyOf, stampMatches } from './source-stamp.js'
import { canonicalSourceIdentityOf } from './identity.js'
import { probeAttachments, storedMetadata, type ArtifactMetadataDeps } from './artifact-metadata.js'
import { resolveSemanticModelDir } from './model-dir.js'
import { ModelDownloadManager } from './model-downloader.js'
import {
  SemanticEmbedderLoader,
  semanticTargetOf,
  type RankingScope,
  semanticUnavailable,
  type SemanticModelTarget,
} from './semantic/loader.js'
import { semanticEvidenceRanker } from './semantic/ranker.js'
import { admissionProfileOf } from './semantic/model-profiles.js'
import type { SemanticModelEntry, SemanticModelKey } from '../enrichment-model-catalog.js'
import {
  createVectorCache,
  type VectorCache,
  type VectorCacheIdentity,
} from './semantic/vector-cache.js'
import {
  bm25EvidenceRanker,
  type EvidenceRankRequest,
  type EvidenceRanker,
} from '../local/evidence-ranker.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enrichment: EnrichmentService
  }
}

/**
 * One vector cache generation: the entries a single model identity owns.
 *
 * The cache outlives its admission active period and must outlive every scope
 * that was admitted against it: a switch or a teardown retires the generation,
 * and the last scope to release it disposes it. Disposing on the switch instead
 * handed an in-flight ranking a retired cache, which throws a bare `Error`.
 */
interface CacheGeneration {
  readonly digest: string
  readonly cache: VectorCache
  scopes: number
  retiring: boolean
}

/** One committed foreground ranking snapshot, fixed before source I/O. */
interface RankingSnapshot {
  readonly tier: SemanticModelKey
  readonly target: SemanticModelTarget
  readonly generation: CacheGeneration
  readonly loaderScope: RankingScope
}

/**
 * The one vector-cache identity for a model. The generation digest and the
 * cache's own key both derive from it, so a new identity field cannot change
 * one and miss the other.
 */
const VECTOR_SCORING_VERSION = 'fixed-floor-margin-v1'

function vectorCacheIdentityOf(spec: SemanticModelEntry): VectorCacheIdentity {
  return {
    key: spec.key,
    physicalKey: spec.physicalKey,
    revision: spec.revision,
    dimension: spec.dimension,
    pooling: spec.pooling,
    normalize: spec.normalize,
    queryPrefix: spec.queryPrefix,
    documentPrefix: spec.documentPrefix,
    scoringVersion: VECTOR_SCORING_VERSION,
    fileDigests: Object.fromEntries(spec.files.map((file) => [file.path, file.sha256])),
  }
}

/** The generation identity: every field that changes the cached vectors. */
function vectorCacheDigestOf(identity: VectorCacheIdentity): string {
  return JSON.stringify([
    identity.physicalKey,
    identity.revision,
    identity.dimension,
    identity.pooling,
    identity.normalize,
    identity.queryPrefix,
    identity.documentPrefix,
    identity.scoringVersion,
    Object.entries(identity.fileDigests),
  ])
}

/** Core service face enrichment needs: the two slots and the attachment resolver. */
interface EnrichmentCoreLink {
  setFulltextEnhancer(enhancer: FulltextEnhancer | undefined): void
  setEvidenceRanker(ranker: EvidenceRanker | undefined): void
  resolveAttachment(ref: string, signal?: AbortSignal): Promise<ZoteroAttachmentLocationView>
}

/** Host seams, injectable so a spec never opens a socket or writes to disk. */
export interface EnrichmentServiceDeps {
  readonly client?: MineruClient
  readonly parse?: typeof parseOnce
  readonly store?: (config: EnrichmentPreferences, create: boolean) => Promise<ParsedArtifactStore>
  readonly flight?: ParseFlight
  readonly parsePersistence?: ParseJobPersistence
  /** The model-asset manager; tests inject a scripted one. */
  readonly downloads?: ModelDownloadManager
  /** The semantic loader factory; tests inject one with a controlled `open`. */
  readonly loader?: () => SemanticEmbedderLoader
}

/** A ZoteroError with its code preserved, so diagnostics and callers can route. */
function parsingErrorOf(error: unknown): Error {
  return error instanceof ZoteroError
    ? error
    : new ZoteroError(
        `MinerU parsing failed: ${errorMessageOf(error)}`,
        ZOTERO_ENRICHMENT_TASK_FAILED,
        { cause: error },
      )
}

export class EnrichmentService extends TypertRemoteService {
  static readonly Config = EnrichmentConfigSchema

  private readonly client: MineruClient
  private readonly storeFactory: (
    config: EnrichmentPreferences,
    create: boolean,
  ) => Promise<ParsedArtifactStore>
  private readonly resolveAttachment: EnrichmentCoreLink['resolveAttachment']
  private readonly parsing: EnrichmentParseJobs
  private readonly management: ArtifactManagementDeps

  /** The enhancer installed into the core. Stable identity for cleanup. */
  public readonly enhancer: FulltextEnhancer

  /** The resident embedder holder: one model at a time, released on disposal. */
  private loader: SemanticEmbedderLoader | undefined

  /** The model-asset manager: status, download, cancel, verify, per service. */
  private readonly downloads: ModelDownloadManager

  /** One bounded vector cache per model identity, ref-counted by admitted scopes. */
  private vectorCache: CacheGeneration | undefined

  /** Builds one loader per core-injection generation; tests inject a controlled one. */
  private readonly loaderFactory: () => SemanticEmbedderLoader

  /**
   * The ranker installed into the core. It reads the live config on every
   * call: disabled, it *is* the core's lexical ranker; enabled, it is the
   * hybrid one over the selected model, and a model that cannot serve fails
   * the call rather than degrading silently.
   */
  readonly liveEvidenceRanker: EvidenceRanker

  constructor(
    ctx: Context,
    public config: EnrichmentConfig = {},
    deps: EnrichmentServiceDeps = {},
  ) {
    super(ctx, ZOTERO_ENRICHMENT_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })
    this.downloads = deps.downloads ?? new ModelDownloadManager()
    this.loaderFactory = deps.loader ?? (() => new SemanticEmbedderLoader())
    this.client =
      deps.client ??
      new MineruClient({
        resolver: dnsAddressResolver,
        dispatcher: createPinnedDispatcher,
        fetch: publicFetch,
      })
    this.storeFactory =
      deps.store ?? (async (config, create) => await this.storeFor(config, create))
    this.resolveAttachment = async (ref, signal) => {
      const core = ctx.get('zotero') as EnrichmentCoreLink | undefined
      if (core === undefined) {
        throw new ZoteroError(
          'The Zotero service is not composed; a local attachment cannot be resolved.',
          ZOTERO_PROVIDER_UNAVAILABLE,
        )
      }
      return await core.resolveAttachment(ref, signal)
    }
    // The archive admission follows the configured reader limits. The policy is
    // read on every admission, so a configuration change applies to the next
    // operation without rebuilding the coordinator.
    const flight =
      deps.flight ?? new ParseFlight(() => resolveEnrichmentConfig(this.config).artifactReader)
    const persistence =
      deps.parsePersistence ??
      new DiskParseJobPersistence(
        async (config, create) => (await this.storeFactory(config, create)).root,
      )
    this.parsing = new EnrichmentParseJobs(ctx, {
      config: () => resolveEnrichmentConfig(this.config),
      resolveAttachment: this.resolveAttachment,
      store: async (config) => await this.storeFactory(config, false),
      execute: async ({ input, config, generation, signal, onProgress }) =>
        await parseDocument(
          input,
          {
            config,
            generation,
            client: this.client,
            store: async (snapshot) => await this.storeFactory(snapshot, true),
            ...(deps.parse !== undefined ? { parse: deps.parse } : {}),
            flight,
            resolveAttachment: this.resolveAttachment,
            resolveToken: async (reference) => await resolveMineruToken(ctx, reference),
            onProgress,
          },
          signal,
        ),
      displayCandidate: async (input, config, signal, targetLabel, record) => {
        try {
          return await this.displayCandidate(input, config, signal, targetLabel, record)
        } catch (error) {
          if (signal.aborted) throw signal.reason
          throw parsingErrorOf(error)
        }
      },
      metadata: async (config, request, signal) => {
        try {
          return await storedMetadata(this.metadataDeps(config), config, request, signal)
        } catch (error) {
          if (signal.aborted) throw signal.reason
          throw parsingErrorOf(error)
        }
      },
      probe: async (config, request, signal) => {
        try {
          return await probeAttachments(this.metadataDeps(config), config, request, signal)
        } catch (error) {
          if (signal.aborted) throw signal.reason
          throw parsingErrorOf(error)
        }
      },
      persistence,
    })
    this.management = {
      store: async (config, create) => await this.storeFactory(config, create),
      config: () => resolveEnrichmentConfig(this.config),
      persistence,
      jobs: this.parsing,
    }
    // One admitted snapshot per foreground read. `admit()` runs before any
    // source I/O and fixes config, target, calibration and model generation;
    // `rank()` consumes the scope's own loader handle and cache generation, so
    // an unmount or a switch cannot release either while this request is still
    // ranking.
    const snapshots = new Map<symbol, RankingSnapshot>()

    const snapshotOf = (): RankingSnapshot | undefined => {
      const cfg = resolveEnrichmentConfig(this.config)
      if (!cfg.enableSemanticSearch) return undefined
      const target = semanticTargetOf(cfg, (physicalKey, configuredDir) =>
        resolveSemanticModelDir(physicalKey, configuredDir),
      )
      const spec = target.spec
      const loader = this.loader
      if (loader === undefined) {
        // Semantic ranking on with no core composed: fail closed instead of
        // degrading to lexical results behind the operator's back.
        throw new ZoteroError(
          'Semantic ranking is enabled but no model loader is installed; the enrichment component needs the zotero core.',
          ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
        )
      }
      // Admission fixes the model generation first: a closed loader throws here,
      // before this call can create a cache generation nobody would release.
      const loaderScope = loader.scope(target)
      // The vector cache is bound to the physical model identity: a different
      // revision or inference contract must not reuse another tier's vectors.
      const identity = vectorCacheIdentityOf(spec)
      const digest = vectorCacheDigestOf(identity)
      return {
        tier: spec.key,
        target,
        generation: this.acquireCacheGeneration(digest, identity),
        loaderScope,
      }
    }
    this.liveEvidenceRanker = {
      admit: () => {
        const snapshot = snapshotOf()
        const id = Symbol('ranking-scope')
        if (snapshot !== undefined) snapshots.set(id, snapshot)
        return {
          handle: id,
          release: () => {
            const held = snapshots.get(id)
            snapshots.delete(id)
            if (held === undefined) return
            held.loaderScope.release()
            this.releaseCacheGeneration(held.generation)
          },
        }
      },
      rank: async (request: EvidenceRankRequest) => {
        const admitted = request.scope === undefined ? undefined : snapshots.get(request.scope)
        const snapshot = admitted ?? snapshotOf()
        if (snapshot === undefined) return await bm25EvidenceRanker.rank(request)
        try {
          return await semanticEvidenceRanker({
            embedder: () => snapshot.loaderScope.embedder(),
            profile: () => admissionProfileOf(snapshot.tier),
            vectorCache: snapshot.generation.cache,
          }).rank(request)
        } catch (error) {
          // A cancelled request keeps its own reason; anything else that the
          // model layer throws is a fail-closed semantic error, never a bare
          // `Error` escaping into a retrieve.
          if (request.signal?.aborted === true) throw request.signal.reason ?? error
          throw semanticUnavailable(error)
        } finally {
          // A direct rank() without an admitted scope borrowed both handles;
          // release them in the same order an admitted scope does.
          if (admitted === undefined) {
            snapshot.loaderScope.release()
            this.releaseCacheGeneration(snapshot.generation)
          }
        }
      },
    }

    this.enhancer = {
      lookup: async (input, signal) => await this.lookup(input, signal),
    }

    // This component ships its own settings page; the schema-generated page
    // would be a second, conflicting surface for the same namespace. The
    // policy belongs to this plugin's own fiber, not to the zotero-injection
    // child, and it must be registered even when the core is not composed.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })

    // The component-level teardown: abort every owned download and release
    // the resident embedder and the vector cache, whether or not the core is
    // composed. Accepted scopes drain on their own release, exactly as the
    // loader documents.
    ctx.effect(() => async () => {
      await Promise.all([this.parsing.dispose(), this.downloads.dispose()])
      this.retireActiveCache()
      const loader = this.loader
      this.loader = undefined
      if (loader !== undefined) await loader.dispose()
    })

    // Install the enhancer and the ranking strategy into the core, and
    // withdraw both on disposal. The injected effect is fiber-scoped, so
    // unmounting the row clears the slots. Each injection generation gets its
    // own loader: the loader closes permanently on disposal, so re-running the
    // inject callback over the old instance left semantic ranking dead while
    // the namespace still reported ready.
    ctx.inject(['zotero'], (scoped) => {
      const zotero = scoped.zotero as unknown as EnrichmentCoreLink
      const previous = this.loader
      const loader = this.loaderFactory()
      this.loader = loader
      if (previous !== undefined && previous !== loader) {
        void previous.dispose().catch(() => undefined)
      }
      zotero.setFulltextEnhancer(this.enhancer)
      zotero.setEvidenceRanker(this.liveEvidenceRanker)
      scoped.effect(() => async () => {
        zotero.setFulltextEnhancer(undefined)
        zotero.setEvidenceRanker(undefined)
        if (this.loader === loader) this.loader = undefined
        await loader.dispose()
      })
    })
  }

  /**
   * Retire a cache generation. Disposal waits for its last scope: the generation
   * is what an admitted `rank()` reads, and disposing it on a switch gave that
   * call a retired cache and a bare `Error`.
   */
  private maybeDisposeCacheGeneration(generation: CacheGeneration): void {
    if (!generation.retiring || generation.scopes > 0) return
    generation.cache.dispose()
  }

  /** One admitted scope finished with this generation. */
  private releaseCacheGeneration(generation: CacheGeneration): void {
    generation.scopes -= 1
    this.maybeDisposeCacheGeneration(generation)
  }

  /**
   * The generation a new admission runs against, created on an identity change.
   * The previous one is retired, not disposed: its admitted scopes still read it.
   */
  private acquireCacheGeneration(digest: string, identity: VectorCacheIdentity): CacheGeneration {
    if (this.vectorCache === undefined || this.vectorCache.digest !== digest) {
      const previous = this.vectorCache
      this.vectorCache = {
        digest,
        cache: createVectorCache(identity),
        scopes: 0,
        retiring: false,
      }
      if (previous !== undefined) {
        previous.retiring = true
        this.maybeDisposeCacheGeneration(previous)
      }
    }
    const generation = this.vectorCache
    generation.scopes += 1
    return generation
  }

  /** Teardown and model deletion: no new admission may reuse the current cache. */
  private retireActiveCache(): void {
    const generation = this.vectorCache
    this.vectorCache = undefined
    if (generation === undefined) return
    generation.retiring = true
    this.maybeDisposeCacheGeneration(generation)
  }

  /** Parsing endpoints retain the current invocation context for action/session checks. */
  async startDocumentParse(
    request: ZoteroStartDocumentParseRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroStartDocumentParseResultView> {
    return await domainCall(
      async () => await this.parsing.startDocumentParse(request, signal, this.ctx),
    )
  }

  async documentArtifact(
    request: ZoteroDocumentArtifactRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroDocumentArtifactResultView> {
    return await domainCall(
      async () => await this.parsing.documentArtifact(request, signal, this.ctx),
    )
  }

  async documentParseReceipt(
    request: ZoteroDocumentParseReceiptRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroDocumentParseReceiptResultView> {
    return await domainCall(
      async () => await this.parsing.documentParseReceipt(request, signal, this.ctx),
    )
  }

  async listParsedDocuments(
    request: ZoteroListParsedDocumentsRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroListParsedDocumentsResultView> {
    return await domainCall(async () => {
      this.parsing.authorizeManagement(request.sessionId, 'listParsedDocuments', this.ctx)
      return await listParsedDocuments(this.management, request, signal)
    })
  }

  async discardParsedDocument(
    request: ZoteroDiscardParsedDocumentRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroDiscardParsedDocumentResultView> {
    return await domainCall(async () => {
      this.parsing.authorizeManagement(request.sessionId, 'discardParsedDocument', this.ctx)
      return await discardParsedDocument(this.management, request.artifactId, signal)
    })
  }

  /** The model endpoints live here, on the component: unmounting the row
   * removes the egress capability along with it, exactly like the MinerU
   * authorization. Request fields override the committed settings; omitted
   * fields resolve from live config. A schema refusal is a model-facing
   * invalid argument, not an internal error. */
  private parseWire<T>(schema: { parse(value: unknown): T }, request: unknown): T {
    try {
      return schema.parse(request)
    } catch (error) {
      const issues = error instanceof Error ? error.message : String(error)
      throw new ZoteroError(`Invalid model request: ${issues}`, ZOTERO_INVALID_ARGUMENT)
    }
  }

  async semanticModelStatus(
    request: ZoteroSemanticModelStatusRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelStatusResultView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      const parsed = this.parseWire(zoteroSemanticModelStatusRequestSchema, request)
      const cfg = resolveEnrichmentConfig(this.config)
      return await this.downloads.status(
        parsed.model ?? cfg.semanticModel,
        parsed.modelDir ?? cfg.semanticModelDir,
      )
    })
  }

  async downloadSemanticModel(
    request: ZoteroSemanticModelDownloadRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelDownloadResultView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      const parsed = this.parseWire(zoteroSemanticModelDownloadRequestSchema, request)
      const cfg = resolveEnrichmentConfig(this.config)
      return await this.downloads.start({
        model: parsed.model ?? cfg.semanticModel,
        source: parsed.source ?? cfg.semanticDownloadSource,
        modelDir: parsed.modelDir ?? cfg.semanticModelDir,
        force: parsed.force,
      })
    })
  }

  async cancelSemanticModelDownload(
    request: ZoteroSemanticModelCancelRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelCancelResultView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      const parsed = this.parseWire(zoteroSemanticModelCancelRequestSchema, request)
      const cfg = resolveEnrichmentConfig(this.config)
      return {
        cancelled: await this.downloads.cancel(
          parsed.model ?? cfg.semanticModel,
          parsed.modelDir ?? cfg.semanticModelDir,
        ),
      }
    })
  }

  async deleteSemanticModel(
    request: ZoteroSemanticModelDeleteRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelDeleteResultView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      const parsed = this.parseWire(zoteroSemanticModelDeleteRequestSchema, request)
      const cfg = resolveEnrichmentConfig(this.config)
      const model = parsed.model ?? cfg.semanticModel
      const modelDir = parsed.modelDir ?? cfg.semanticModelDir
      const result = await this.downloads.remove(model, modelDir, signal)
      // The pinned files are gone. A resident embedder would keep serving them
      // from memory, so the deletion would be invisible to the next read while
      // the settings page says the model is not installed; retire the instance
      // and the vectors it validated, and let the next admission re-open from
      // disk (where it now fails closed).
      if (result.success) {
        const target = semanticTargetOf(
          { semanticModel: model, semanticModelDir: modelDir },
          (physicalKey, configuredDir) => resolveSemanticModelDir(physicalKey, configuredDir),
        )
        this.loader?.retire(target)
        // Only the deleted tier's vectors are invalidated: deleting an unused
        // tier must not flush the warm cache of the configured model.
        const deletedDigest = vectorCacheDigestOf(vectorCacheIdentityOf(target.spec))
        if (this.vectorCache?.digest === deletedDigest) this.retireActiveCache()
      }
      return result
    })
  }

  async verifySemanticModel(
    request: ZoteroSemanticModelVerifyRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelStatusResultView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      const parsed = this.parseWire(zoteroSemanticModelVerifyRequestSchema, request)
      const cfg = resolveEnrichmentConfig(this.config)
      return await this.downloads.verify(
        parsed.model ?? cfg.semanticModel,
        parsed.modelDir ?? cfg.semanticModelDir,
      )
    })
  }

  /**
   * Directory validation belongs to the accepted snapshot and is repeated on
   * every operation. One store instance is kept per resolved root, so its
   * per-generation caches (index snapshot, inventory) survive across calls.
   */
  private resolvedStore: { readonly dir: string; readonly store: ParsedArtifactStore } | undefined

  private async storeFor(
    config: EnrichmentPreferences,
    create: boolean,
  ): Promise<ParsedArtifactStore> {
    const dir = await resolveOutputDir(
      config.outputDir,
      undefined,
      create ? { create: true } : { create: false, readOnly: true, allowMissing: true },
    )
    if (this.resolvedStore?.dir !== dir) {
      this.resolvedStore = { dir, store: new ParsedArtifactStore(dir) }
    }
    return this.resolvedStore.store
  }

  private async displayCandidate(
    input: FulltextEnhancerInput,
    config: EnrichmentPreferences,
    signal: AbortSignal,
    targetLabel: string,
    resolvedRecord?: SourceIndexRecord,
  ): Promise<DisplayArtifactLookup> {
    const store = await this.storeFactory(config, false)
    const identity = canonicalSourceIdentityOf(input.key)
    const source = canonicalSourceIdentityOf(
      input.source.kind === 'url' ? input.source.url : input.source.attachmentRef,
    )
    if (identity !== source) throw new Error('The parsed source identity is inconsistent')
    // Artifact targets arrive with the record their expansion already read;
    // concrete targets look it up by source key.
    const record = resolvedRecord ?? (await store.sourceRecord(sourceKeyOf(identity)))
    signal.throwIfAborted()
    if (record === undefined) return { kind: 'missing' }
    const stamp = await probeSource(
      input,
      ENRICHMENT_DOCUMENT_LIMITS.pro.maxBytes,
      hostSourceBytesDeps(this.resolveAttachment, this.client),
      signal,
    )
    signal.throwIfAborted()
    if (!stampMatches(record.stamp, stamp)) return { kind: 'expired' }
    const meta = await store.metadataFor(record)
    signal.throwIfAborted()
    if (meta === undefined) return { kind: 'expired' }
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
      read: () => store.readMarkdown(record.cacheKey, meta.characterCount, meta.markdownBytes),
      image: (name) => store.readImage(record.cacheKey, name, meta),
    }
  }

  /** One composition per accepted snapshot: the store and its source seams. */
  private metadataDeps(config: EnrichmentPreferences): ArtifactMetadataDeps {
    return {
      store: async () => await this.storeFactory(config, false),
      resolveAttachment: this.resolveAttachment,
      client: this.client,
    }
  }

  /**
   * Read a stored artifact when the source has not changed. This arm never
   * obtains document bytes and never contacts MinerU; a local source is
   * `stat`ed and an indexed URL gets one HEAD. Selection is independent of
   * the currently configured parsing mode.
   */
  private async lookup(
    input: FulltextEnhancerInput,
    signal?: AbortSignal,
    snapshot?: EnrichmentPreferences,
  ): Promise<FulltextLookupResult> {
    try {
      const cfg = snapshot ?? resolveEnrichmentConfig(this.config)
      if (!isPdfCandidateContentType(input.contentType)) return { kind: 'miss', reason: 'absent' }
      signal?.throwIfAborted()
      const store = await this.storeFactory(cfg, false)
      signal?.throwIfAborted()
      const identity = canonicalSourceIdentityOf(input.key)
      const sourceIdentity = canonicalSourceIdentityOf(
        input.source.kind === 'url' ? input.source.url : input.source.attachmentRef,
      )
      if (identity !== sourceIdentity) throw new Error('The parsed source identity is inconsistent')
      const sourceKey = sourceKeyOf(identity)
      const candidate = await store.sourceRecord(sourceKey)
      signal?.throwIfAborted()
      if (candidate === undefined) return { kind: 'miss', reason: 'absent' }
      const stamp = await probeSource(
        input,
        ENRICHMENT_DOCUMENT_LIMITS.pro.maxBytes,
        hostSourceBytesDeps(this.resolveAttachment, this.client),
        signal,
      )
      signal?.throwIfAborted()
      if (!stampMatches(candidate.stamp, stamp)) return { kind: 'miss', reason: 'expired' }
      const artifact = await store.artifactFor(candidate)
      signal?.throwIfAborted()
      if (artifact === undefined) return { kind: 'miss', reason: 'expired' }
      if (artifact.markdown.trim() === '') throw new Error('The parsed artifact has no Markdown')
      return {
        kind: 'hit',
        text: artifact.markdown,
        format: 'markdown',
        source: `MinerU (${artifact.meta.mode})`,
        provenance: {
          parser: 'mineru',
          mode: artifact.meta.mode,
          artifactId: candidate.cacheKey,
          fingerprint: artifact.meta.contentFingerprint,
          sourceId: artifact.meta.sourceId,
          generation: artifact.meta.generation,
        },
        ...(artifact.meta.pageCount !== undefined ? { pageCount: artifact.meta.pageCount } : {}),
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { kind: 'miss', reason: 'expired' }
      return { kind: 'fault', error: parsingErrorOf(error) }
    }
  }
}

export default EnrichmentService
