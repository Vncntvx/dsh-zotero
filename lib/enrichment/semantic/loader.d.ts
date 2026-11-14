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
import { type SemanticModelEntry } from '../../enrichment-model-catalog.js';
import { ZoteroError } from '../../errors.js';
import type { Embedder } from './session.js';
/** What the host resolves per rank call: which model, from which directory. */
export interface SemanticModelTarget {
    readonly spec: SemanticModelEntry;
    readonly dir: string;
    /**
     * The root exactly as the user configured it. A read validates this value
     * with the downloader's safe-directory policy before opening anything; an
     * absent value means the harness default root, which no user input reached.
     */
    readonly configuredDir?: string;
}
export interface SemanticEmbedderLoaderDeps {
    /**
     * Open one embedder; defaults to the real bundle verifier + WASM session.
     * Injectable so tests never touch disk or WASM.
     */
    readonly open?: (target: SemanticModelTarget) => Promise<Embedder>;
}
/** Map any loader failure onto the fail-closed semantic-unavailable error. */
export declare function semanticUnavailable(error: unknown): ZoteroError;
/**
 * Resolve the model target from live enrichment config: the selected tier's
 * spec and its on-disk directory.
 */
export declare function semanticTargetOf(config: {
    readonly semanticModel: string;
    readonly semanticModelDir: string;
}, resolveDir: (physicalKey: string, configuredDir: string) => string): SemanticModelTarget;
/** One admitted foreground request; released in `finally` by the caller. */
export interface RankingScope {
    readonly release: () => void;
    /** The embedder fixed for this scope, loaded on first use. */
    readonly embedder: () => Promise<Embedder>;
}
export declare class SemanticEmbedderLoader {
    private resident;
    private pending;
    private readonly retired;
    private readonly open;
    /** This loader's bundle verification memo: one full hash per on-disk identity. */
    private readonly verifier;
    private closed;
    private generation;
    private nextId;
    /** Serialized switch queue: one load admitted at a time. */
    private switchQueue;
    private readonly disposals;
    constructor(deps?: SemanticEmbedderLoaderDeps);
    /**
     * Admit one foreground scope for a target. The scope keeps its own instance
     * alive until released, even if the component is unmounted in between; the
     * target and service generation are fixed at admission.
     */
    scope(target: SemanticModelTarget): RankingScope;
    /** Single-call entry; equivalent to a scope used once. */
    get(target: SemanticModelTarget): Promise<Embedder>;
    /**
     * Retire the resident instance for one target: the next scope opens a fresh
     * one from disk, and the scopes already admitted keep this one alive until
     * they release. Deleting a model's files uses this, so a deleted bundle
     * cannot keep serving from memory — the settings page and the docs both say
     * the model is unavailable until it is downloaded again.
     * @param target - the model target whose instance is no longer wanted.
     */
    retire(target: SemanticModelTarget): void;
    private beginLoad;
    private maybeRelease;
    /** Unset the slot, close admission and let accepted scopes drain. */
    dispose(): Promise<void>;
}
//# sourceMappingURL=loader.d.ts.map