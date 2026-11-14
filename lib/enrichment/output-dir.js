/**
 * Resolve the parsed-artifact root. Active callers retain the default creation
 * policy; cache lookup requests a safe canonical root without creating it or
 * requiring write access. Directory checks are shared with semantic models.
 * @module dsh-zotero/enrichment/output-dir
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ZOTERO_ENRICHMENT_OUTPUT_INVALID } from '../errors.js';
import { hostSafeDirectoryDeps, resolveSafeDirectory, } from './safe-directory.js';
export const hostDeps = hostSafeDirectoryDeps;
/**
 * Resolve an artifact root under the caller's read or creation policy.
 * @param configured - the configured path; empty means the harness default.
 * @param deps - injectable filesystem seams.
 * @param options - explicit creation, readability, and absence policy.
 * @returns the safe canonical directory, including a permitted missing suffix.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_OUTPUT_INVALID` for unsafe or inaccessible paths.
 */
export async function resolveOutputDir(configured, deps = hostDeps, options = {}) {
    return await resolveSafeDirectory({
        configured,
        defaultRoot: dshHomePath('zotero-parsed'),
        create: options.create ?? configured.trim() === '',
        readOnly: options.readOnly,
        allowMissing: options.allowMissing,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'enrichment output directory',
        deps,
    });
}
//# sourceMappingURL=output-dir.js.map