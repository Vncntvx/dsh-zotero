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
import { join } from 'node:path';
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths';
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../errors.js';
import { isSemanticModelKey, semanticModelOf } from '../enrichment-model-catalog.js';
import { resolveSafeDirectory } from './safe-directory.js';
/**
 * Resolve the root directory for semantic models on disk.
 * Empty or whitespace-only input falls back to `dshHomePath('models')` (~/.dsh/models).
 */
export function resolveSemanticModelRoot(configuredDir) {
    const trimmed = configuredDir?.trim();
    if (!trimmed) {
        return dshHomePath('models');
    }
    return expandHomePath(trimmed);
}
/**
 * Resolve the directory for a specific model key on disk.
 * Stable semantic keys (e.g. `balanced`) resolve to their backing physical model directory.
 */
export function resolveSemanticModelDir(modelKey, configuredDir) {
    const subDir = isSemanticModelKey(modelKey) ? semanticModelOf(modelKey).physicalKey : modelKey;
    return join(resolveSemanticModelRoot(configuredDir), subDir);
}
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
export async function resolveSemanticModelDirSafe(physicalKey, configuredDir, deps) {
    const root = await resolveSafeDirectory({
        configured: configuredDir ?? '',
        defaultRoot: dshHomePath('models'),
        create: false,
        readOnly: true,
        allowMissing: true,
        errorCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
        label: 'semantic model directory',
        deps,
    });
    return join(root, physicalKey);
}
//# sourceMappingURL=model-dir.js.map