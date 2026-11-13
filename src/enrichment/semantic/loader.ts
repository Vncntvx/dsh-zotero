/**
 * The per-service holder for loaded semantic embedders.
 *
 * A switch is transactional: B becomes resident only after its load succeeds,
 * and a failed B reports to B's callers while A stays managed. Resident,
 * pending, and retired instances each carry an identity, a load promise, a
 * scope count and a run count; an instance is released exactly once, after its
 * last scope and in-flight run finish. Serialized switches keep at most one
 * load in flight and bounded concurrent inference.
 *
 * Teardown closes admission, unsets the slot and lets accepted scopes drain;
 * a re-injection creates a new generation rather than reviving this loader.
 * Every failure surfaces as `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`, never a
 * silent lexical-only result.
 * @module dsh-zotero/enrichment/semantic/loader
 */

import { semanticModelOf, type SemanticModelEntry } from '../../enrichment-model-catalog.js'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'
import { resolveSemanticModelDirSafe } from '../model-dir.js'
import {
  createBundleVerifier,
  openSemanticEmbedder,
  type SemanticBundleVerifier,
} from './bundle.js'
import type { Embedder } from './session.js'

/** What the host resolves per rank call: which model, from which directory. */
export interface SemanticModelTarget {
  readonly spec: SemanticModelEntry
  readonly dir: string
  /**
   * The root exactly as the user configured it. A read validates this value
   * with the downloader's safe-directory policy before opening anything; an
   * absent value means the harness default root, which no user input reached.
   */
  readonly configuredDir?: string
}

export interface SemanticEmbedderLoaderDeps {
  /**
   * Open one embedder; defaults to the real bundle verifier + WASM session.
   * Injectable so tests never touch disk or WASM.
   */
  readonly open?: (target: SemanticModelTarget) => Promise<Embedder>
}

/** Map any loader failure onto the fail-closed semantic-unavailable error. */
export function semanticUnavailable(error: unknown): ZoteroError {
  if (error instanceof ZoteroError && error.code === ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE) {
    return error
  }
  return new ZoteroError(
    `Semantic ranking is enabled but the model cannot serve: ${
      error instanceof Error ? error.message : String(error)
    }. Download the selected model in the enrichment settings (or with npm run assets:semantic) to enable it.`,
    ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    { cause: error },
  )
}

function keyOf(target: SemanticModelTarget): string {
  return `${target.spec.key}|${target.dir}`
}

/**
 * Resolve the model target from live enrichment config: the selected tier's
 * spec and its on-disk directory.
 */
export function semanticTargetOf(
  config: { readonly semanticModel: string; readonly semanticModelDir: string },
  resolveDir: (physicalKey: string, configuredDir: string) => string,
): SemanticModelTarget {
  const spec = semanticModelOf(config.semanticModel)
  const configured = config.semanticModelDir.trim()
  return {
    spec,
    dir: resolveDir(spec.physicalKey, config.semanticModelDir),
    ...(configured === '' ? {} : { configuredDir: config.semanticModelDir }),
  }
}

/**
 * Canonicalize a target whose root the user configured. The default root is
 * the harness home path, which no user input reached, so it passes through.
 * @param target - the resolved target from live config.
 * @returns the target with its validated canonical directory.
 */
async function safeTargetOf(target: SemanticModelTarget): Promise<SemanticModelTarget> {
  const configured = target.configuredDir?.trim() ?? ''
  if (configured === '') return target
  const dir = await resolveSemanticModelDirSafe(target.spec.physicalKey, configured)
  return dir === target.dir ? target : { ...target, dir }
}

interface Managed {
  readonly id: number
  readonly key: string
  readonly target: SemanticModelTarget
  readonly load: Promise<Embedder>
  scopes: number
  running: number
  retiring: boolean
  released: boolean
}

/** One admitted foreground request; released in `finally` by the caller. */
export interface RankingScope {
  readonly release: () => void
  /** The embedder fixed for this scope, loaded on first use. */
  readonly embedder: () => Promise<Embedder>
}

export class SemanticEmbedderLoader {
  private resident: Managed | undefined
  private pending: Managed | undefined
  private readonly retired = new Set<Managed>()
  private readonly open: (target: SemanticModelTarget) => Promise<Embedder>
  /** This loader's bundle verification memo: one full hash per on-disk identity. */
  private readonly verifier: SemanticBundleVerifier = createBundleVerifier()
  private closed = false
  private generation = 0
  private nextId = 1
  /** Serialized switch queue: one load admitted at a time. */
  private switchQueue: Promise<unknown> = Promise.resolve()
  private readonly disposals = new Set<Promise<void>>()

  constructor(deps: SemanticEmbedderLoaderDeps = {}) {
    this.open =
      deps.open ??
      (async (target) =>
        await openSemanticEmbedder(target.spec, target.dir, undefined, this.verifier))
  }

  /**
   * Admit one foreground scope for a target. The scope keeps its own instance
   * alive until released, even if the component is unmounted in between; the
   * target and service generation are fixed at admission.
   */
  scope(target: SemanticModelTarget): RankingScope {
    if (this.closed) throw semanticUnavailable(new Error('the semantic loader is closed'))
    const key = keyOf(target)
    let managed =
      this.resident?.key === key && !this.resident.retiring && !this.resident.released
        ? this.resident
        : this.pending?.key === key && !this.pending.retiring && !this.pending.released
          ? this.pending
          : undefined
    if (managed === undefined) {
      managed = this.beginLoad(target)
    }
    managed.scopes += 1
    let released = false
    const held = managed
    return {
      release: () => {
        if (released) return
        released = true
        held.scopes -= 1
        this.maybeRelease(held)
      },
      embedder: async () => {
        held.running += 1
        try {
          return await held.load
        } finally {
          held.running -= 1
          this.maybeRelease(held)
        }
      },
    }
  }

  /** Single-call entry; equivalent to a scope used once. */
  async get(target: SemanticModelTarget): Promise<Embedder> {
    const admitted = this.scope(target)
    try {
      return await admitted.embedder()
    } finally {
      admitted.release()
    }
  }

  /**
   * Retire the resident instance for one target: the next scope opens a fresh
   * one from disk, and the scopes already admitted keep this one alive until
   * they release. Deleting a model's files uses this, so a deleted bundle
   * cannot keep serving from memory — the settings page and the docs both say
   * the model is unavailable until it is downloaded again.
   * @param target - the model target whose instance is no longer wanted.
   */
  retire(target: SemanticModelTarget): void {
    const key = keyOf(target)
    const candidates: Managed[] = []
    if (this.resident?.key === key) candidates.push(this.resident)
    if (this.pending?.key === key) candidates.push(this.pending)
    for (const managed of candidates) {
      managed.retiring = true
      this.retired.add(managed)
      this.maybeRelease(managed)
    }
    if (this.pending?.key === key) this.pending = undefined
    if (this.resident?.key === key) this.resident = undefined
  }

  private beginLoad(target: SemanticModelTarget): Managed {
    const id = this.nextId++
    const key = keyOf(target)
    // The open call starts only after any previous switch has settled.
    const load = this.switchQueue.then(async () => {
      if (this.closed) throw semanticUnavailable(new Error('the semantic loader is closed'))
      // A user-configured root is validated with the same policy the downloader
      // applies, so an unvalidated alias or `..` never reaches the reader.
      const resolved = await safeTargetOf(target).catch((error: unknown) => {
        throw semanticUnavailable(error)
      })
      return this.open(resolved).catch((error: unknown) => {
        throw semanticUnavailable(error)
      })
    })
    const managed: Managed = {
      id,
      key,
      target,
      load,
      scopes: 0,
      running: 0,
      retiring: false,
      released: false,
    }
    this.pending = managed
    // Commit B as resident only on success; a failure keeps A and reports to B.
    void load
      .then(() => {
        if (this.closed || managed.retiring || managed.released) {
          // Teardown closed admission or a deletion retired this instance while
          // the load was in flight. An already accepted scope still awaits
          // `managed.load` and receives this embedder, so the instance must stay
          // alive until that scope and its runs finish: mark it retiring and
          // let `maybeRelease` decide. A direct `embedder.dispose()` here handed
          // accepted callers a released ONNX session; promoting it to resident
          // would hand it to scopes admitted after the deletion instead.
          managed.retiring = true
          this.retired.add(managed)
          this.maybeRelease(managed)
          return
        }
        const previous = this.resident
        if (this.pending === managed) this.pending = undefined
        this.resident = managed
        if (previous !== undefined && previous !== managed) {
          previous.retiring = true
          this.retired.add(previous)
          this.maybeRelease(previous)
        }
      })
      .catch(() => {
        // A failed load never becomes resident. A stays managed; B's own
        // callers already have the rejection from `managed.load`.
        if (this.pending === managed) this.pending = undefined
        managed.retiring = true
        this.retired.add(managed)
        this.maybeRelease(managed)
      })
    this.switchQueue = load.catch(() => undefined)
    return managed
  }

  private maybeRelease(managed: Managed): void {
    if (
      managed.released ||
      managed.scopes > 0 ||
      managed.running > 0 ||
      (managed === this.resident && !managed.retiring && !this.closed) ||
      (managed === this.pending && !managed.retiring)
    )
      return
    managed.released = true
    this.retired.delete(managed)
    const disposal = managed.load
      .then((embedder) => embedder.dispose())
      .catch(() => undefined)
      .finally(() => {
        if (this.resident === managed) this.resident = undefined
        if (this.pending === managed) this.pending = undefined
      })
    this.disposals.add(disposal)
    void disposal.finally(() => this.disposals.delete(disposal))
  }

  /** Unset the slot, close admission and let accepted scopes drain. */
  async dispose(): Promise<void> {
    this.closed = true
    this.generation += 1
    const all = new Set<Managed>()
    if (this.resident !== undefined) all.add(this.resident)
    if (this.pending !== undefined) all.add(this.pending)
    for (const managed of this.retired) all.add(managed)
    for (const managed of all) managed.retiring = true
    // Wait for the actual loads/runs to settle. Accepted scopes are NOT
    // force-released here: they drain on their own `release()` and keep their
    // fixed model alive for the rest of the original request.
    await Promise.allSettled([...all].map((managed) => managed.load))
    for (const managed of all) this.maybeRelease(managed)
    // Wait for the one-time dispose calls that were actually started.
    await Promise.allSettled([...this.disposals])
    this.resident = undefined
    this.pending = undefined
    this.retired.clear()
  }
}
