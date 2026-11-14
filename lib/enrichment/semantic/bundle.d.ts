/**
 * On-disk verification and loading of one local model bundle.
 *
 * A bundle is trusted only after three checks against the catalog: its
 * `manifest.json` matches the catalog record exactly, every pinned file is
 * present at the pinned size, and every file hashes to the pinned SHA-256.
 * The checks run before the ONNX session opens, so a corrupted or tampered
 * bundle can never produce embeddings — it fails with
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` instead.
 * @module dsh-zotero/enrichment/semantic/bundle
 */
import { type SemanticModelEntry } from '../../enrichment-model-catalog.js';
import type { Embedder } from './session.js';
/** Filesystem seams, injectable so tests never need real model bytes. */
export interface BundleFsDeps {
    readonly readFile: (path: string) => Promise<Uint8Array>;
    readonly stat: (path: string) => Promise<{
        readonly size: number;
    }>;
    readonly hashFile: (path: string) => Promise<string>;
    /**
     * The cheap on-disk identity that decides whether a remembered hash still
     * describes the bytes. Size alone misses an in-place rewrite; inode and the
     * two timestamps are what make the reuse safe.
     */
    readonly identity?: (path: string) => Promise<{
        readonly dev: number;
        readonly ino: number;
        readonly size: number;
        readonly mtimeMs: number;
        readonly ctimeMs: number;
    }>;
}
/** The memoized verifier the loader owns; absent deps keep the plain path. */
export interface SemanticBundleVerifier {
    verify(dir: string, spec: SemanticModelEntry): Promise<void>;
}
/**
 * One verifier per owner (the semantic loader): the first load of a bundle
 * hashes every pinned file, and a later load of the same bytes reuses that
 * answer. Re-reading a 600 MB checkpoint on every model switch cost more than
 * the load itself; the inode, size and both timestamps are what make the reuse
 * safe, and an out-of-band rewrite changes them.
 * @param deps - filesystem seams.
 * @returns the memoized verifier.
 */
export declare function createBundleVerifier(deps?: BundleFsDeps): SemanticBundleVerifier;
/** Read and parse one JSON file from the bundle. */
export declare function readJsonFile(path: string): Promise<unknown>;
/**
 * Verify one bundle directory against the catalog: manifest agreement, pinned
 * sizes, pinned digests.
 * @param dir - the bundle directory.
 * @param spec - the catalog entry the bundle claims to be.
 * @param deps - filesystem seams; defaults to the host.
 */
export declare function verifySemanticBundle(dir: string, spec: SemanticModelEntry, deps?: BundleFsDeps): Promise<void>;
/**
 * Verify a bundle and open its embedder. This is the one entry the ranker's
 * loader uses; every failure mode above surfaces as
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`.
 * @param spec - the catalog entry to load.
 * @param dir - the bundle directory.
 * @param deps - filesystem seams.
 * @param verifier - the owner's memoized verifier; a plain verification when absent.
 */
export declare function openSemanticEmbedder(spec: SemanticModelEntry, dir: string, deps?: BundleFsDeps, verifier?: SemanticBundleVerifier): Promise<Embedder>;
//# sourceMappingURL=bundle.d.ts.map