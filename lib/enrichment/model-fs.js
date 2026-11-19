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
import { lstat } from 'node:fs/promises';
/**
 * The identity of one stat result.
 * @param info - the `lstat`/`stat` result.
 * @returns the five fields callers compare.
 */
export function identityOf(info) {
    return {
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
    };
}
/**
 * `lstat` with absence read as `undefined`.
 *
 * A missing model file is a state the caller reports, not an exception: the
 * inspector calls it "not installed", the installer calls it "create it", and
 * the removal path calls it "already gone". Any other failure still throws.
 * @param path - the path to stat, without following a final symlink.
 * @returns the stat result, or undefined when nothing is there.
 */
export async function lstatOrUndefined(path) {
    try {
        return await lstat(path);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
//# sourceMappingURL=model-fs.js.map