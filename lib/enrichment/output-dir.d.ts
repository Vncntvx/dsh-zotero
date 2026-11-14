/**
 * Resolve the parsed-artifact root. Active callers retain the default creation
 * policy; cache lookup requests a safe canonical root without creating it or
 * requiring write access. Directory checks are shared with semantic models.
 * @module dsh-zotero/enrichment/output-dir
 */
import { type SafeDirectoryDeps } from './safe-directory.js';
export type OutputDirDeps = SafeDirectoryDeps;
export declare const hostDeps: OutputDirDeps;
export interface OutputDirOptions {
    /** Override the default policy: create the default root, require configured roots to exist. */
    readonly create?: boolean;
    readonly readOnly?: boolean;
    readonly allowMissing?: boolean;
}
/**
 * Resolve an artifact root under the caller's read or creation policy.
 * @param configured - the configured path; empty means the harness default.
 * @param deps - injectable filesystem seams.
 * @param options - explicit creation, readability, and absence policy.
 * @returns the safe canonical directory, including a permitted missing suffix.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_OUTPUT_INVALID` for unsafe or inaccessible paths.
 */
export declare function resolveOutputDir(configured: string, deps?: OutputDirDeps, options?: OutputDirOptions): Promise<string>;
//# sourceMappingURL=output-dir.d.ts.map