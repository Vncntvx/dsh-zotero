/**
 * The filesystem words the model installer, the bundle inspector, and the
 * removal path share.
 *
 * Each of those modules carried its own copy of "the identity a stat reports"
 * and of "absent is not an error", and the copies had started to drift. One
 * definition keeps a file installed by one path recognizable to the path that
 * verifies it and the one that deletes it.
 *
 * Dependency-free on purpose: Node's native TypeScript stripping loads these
 * modules from the CLI scripts, so nothing here may pull in a package.
 * @module dsh-zotero/enrichment/model-fs
 */
import type { Stats } from 'node:fs';
/**
 * Everything about one file that decides whether it is still the same file:
 * the device and inode catch a replacement, the size and timestamps catch an
 * edit in place.
 */
export interface BundleFileIdentity {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}
/**
 * The identity of one stat result.
 * @param info - the `lstat`/`stat` result.
 * @returns the five fields callers compare.
 */
export declare function identityOf(info: {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}): BundleFileIdentity;
/**
 * `lstat` with absence read as `undefined`.
 *
 * A missing model file is a state the caller reports, not an exception: the
 * inspector calls it "not installed", the installer calls it "create it", and
 * the removal path calls it "already gone". Any other failure still throws.
 * @param path - the path to stat, without following a final symlink.
 * @returns the stat result, or undefined when nothing is there.
 */
export declare function lstatOrUndefined(path: string): Promise<Stats | undefined>;
//# sourceMappingURL=model-fs.d.ts.map