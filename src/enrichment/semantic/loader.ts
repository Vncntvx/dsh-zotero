/**
 * The per-service holder for one loaded semantic embedder.
 *
 * At most one model is resident: selecting another key or directory releases
 * the previous session before the next opens, and disposal releases whatever
 * is resident. Loading is single-flighted, so concurrent ranks share one
 * in-flight load instead of opening two WASM sessions.
 *
 * Every failure the resolver or the loader produces surfaces as
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` with the remedy in the message:
 * the caller asked for semantic ranking and the answer is "the model cannot
 * serve", never a silent lexical-only result.
 * @module dsh-zotero/enrichment/semantic/loader
 */

import { semanticModelOf, type SemanticModelEntry } from '../../enrichment-model-catalog.js'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'
import { openSemanticEmbedder } from './bundle.js'
import type { Embedder } from './session.js'

/** What the host resolves per rank call: which model, from which directory. */
export interface SemanticModelTarget {
  readonly spec: SemanticModelEntry
  readonly dir: string
}

export interface SemanticEmbedderLoaderDeps {
  /**
   * Open one embedder; defaults to the real bundle verifier + WASM session.
   * Injectable so tests never touch disk or WASM.
   */
  readonly open?: (target: SemanticModelTarget) => Promise<Embedder>
}

/** Map any loader failure onto the fail-closed semantic-unavailable error. */
function unavailable(error: unknown): ZoteroError {
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

/**
 * Resolve the model target from live enrichment config: the selected tier's
 * spec and its on-disk directory.
 * @param config - the live resolved enrichment preferences.
 * @param resolveDir - maps a physical key plus configured directory to a path.
 */
export function semanticTargetOf(
  config: { readonly semanticModel: string; readonly semanticModelDir: string },
  resolveDir: (physicalKey: string, configuredDir: string) => string,
): SemanticModelTarget {
  const spec = semanticModelOf(config.semanticModel)
  return { spec, dir: resolveDir(spec.physicalKey, config.semanticModelDir) }
}

export class SemanticEmbedderLoader {
  private current: { readonly key: string; readonly embedder: Promise<Embedder> } | undefined

  constructor(private readonly deps: SemanticEmbedderLoaderDeps = {}) {}

  /**
   * The embedder for one target, loading on first use and on target change.
   * Concurrent calls share the in-flight load; a changed target releases the
   * previous session once the new one is open.
   * @param target - which model to load, from live config.
   */
  async get(target: SemanticModelTarget): Promise<Embedder> {
    const key = `${target.spec.key}|${target.dir}`
    const current = this.current
    if (current !== undefined && current.key === key) return await current.embedder
    const open =
      this.deps.open ??
      (async (resolved) => await openSemanticEmbedder(resolved.spec, resolved.dir))
    const embedder = open(target).catch((error: unknown) => {
      // A failed load must not stay cached: the next call retries (the user
      // may have installed the bundle in between).
      if (this.current?.key === key) this.current = undefined
      throw unavailable(error)
    })
    this.current = { key, embedder }
    const loaded = await embedder
    // Release the previous resident only after the new session is open, so a
    // model switch never leaves the caller without an embedder.
    if (current !== undefined && current.key !== key) {
      void current.embedder.then((previous) => previous.dispose()).catch(() => {})
    }
    return loaded
  }

  /** Release the resident session, if any, and forget it. */
  async dispose(): Promise<void> {
    const current = this.current
    this.current = undefined
    if (current === undefined) return
    try {
      const embedder = await current.embedder
      await embedder.dispose()
    } catch {
      // A failed load has nothing to release; disposal stays quiet.
    }
  }
}
