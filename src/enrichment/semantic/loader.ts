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

import { resolve } from 'node:path'
import {
  manifestOf,
  semanticModelOf,
  type SemanticModelEntry,
} from '../../enrichment-model-catalog.js'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'
import { resolveSemanticModelDirSafe } from '../model-dir.js'
import { openWorkerEmbedder } from './worker-embedder.js'
import type { Embedder } from './session.js'
import { awaitSharedWaiter } from '../../race-signal.js'
import { createBundleInspector } from '../model-bundle-inspector.js'
import { catalogFingerprintOf } from '../model-manifest.js'
import type { ModelBundleInspectorPort } from '../model-installation.js'
import { SemanticBundleFailure } from './bundle-failure.js'

const BUNDLE_FAILURE_LIMIT = 16

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

interface SemanticEmbedderLoaderDeps {
  /**
   * Open one embedder; defaults to the isolated verifier + WASM worker.
   * Injectable so tests never touch disk or WASM.
   */
  readonly open?: (target: SemanticModelTarget, signal: AbortSignal) => Promise<Embedder>
  readonly inspector?: Pick<ModelBundleInspectorPort, 'snapshot'>
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
  readonly controller: AbortController
  instance?: Embedder
  scopes: number
  running: number
  retiring: boolean
  released: boolean
}

/** One admitted foreground request; released in `finally` by the caller. */
export interface RankingScope {
  readonly release: () => void
  /** The embedder fixed for this scope, loaded on first use. */
  readonly embedder: (signal?: AbortSignal) => Promise<Embedder>
}

export class SemanticEmbedderLoader {
  private resident: Managed | undefined
  private readonly pending = new Map<string, Managed>()
  private readonly owned = new Set<Managed>()
  private readonly inspector: Pick<ModelBundleInspectorPort, 'snapshot'>
  private readonly bundleFailures = new Map<
    string,
    { key: string; failure: SemanticBundleFailure }
  >()
  private readonly open: (target: SemanticModelTarget, signal: AbortSignal) => Promise<Embedder>
  private closed = false
  private nextId = 1
  /** The latched one-time close; every `dispose()` call awaits this. */
  private disposal: Promise<void> | undefined
  /** Serialized switch queue: one load admitted at a time. */
  private switchQueue: Promise<unknown> = Promise.resolve()
  private readonly disposals = new Set<Promise<void>>()

  constructor(deps: SemanticEmbedderLoaderDeps = {}) {
    this.inspector = deps.inspector ?? createBundleInspector()
    this.open =
      deps.open ??
      (async (target, signal) =>
        await openWorkerEmbedder(target.spec, target.dir, undefined, signal))
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
      this.resident?.key === key &&
      !this.resident.retiring &&
      !this.resident.released &&
      this.resident.instance?.unavailable !== true
        ? this.resident
        : this.pending.get(key)
    if (managed === undefined) {
      managed = this.beginLoad(target)
    }
    managed.scopes += 1
    let released = false
    let borrowed: Embedder | undefined
    const held = managed
    const release = (): void => {
      if (released) return
      released = true
      held.scopes -= 1
      this.maybeRelease(held)
    }
    const assertHeld = (): void => {
      if (released) throw semanticUnavailable(new Error('the ranking scope has been released'))
    }
    const borrow = (instance: Embedder, assertHeld: () => void, release: () => void): Embedder => ({
      dimension: instance.dimension,
      retain: () => {
        assertHeld()
        held.scopes += 1
        let released = false
        return borrow(
          instance,
          () => {
            if (released)
              throw semanticUnavailable(new Error('the inference lease has been released'))
          },
          () => {
            if (released) return
            released = true
            held.scopes -= 1
            this.maybeRelease(held)
          },
        )
      },
      embed: async (texts, side, signal) => {
        assertHeld()
        held.running += 1
        try {
          return await instance.embed(texts, side, signal)
        } finally {
          held.running -= 1
          this.maybeRelease(held)
        }
      },
      dispose: async () => release(),
    })
    return {
      release,
      embedder: async (signal) => {
        assertHeld()
        const instance = await awaitSharedWaiter(held.load, signal)
        assertHeld()
        borrowed ??= borrow(instance, assertHeld, release)
        return borrowed
      },
    }
  }

  /** Acquire an owned lease. The caller releases it with `embedder.dispose()`. */
  async get(target: SemanticModelTarget, signal?: AbortSignal): Promise<Embedder> {
    const admitted = this.scope(target)
    try {
      return await admitted.embedder(signal)
    } catch (error) {
      admitted.release()
      throw error
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
    for (const [id, entry] of this.bundleFailures)
      if (entry.key === key) this.bundleFailures.delete(id)
    for (const managed of this.owned) {
      if (managed.key !== key) continue
      managed.retiring = true
      this.maybeRelease(managed)
    }
    this.pending.delete(key)
    if (this.resident?.key === key) this.resident = undefined
  }

  forgetBundleFailures(dir: string): void {
    const canonical = resolve(dir)
    for (const [id, entry] of this.bundleFailures)
      if (entry.failure.snapshot.dir === canonical) this.bundleFailures.delete(id)
  }

  private beginLoad(target: SemanticModelTarget): Managed {
    const id = this.nextId++
    const key = keyOf(target)
    const controller = new AbortController()
    // The open call starts only after any previous switch has settled. A load
    // that was admitted before teardown still runs: the scope waiting on it
    // was accepted while the component lived, and the loader's contract is
    // that accepted scopes drain with their fixed model. Teardown closes
    // admission (see `scope`), not the work already admitted.
    const load = this.switchQueue.then(async () => {
      controller.signal.throwIfAborted()
      // A user-configured root is validated with the same policy the downloader
      // applies, so an unvalidated alias or `..` never reaches the reader.
      const resolved = await safeTargetOf(target).catch((error: unknown) => {
        throw semanticUnavailable(error)
      })
      controller.signal.throwIfAborted()
      const { signal } = controller
      const dir = resolve(resolved.dir)
      const expected = manifestOf(resolved.spec)
      const catalog = catalogFingerprintOf(expected)
      const bundleKey = JSON.stringify([dir, catalog])
      try {
        const previous = this.bundleFailures.get(bundleKey)?.failure
        if (previous !== undefined) {
          const snapshot = await this.inspector.snapshot({ dir, expected }, { signal })
          signal.throwIfAborted()
          if (
            snapshot.catalogFingerprint === catalog &&
            snapshot.identityFingerprint === previous.snapshot.identityFingerprint &&
            this.bundleFailures.get(bundleKey)?.failure === previous
          )
            throw previous
          this.bundleFailures.delete(bundleKey)
        }
        return await this.open(resolved, signal)
      } catch (error) {
        if (
          error instanceof SemanticBundleFailure &&
          !signal.aborted &&
          !this.closed &&
          this.pending.get(key)?.id === id &&
          error.snapshot.dir === dir &&
          error.snapshot.catalogFingerprint === catalog
        ) {
          this.bundleFailures.delete(bundleKey)
          if (this.bundleFailures.size >= BUNDLE_FAILURE_LIMIT)
            this.bundleFailures.delete(this.bundleFailures.keys().next().value!)
          this.bundleFailures.set(bundleKey, { key, failure: error })
        }
        throw semanticUnavailable(error)
      }
    })
    const managed: Managed = {
      id,
      key,
      target,
      load,
      controller,
      scopes: 0,
      running: 0,
      retiring: false,
      released: false,
    }
    this.pending.set(key, managed)
    this.owned.add(managed)
    // Commit B as resident only on success; a failure keeps A and reports to B.
    void load
      .then((instance) => {
        managed.instance = instance
        if (this.closed || managed.retiring || managed.released) {
          // Teardown closed admission or a deletion retired this instance while
          // the load was in flight. An already accepted scope still awaits
          // `managed.load` and receives this embedder, so the instance must stay
          // alive until that scope and its runs finish: mark it retiring and
          // let `maybeRelease` decide. A direct `embedder.dispose()` here handed
          // accepted callers a released ONNX session; promoting it to resident
          // would hand it to scopes admitted after the deletion instead.
          managed.retiring = true
          this.maybeRelease(managed)
          return
        }
        const previous = this.resident
        if (this.pending.get(managed.key) === managed) this.pending.delete(managed.key)
        this.resident = managed
        if (previous !== undefined && previous !== managed) {
          previous.retiring = true
          this.maybeRelease(previous)
        }
      })
      .catch(() => {
        // A failed load never becomes resident. A stays managed; B's own
        // callers already have the rejection from `managed.load`.
        if (this.pending.get(managed.key) === managed) this.pending.delete(managed.key)
        managed.retiring = true
        this.maybeRelease(managed)
      })
    this.switchQueue = load.catch(() => undefined)
    return managed
  }

  private maybeRelease(managed: Managed): void {
    if (
      managed.scopes === 0 &&
      managed.running === 0 &&
      this.pending.get(managed.key) === managed &&
      managed.instance === undefined
    ) {
      managed.retiring = true
      managed.controller.abort(new Error('No ranking scope retains this model opening'))
      this.pending.delete(managed.key)
    }
    if (
      managed.released ||
      managed.scopes > 0 ||
      managed.running > 0 ||
      (managed === this.resident && !managed.retiring && !this.closed) ||
      (this.pending.get(managed.key) === managed && !managed.retiring)
    )
      return
    managed.released = true
    const disposal = managed.load
      .then((embedder) => embedder.dispose())
      .catch(() => undefined)
      .finally(() => {
        this.owned.delete(managed)
        if (this.resident === managed) this.resident = undefined
        if (this.pending.get(managed.key) === managed) this.pending.delete(managed.key)
      })
    this.disposals.add(disposal)
    void disposal.finally(() => this.disposals.delete(disposal))
  }

  /**
   * Unset the slot, close admission and let accepted scopes drain.
   *
   * The disposal is latched: `dispose()` may be reached from a switch (the
   * previous instance), from the component teardown, and from a re-injection
   * of the zotero slot; all of them await the same one-time close, so an
   * embedder session is never disposed twice or left half-closed.
   */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    this.bundleFailures.clear()
    const all = new Set(this.owned)
    for (const managed of all) {
      managed.retiring = true
      this.maybeRelease(managed)
    }
    // Wait for the actual loads/runs to settle. Accepted scopes are NOT
    // force-released here: they drain on their own `release()` and keep their
    // fixed model alive for the rest of the original request.
    await Promise.allSettled([...all].map((managed) => managed.load))
    for (const managed of all) this.maybeRelease(managed)
    // Wait for the one-time dispose calls that were actually started.
    await Promise.allSettled([...this.disposals])
    this.resident = undefined
    this.pending.clear()
  }
}
