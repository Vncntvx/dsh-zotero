/**
 * Resolves the directory where local semantic models are stored.
 *
 * Models default to ~/.dsh/models (`dshHomePath('models')`), outside the plugin
 * source tree and package bundle. A custom path expands ~ to the user's home
 * directory. Files are stored under their physical model key (e.g.
 * `qwen3-0.6b`); semantic tier keys (e.g. `balanced`) map to them without disk
 * migration.
 * @module dsh-zotero/enrichment/model-dir
 */
import { type SafeDirectoryDeps } from './safe-directory.js';
/**
 * Resolve the root directory for semantic models on disk.
 * Empty or whitespace-only input falls back to `dshHomePath('models')` (~/.dsh/models).
 */
export declare function resolveSemanticModelRoot(configuredDir?: string): string;
/**
 * Resolve the directory for a specific model key on disk.
 * Stable semantic keys (e.g. `balanced`) resolve to their backing physical model directory.
 */
export declare function resolveSemanticModelDir(modelKey: string, configuredDir?: string): string;
/**
 * Resolve a model directory through the same validated policy the downloader
 * applies, so the ranking read path and the install/delete path judge one
 * configured root by one rule: realpath, sensitive-directory refusal, and a
 * permitted missing suffix for a model that is simply not installed.
 * @param physicalKey - the catalog's physical model key.
 * @param configuredDir - the configured root as the user typed it.
 * @param deps - injectable filesystem seams.
 * @returns the safe canonical model directory.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED` for an unsafe path.
 */
export declare function resolveSemanticModelDirSafe(physicalKey: string, configuredDir: string | undefined, deps?: SafeDirectoryDeps): Promise<string>;
//# sourceMappingURL=model-dir.d.ts.map