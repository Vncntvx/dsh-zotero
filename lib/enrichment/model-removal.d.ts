/**
 * Remove one installed model bundle.
 *
 * Removal uses the installer's cross-process writer lock and its catalog-only
 * ownership rule: the commit marker and pinned files are removed, while files
 * outside the catalog stay in place. Every parent directory of a pinned path
 * must be a real directory, so a planted symlink cannot redirect an unlink
 * outside the bundle. Empty catalog directories are pruned after their files.
 * @module dsh-zotero/enrichment/model-removal
 */
import { HarnessError } from '@deepseek-ai/dsh-error';
import type { SemanticModelManifest } from '../enrichment-model-catalog.js';
/**
 * The machine code every removal failure carries. A removal reaches a caller
 * as the `cause` of a `ZoteroError`, so this code never enters the Zotero
 * vocabulary; it is a `HarnessError` code so a direct caller can still route on
 * `name`/`code` instead of parsing the message.
 */
export declare const MODEL_REMOVAL_FAILED = "MODEL_REMOVAL_FAILED";
export declare class ModelRemovalError extends HarnessError {
    constructor(message: string, options?: {
        readonly cause?: unknown;
    });
}
export interface RemoveModelBundleOptions {
    /** Canonical `<root>/<physicalKey>` directory. */
    readonly dir: string;
    readonly expected: SemanticModelManifest;
    readonly signal?: AbortSignal;
}
export interface RemoveModelBundleResult {
    readonly removed: boolean;
    readonly removedFiles: number;
    readonly removedBytes: number;
}
/**
 * Delete the marker and every pinned file, preserving unknown files.
 * @param options - the bundle directory, its catalog record, and an abort signal.
 * @returns what was removed; a missing root or bundle is a successful no-op.
 */
export declare function removeModelBundle(options: RemoveModelBundleOptions): Promise<RemoveModelBundleResult>;
//# sourceMappingURL=model-removal.d.ts.map