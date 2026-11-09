/**
 * Cordis Service plugin providing `ctx.parsing`.
 *
 * The component's presence is the authorization to contact MinerU; it
 * registers no model tools, no prompt section, and no skill. It feeds the
 * existing read tools through one optional slot in the core service — a
 * `FulltextEnhancer` — so mounting/unmounting the row is the only switch that
 * changes whether external requests can happen.
 *
 * **Dependency direction.** parsing → core. The core defines the pure
 * `FulltextEnhancer` type and holds an optional slot; parsing imports that
 * type and installs itself. The core never imports `src/parsing/**`, owns no
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
 * **Failure classification.** Credential resolution and an unusable output
 * directory are `fatal`: the read cannot be served as promised and the
 * configuration must be fixed. Task failures, corrupt archives, oversized or
 * non-PDF inputs, and a declined egress authorization are `fallback`: the
 * caller keeps its local extraction, and the reason names the code. The output
 * directory is resolved before any document bytes are obtained, so a
 * misconfiguration never uploads a file before failing.
 * @module dsh-zotero/parsing/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
import {
  errorMessageOf,
  ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
  ZOTERO_PARSING_OUTPUT_INVALID,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../errors.js'
import {
  FULLTEXT_ENHANCER_MIN_TEXT_CHARS,
  hasEnoughParsedText,
  isPdfContentType,
  type FulltextEnhancer,
  type FulltextEnhancerInput,
  type FulltextEnhancerOutcome,
  type FulltextLookupResult,
  type FulltextSourceStamp,
} from '../local/fulltext-enhancer.js'
import { ParsingConfigSchema, resolveParsingConfig, type ParsingConfig } from './config.js'
import { resolveMineruToken } from './credentials.js'
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
import { cacheKeyOf, ParseFlight, parseOnce } from './parse-once.js'
import { parsedIdentityOf } from './identity.js'
import { sourceKeyOf } from './source-stamp.js'
import { limitsFor } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    parsing: ParsingService
  }
}

/** Core service face parsing needs: the enhancer slot and attachment resolver. */
interface ParsingCoreLink {
  setFulltextEnhancer(enhancer: FulltextEnhancer | undefined): void
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
export interface ParsingServiceDeps {
  readonly client?: MineruClient
  readonly parse?: typeof parseOnce
  readonly store?: () => Promise<ParsedArtifactStore>
  readonly flight?: ParseFlight
}

/** A ZoteroError with its code preserved, so diagnostics and callers can route. */
function fallbackReasonOf(error: unknown): string {
  return error instanceof ZoteroError ? `${error.code}: ${error.message}` : errorMessageOf(error)
}

function fatalOf(error: unknown): { readonly kind: 'fatal'; readonly error: Error } {
  return { kind: 'fatal', error: error instanceof Error ? error : new Error(String(error)) }
}

export class ParsingService extends Service {
  static readonly Config = ParsingConfigSchema

  private readonly client: MineruClient
  private readonly parse: typeof parseOnce
  private readonly storeFactory: () => Promise<ParsedArtifactStore>
  private readonly flight: ParseFlight
  private readonly resolveAttachment: SourceBytesDeps['resolveAttachment']

  /** The enhancer installed into the core. Stable identity for cleanup. */
  public readonly enhancer: FulltextEnhancer

  constructor(
    ctx: Context,
    public config: ParsingConfig = {},
    deps: ParsingServiceDeps = {},
  ) {
    super(ctx, 'parsing')
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
      const core = ctx.get('zotero') as ParsingCoreLink | undefined
      if (core === undefined) {
        throw new ZoteroError(
          'The Zotero service is not composed; a local attachment cannot be resolved.',
          ZOTERO_PROVIDER_UNAVAILABLE,
        )
      }
      return await core.resolveAttachment(ref, signal)
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

    // Install the enhancer into the core, and withdraw it on disposal. The
    // injected effect is fiber-scoped, so unmounting the row clears the slot.
    ctx.inject(['zotero'], (scoped) => {
      const zotero = scoped.zotero as unknown as ParsingCoreLink
      zotero.setFulltextEnhancer(this.enhancer)
      scoped.effect(() => () => zotero.setFulltextEnhancer(undefined))
    })
  }

  /** Resolve the output directory for the current config value. */
  private async store(): Promise<ParsedArtifactStore> {
    const dir = await resolveOutputDir(resolveParsingConfig(this.config).outputDir)
    return new ParsedArtifactStore(dir)
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
      cfg = resolveParsingConfig(this.config)
    } catch (error) {
      return { outcome: fatalOf(error) }
    }
    if (!isPdfContentType(input.contentType)) return {}

    try {
      const store = await this.storeFactory()
      const maxBytes = limitsFor(cfg.mode).maxBytes
      const stamp =
        input.sourceStamp ??
        (await probeSource(
          input,
          maxBytes,
          hostSourceBytesDeps(this.resolveAttachment, this.client),
          signal,
        ))
      const artifact = await store.lookupSource(sourceKeyOf(input.key, cfg.mode), stamp)
      if (artifact === undefined) return { stamp }
      return { outcome: this.outcomeOf(artifact, cfg), stamp }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof ZoteroError && error.code === ZOTERO_PARSING_OUTPUT_INVALID) {
        return { outcome: fatalOf(error) }
      }
      return {}
    }
  }

  /**
   * Produce higher-quality full text for one PDF, or an explicit fallback.
   * Credential/output-configuration failures are `fatal`; runtime failures and
   * a declined egress authorization are `fallback` with a coded reason.
   */
  private async enhance(
    input: FulltextEnhancerInput,
    signal?: AbortSignal,
  ): Promise<FulltextEnhancerOutcome> {
    let cfg
    try {
      cfg = resolveParsingConfig(this.config)
    } catch (error) {
      return fatalOf(error)
    }

    if (!isPdfContentType(input.contentType)) {
      return { kind: 'fallback', reason: 'only PDF attachments are eligible for MinerU parsing' }
    }

    // The output directory is a configuration fact: resolve it before any
    // document bytes are read or sent, so a bad path never uploads a file.
    let store: ParsedArtifactStore
    try {
      store = await this.storeFactory()
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof ZoteroError && error.code === ZOTERO_PARSING_OUTPUT_INVALID) {
        return fatalOf(error)
      }
      return { kind: 'fallback', reason: fallbackReasonOf(error) }
    }

    const maxBytes = limitsFor(cfg.mode).maxBytes
    const sourceKey = sourceKeyOf(input.key, cfg.mode)
    const byteDeps = hostSourceBytesDeps(this.resolveAttachment, this.client)

    let stamp: FulltextSourceStamp | undefined
    try {
      stamp = input.sourceStamp ?? (await probeSource(input, maxBytes, byteDeps, signal))
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      // A probe failure is not authoritative; the full read below will report
      // the real reason (and a missing attachment falls back like any other).
    }
    if (stamp !== undefined) {
      const cached = await store.lookupSource(sourceKey, stamp).catch(() => undefined)
      if (cached !== undefined) return this.outcomeOf(cached, cfg)
    }

    if (!cfg.allowParsingUpload) {
      return {
        kind: 'fallback',
        reason: 'data-egress authorization (allowParsingUpload) is off; no bytes were sent',
      }
    }

    // Token is read only in pro mode. Free mode never touches it, which is what
    // lets a configured token coexist with a deliberate free-mode choice. A
    // cache hit above already returned, so a cached pro artifact needs no token.
    let token: string | undefined
    if (cfg.mode === 'pro') {
      const ref = cfg.mineruTokenRef.trim()
      if (ref === '') {
        return fatalOf(
          new ZoteroError(
            'Pro mode is selected but no MinerU token reference is configured. Set one, or switch the mode back to free.',
            ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
          ),
        )
      }
      try {
        token = await resolveMineruToken(this.ctx, ref)
      } catch (error) {
        return fatalOf(error)
      }
    }

    try {
      const source = await obtainSourceBytes(input, maxBytes, byteDeps, signal)
      const artifact = await this.parse(
        {
          identity: input.key,
          metaIdentity: parsedIdentityOf(input.key),
          mode: cfg.mode,
          bytes: source.bytes,
          ...(token !== undefined ? { token } : {}),
          ...(signal !== undefined ? { signal } : {}),
        },
        { client: this.client, store, flight: this.flight },
      )
      await store
        .putSource(sourceKey, {
          version: 1,
          cacheKey: cacheKeyOf({ identity: input.key, mode: cfg.mode, bytes: source.bytes }),
          fingerprint: artifact.meta.contentFingerprint,
          stamp: source.stamp,
        })
        .catch(() => {})
      return this.outcomeOf(artifact, cfg)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (
        error instanceof ZoteroError &&
        (error.code === ZOTERO_PARSING_OUTPUT_INVALID ||
          error.code === ZOTERO_PARSING_CREDENTIAL_UNRESOLVED)
      ) {
        return fatalOf(error)
      }
      return { kind: 'fallback', reason: fallbackReasonOf(error) }
    }
  }

  /** Turn one artifact into the enhancer's answer, refusing untrustworthy text. */
  private outcomeOf(
    artifact: Awaited<ReturnType<typeof parseOnce>>,
    cfg: ReturnType<typeof resolveParsingConfig>,
  ): FulltextEnhancerOutcome {
    if (!hasEnoughParsedText(artifact.markdown)) {
      return {
        kind: 'fallback',
        reason: `MinerU parsed only ${artifact.markdown.trim().length} characters, below the ${FULLTEXT_ENHANCER_MIN_TEXT_CHARS}-character threshold`,
      }
    }
    return {
      kind: 'ok',
      text: artifact.markdown,
      ...(artifact.meta.pageCount !== undefined ? { pageCount: artifact.meta.pageCount } : {}),
      source: `MinerU (${cfg.mode})`,
    }
  }
}

export default ParsingService
