/**
 * Domain-facing wrapper around the standalone safe-path resolver. The complete
 * candidate is validated before creation; reads can return a missing path.
 * @module dsh-zotero/enrichment/safe-directory
 */
import type { SafePathDeps, SafePathOptions } from './safe-directory-path.js';
import { type ZoteroErrorCode } from '../errors.js';
export type SafeDirectoryDeps = SafePathDeps;
export declare const hostSafeDirectoryDeps: SafeDirectoryDeps;
export interface SafeDirectoryOptions extends Omit<SafePathOptions, 'deps' | 'refuse'> {
    readonly errorCode: ZoteroErrorCode;
    readonly label: string;
    readonly deps?: SafeDirectoryDeps;
}
/** Resolve one canonical root, translating refusals into a stable domain code. */
export declare function resolveSafeDirectory(options: SafeDirectoryOptions): Promise<string>;
//# sourceMappingURL=safe-directory.d.ts.map