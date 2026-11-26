/**
 * The packaged ONNX runtime seam for local semantic ranking.
 *
 * `onnxruntime-web` cannot be a dependency of this plugin: it drags
 * `protobufjs`, whose `postinstall` is a no-op, and pnpm 11 fails an install
 * while any dependency script has no decision — so depending on it would make
 * installing the plugin fail everywhere until the profile recorded a build
 * approval. The publish path instead vendors the three artifacts the Node entry
 * needs into `assets/onnxruntime/<version>/` (`scripts/vendor-onnxruntime.mjs`),
 * and this module loads them from the package by absolute URL with the wasm
 * loader pointed at the same directory. `onnxruntime-common`, the only bare
 * import left in the vendored entry, stays a normal dependency: it declares no
 * install script and has no dependencies of its own.
 *
 * A package missing those files is broken. The loader reports that with the
 * fail-closed semantic error rather than a bare resolution failure, and
 * `npm run verify:pack` refuses to publish such a tarball.
 * @module dsh-zotero/enrichment/semantic/runtime
 */
/** The version the model catalog was verified against and the assets pin. */
export declare const SEMANTIC_RUNTIME_VERSION = "1.31.1";
/** Every file the vendored entry needs beside it. */
export declare const SEMANTIC_RUNTIME_FILES: readonly string[];
/** The module namespace the semantic session uses, defined by the installed shared ONNX contract. */
export type SemanticRuntime = typeof import('onnxruntime-common');
type RuntimeLoader = (url: string) => Promise<SemanticRuntime>;
/**
 * Absolute directory of the packaged runtime. The relative walk is three levels
 * up from both `src/enrichment/semantic/` (tests) and `lib/enrichment/semantic/`
 * (the installed package), so one expression serves both trees.
 * @param version - the pinned runtime version.
 */
export declare function semanticRuntimeDir(version?: string): string;
/**
 * Load the packaged runtime. Node caches the module after the first import, and
 * the env applied here is process-wide, so applying it again is idempotent.
 * @param dir - the packaged runtime directory; injectable for tests.
 * @param load - the module importer; injectable so a test can avoid the real one.
 */
export declare function loadSemanticRuntime(dir?: string, load?: RuntimeLoader): Promise<SemanticRuntime>;
export {};
//# sourceMappingURL=runtime.d.ts.map