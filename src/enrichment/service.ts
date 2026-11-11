/**
 * Cordis Service plugin providing `ctx.enrichment`.
 *
 * The component's presence is the authorization to contact MinerU; it
 * registers no model tools, no prompt section, and no skill. It feeds the
 * existing read tools through one optional slot in the core service — a
 * `FulltextEnhancer` — so mounting/unmounting the row is the only switch that
 * changes whether external requests can happen.
 *
 * **Dependency direction.** enrichment → core. The core defines the pure
 * `FulltextEnhancer` type and holds an optional slot; enrichment imports that
 * type and installs itself. The core never imports `src/enrichment/**`, owns no
 * MinerU transport, host table, or credentials, and keeps its loopback path
 * byte-for-byte unchanged when the slot is empty.
 *
 * **Cache before bytes.** `lookup` probes the source without reading it (a
 * local `stat`, a URL HEAD, or a digest of caller-supplied bytes) and serves a
 * stored artifact when its source stamp still matches. Only `enhance` obtains
 * bytes, resolves the pro token, and submits to MinerU. A cache hit therefore
 * sends nothing and downloads nothing; the upload authorization governs new
 * egress, not reading an artifact that already exists.
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
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
  ZOTERO_ENRICHMENT_OUTPUT_INVALID,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../errors.js'
import {
  zoteroSemanticModelStatusRequestSchema,
  zoteroSemanticModelDownloadRequestSchema,
  zoteroSemanticModelCancelRequestSchema,
  zoteroSemanticModelVerifyRequestSchema,
} from '../wire-schemas.js'
import type {
  ZoteroSemanticModelStatusRequestView,
  ZoteroSemanticModelStatusResultView,
  ZoteroSemanticModelDownloadRequestView,
  ZoteroSemanticModelDownloadResultView,
  ZoteroSemanticModelCancelRequestView,
  ZoteroSemanticModelCancelResultView,
  ZoteroSemanticModelVerifyRequestView,
} from '../contract.js'
import { ZOTERO_ENRICHMENT_SERVICE_KEY, ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.js'
import {
  isPdfContentType,
  type FulltextEnhancer,
  type FulltextEnhancerInput,
  type FulltextEnhancerOutcome,
  type FulltextLookupResult,
} from '../local/fulltext-enhancer.js'
import { EnrichmentConfigSchema, resolveEnrichmentConfig, type EnrichmentConfig } from './config.js'
import { resolveMineruToken } from './credentials.js'
import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from '../credential-names.js'
import { dnsAddressResolver, createPinnedDispatcher } from '../transport/connections.js'
import { MineruClient } from './transport.js'
import {
  hostSourceBytesDeps,
  obtainSourceBytes,
  probeSource,
  type SourceBytesDeps,
} from './source-bytes.js'
import { resolveOutputDir } from './output-dir.js'
import { ParsedArtifactStore } from './artifact-store.js'
import { cacheKeyOf, contentFingerprintOf, ParseFlight, parseOnce } from './parse-once.js'
import { parsedIdentityOf } from './identity.js'
import { sourceKeyOf } from './source-stamp.js'
import { limitsFor } from './types.js'
import { resolveSemanticModelDir } from './model-dir.js'
import { ModelDownloadManager } from './model-downloader.js'
import { SemanticEmbedderLoader, semanticTargetOf } from './semantic/loader.js'
import { semanticEvidenceRanker } from './semantic/ranker.js'
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

/** Core service face enrichment needs: the two slots and the attachment resolver. */
interface EnrichmentCoreLink {
  setFulltextEnhancer(enhancer: FulltextEnhancer | undefined): void
  setEvidenceRanker(ranker: EvidenceRanker | undefined): void
  resolveAttachment(
    ref: string,
    signal?: AbortSignal,
  ): Promise<{
    kind: 'file' | 'url'
    path?: string
    url?: string
  }>
}

/** Host seams, injectable so a spec never opens a socket or writes to disk. */
export interface EnrichmentServiceDeps {
  readonly client?: MineruClient
  readonly parse?: typeof parseOnce
  readonly store?: () => Promise<ParsedArtifactStore>
  readonly flight?: ParseFlight
  /** The model-asset manager; tests inject a scripted one. */
  readonly downloads?: ModelDownloadManager
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

function fatalOf(error: unknown): { readonly kind: 'fatal'; readonly error: Error } {
  return { kind: 'fatal', error: error instanceof Error ? error : new Error(String(error)) }
}

export class EnrichmentService extends TypertRemoteService {
  static readonly Config = EnrichmentConfigSchema

  private readonly client: MineruClient
  private readonly parse: typeof parseOnce
  private readonly storeFactory: () => Promise<ParsedArtifactStore>
  private readonly flight: ParseFlight
  private readonly resolveAttachment: SourceBytesDeps['resolveAttachment']

  /** The enhancer installed into the core. Stable identity for cleanup. */
  public readonly enhancer: FulltextEnhancer

  /** The resident embedder holder: one model at a time, released on disposal. */
  private readonly rankerLoader: SemanticEmbedderLoader

  /** The model-asset manager: status, download, cancel, verify, per service. */
  private readonly downloads: ModelDownloadManager

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
    this.client =
      deps.client ??
      new MineruClient({
        resolver: dnsAddressResolver,
        dispatcher: createPinnedDispatcher,
        fetch: globalThis.fetch,
      })
    this.parse = deps.parse ?? parseOnce
    this.storeFactory = deps.store ?? (async () => await this.store())
    this.flight = deps.flight ?? new ParseFlight()
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
    this.rankerLoader = new SemanticEmbedderLoader()
    this.liveEvidenceRanker = {
      rank: async (request: EvidenceRankRequest) => {
        const cfg = resolveEnrichmentConfig(this.config)
        if (!cfg.enableSemanticSearch) return await bm25EvidenceRanker.rank(request)
        const target = semanticTargetOf(cfg, (physicalKey, configuredDir) =>
          resolveSemanticModelDir(physicalKey, configuredDir),
        )
        return await semanticEvidenceRanker({
          embedder: () => this.rankerLoader.get(target),
        }).rank(request)
      },
    }

    this.enhancer = {
      lookup: async (input, signal) => await this.lookup(input, signal),
      enhance: async (input, signal) => await this.enhance(input, signal),
    }

    // This component ships its own settings page; the schema-generated page
    // would be a second, conflicting surface for the same namespace. The
    // policy belongs to this plugin's own fiber, not to the zotero-injection
    // child, and it must be registered even when the core is not composed.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })

    // The component-level teardown: abort every owned download and release
    // the resident embedder, whether or not the core is composed.
    ctx.effect(() => async () => {
      await this.downloads.dispose()
      await this.rankerLoader.dispose()
    })

    // Install the enhancer and the ranking strategy into the core, and
    // withdraw both on disposal. The injected effect is fiber-scoped, so
    // unmounting the row clears the slots; the async teardown also releases
    // the resident embedder session.
    ctx.inject(['zotero'], (scoped) => {
      const zotero = scoped.zotero as unknown as EnrichmentCoreLink
      zotero.setFulltextEnhancer(this.enhancer)
      zotero.setEvidenceRanker(this.liveEvidenceRanker)
      scoped.effect(() => async () => {
        zotero.setFulltextEnhancer(undefined)
        zotero.setEvidenceRanker(undefined)
        await this.rankerLoader.dispose()
      })
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
    signal.throwIfAborted()
    const parsed = this.parseWire(zoteroSemanticModelStatusRequestSchema, request)
    const cfg = resolveEnrichmentConfig(this.config)
    return await this.downloads.status(
      parsed.model ?? cfg.semanticModel,
      parsed.modelDir ?? cfg.semanticModelDir,
    )
  }

  async downloadSemanticModel(
    request: ZoteroSemanticModelDownloadRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelDownloadResultView> {
    signal.throwIfAborted()
    const parsed = this.parseWire(zoteroSemanticModelDownloadRequestSchema, request)
    const cfg = resolveEnrichmentConfig(this.config)
    return await this.downloads.start({
      model: parsed.model ?? cfg.semanticModel,
      source: parsed.source ?? cfg.semanticDownloadSource,
      modelDir: parsed.modelDir ?? cfg.semanticModelDir,
      force: parsed.force,
    })
  }

  async cancelSemanticModelDownload(
    request: ZoteroSemanticModelCancelRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelCancelResultView> {
    signal.throwIfAborted()
    const parsed = this.parseWire(zoteroSemanticModelCancelRequestSchema, request)
    const cfg = resolveEnrichmentConfig(this.config)
    return {
      cancelled: await this.downloads.cancel(
        parsed.model ?? cfg.semanticModel,
        parsed.modelDir ?? cfg.semanticModelDir,
      ),
    }
  }

  async verifySemanticModel(
    request: ZoteroSemanticModelVerifyRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSemanticModelStatusResultView> {
    signal.throwIfAborted()
    const parsed = this.parseWire(zoteroSemanticModelVerifyRequestSchema, request)
    const cfg = resolveEnrichmentConfig(this.config)
    return await this.downloads.verify(
      parsed.model ?? cfg.semanticModel,
      parsed.modelDir ?? cfg.semanticModelDir,
    )
  }

  /**
   * Resolve the output directory for the current config value. The resolved
   * store is memoized per configured string — the resolution costs a dozen
   * realpath/stat calls — and a settings edit re-resolves by key change.
   */
  private storeMemo:
    { readonly configured: string; readonly store: ParsedArtifactStore } | undefined

  private async store(): Promise<ParsedArtifactStore> {
    const configured = resolveEnrichmentConfig(this.config).outputDir
    if (this.storeMemo?.configured === configured) return this.storeMemo.store
    const dir = await resolveOutputDir(configured)
    const store = new ParsedArtifactStore(dir)
    this.storeMemo = { configured, store }
    return store
  }

  /**
   * Read a stored artifact when the source has not changed. This arm never
   * obtains document bytes and never contacts MinerU; a local source is
   * `stat`ed, a URL gets one HEAD, supplied bytes are hashed.
   */
  private async lookup(
    input: FulltextEnhancerInput,
    signal?: AbortSignal,
  ): Promise<FulltextLookupResult> {
    let cfg
    try {
      cfg = resolveEnrichmentConfig(this.config)
    } catch (error) {
      return { outcome: fatalOf(error) }
    }
    if (!isPdfContentType(input.contentType)) return {}

    try {
      const store = await this.storeFactory()
      const maxBytes = limitsFor(cfg.mode).maxBytes
      const stamp = await probeSource(
        input,
        maxBytes,
        hostSourceBytesDeps(this.resolveAttachment, this.client),
        signal,
      )
      const artifact = await store.lookupSource(sourceKeyOf(input.key, cfg.mode), stamp)
      if (artifact === undefined) return { stamp }
      return { outcome: this.outcomeOf(artifact, cfg), stamp }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      return { outcome: fatalOf(parsingErrorOf(error)) }
    }
  }

  /**
   * Produce higher-quality full text for one PDF or an explicit error.
   */
  private async enhance(
    input: FulltextEnhancerInput,
    signal?: AbortSignal,
  ): Promise<FulltextEnhancerOutcome> {
    let cfg
    try {
      cfg = resolveEnrichmentConfig(this.config)
    } catch (error) {
      return fatalOf(error)
    }

    if (!isPdfContentType(input.contentType)) {
      return fatalOf(
        new ZoteroError(
          'Only PDF attachments are eligible for MinerU parsing',
          ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
        ),
      )
    }

    // The output directory is a configuration fact: resolve it before any
    // document bytes are read or sent, so a bad path never uploads a file.
    let store: ParsedArtifactStore
    try {
      store = await this.storeFactory()
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof ZoteroError && error.code === ZOTERO_ENRICHMENT_OUTPUT_INVALID) {
        return fatalOf(error)
      }
      return fatalOf(parsingErrorOf(error))
    }

    const maxBytes = limitsFor(cfg.mode).maxBytes
    const sourceKey = sourceKeyOf(input.key, cfg.mode)
    const byteDeps = hostSourceBytesDeps(this.resolveAttachment, this.client)

    try {
      const stamp = await probeSource(input, maxBytes, byteDeps, signal)
      const cached = await store.lookupSource(sourceKey, stamp)
      if (cached !== undefined) return this.outcomeOf(cached, cfg)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      return fatalOf(parsingErrorOf(error))
    }

    if (!cfg.allowDocumentUpload) {
      return fatalOf(
        new ZoteroError(
          'MinerU parsing requires allowDocumentUpload; no bytes were sent',
          ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
        ),
      )
    }

    // Token is read only in pro mode. Free mode never touches it, which is what
    // lets a configured token coexist with a deliberate free-mode choice. A
    // cache hit above already returned, so a cached pro artifact needs no token.
    let token: string | undefined
    if (cfg.mode === 'pro') {
      const ref = cfg.mineruTokenRef?.trim() || ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru
      try {
        token = await resolveMineruToken(this.ctx, ref)
      } catch (error) {
        return fatalOf(error)
      }
    }

    try {
      const source = await obtainSourceBytes(input, maxBytes, byteDeps, signal)
      // One hash of the document feeds the parse input, the cache key, and the
      // source-index write; nobody hashes these bytes again.
      const fingerprint = contentFingerprintOf(source.bytes)
      const artifact = await this.parse(
        {
          identity: input.key,
          metaIdentity: parsedIdentityOf(input.key),
          mode: cfg.mode,
          bytes: source.bytes,
          fingerprint,
          ...(token !== undefined ? { token } : {}),
          ...(signal !== undefined ? { signal } : {}),
        },
        { client: this.client, store, flight: this.flight },
      )
      await store.putSource(sourceKey, {
        version: 1,
        cacheKey: cacheKeyOf({
          identity: input.key,
          mode: cfg.mode,
          bytes: source.bytes,
          fingerprint,
        }),
        fingerprint: artifact.meta.contentFingerprint,
        stamp: source.stamp,
      })
      return this.outcomeOf(artifact, cfg)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (
        error instanceof ZoteroError &&
        (error.code === ZOTERO_ENRICHMENT_OUTPUT_INVALID ||
          error.code === ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED)
      ) {
        return fatalOf(error)
      }
      return fatalOf(parsingErrorOf(error))
    }
  }

  /** Turn one artifact into the enhancer's answer, refusing untrustworthy text. */
  private outcomeOf(
    artifact: Awaited<ReturnType<typeof parseOnce>>,
    cfg: ReturnType<typeof resolveEnrichmentConfig>,
  ): FulltextEnhancerOutcome {
    if (artifact.markdown.trim() === '')
      return fatalOf(
        new ZoteroError('MinerU returned empty Markdown', ZOTERO_ENRICHMENT_TASK_FAILED),
      )
    return {
      kind: 'ok',
      text: artifact.markdown,
      ...(artifact.meta.pageCount !== undefined ? { pageCount: artifact.meta.pageCount } : {}),
      source: `MinerU (${cfg.mode})`,
    }
  }
}

export default EnrichmentService
