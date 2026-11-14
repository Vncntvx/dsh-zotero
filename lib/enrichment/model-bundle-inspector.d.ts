/**
 * Dependency-free inspection of one installed model bundle.
 *
 * The host status/verify endpoints, the installer, and the CLI all judge a
 * bundle with this one rule: the commit marker must equal the catalog record
 * exactly, every pinned path must be a regular file (never a symlink) at its
 * pinned size, and a successful SHA-256 check must belong to the same file
 * identity snapshot now on disk. A same-size mutation therefore invalidates
 * readiness without a second hash on every poll.
 *
 * This module imports only Node built-ins and types, so Node's native
 * TypeScript stripping can load it from `scripts/fetch-semantic-model.mjs`
 * without pulling the ONNX runtime or tokenizer into the CLI process.
 * @module dsh-zotero/enrichment/model-bundle-inspector
 */
import type { SemanticModelManifest } from '../enrichment-model-catalog.js';
import type { BundleInspection, BundleSnapshot, ModelBundleInspectorPort, ModelBundleTarget } from './model-installation.js';
export interface BundleInspectorOptions {
    /** Skip the coalescing cache and hash every pinned file. */
    readonly forceHash?: boolean;
    readonly signal?: AbortSignal;
}
export interface BundleInspector extends ModelBundleInspectorPort {
    readonly inspect: (target: ModelBundleTarget, options?: BundleInspectorOptions) => Promise<BundleInspection>;
    readonly snapshot: (target: ModelBundleTarget, options?: {
        readonly signal?: AbortSignal;
    }) => Promise<BundleSnapshot>;
}
/** One inspector instance owns the coalescing cache for its bundle directory. */
export declare function createBundleInspector(): BundleInspector;
/** Read-only status: a missing root is a normal miss, never a write. */
export declare function inspectInstalledBundle(dir: string, expected: SemanticModelManifest, options?: BundleInspectorOptions): Promise<BundleInspection>;
//# sourceMappingURL=model-bundle-inspector.d.ts.map