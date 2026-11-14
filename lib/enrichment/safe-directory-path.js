/**
 * Domain-independent directory admission for untrusted configured paths.
 *
 * The complete candidate, including any missing suffix, is canonicalized and
 * checked before creation. This module has no plugin-domain imports so the
 * model-installation CLI can load its TypeScript source directly.
 * @module dsh-zotero/enrichment/safe-directory-path
 */
import { access, constants, mkdir, realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { canonicalizeWatchPath, expandHomePath } from '@deepseek-ai/dsh-home-paths';
export const hostSafePathDeps = {
    realpath,
    canonicalize: canonicalizeWatchPath,
    stat,
    access,
    mkdir: async (path) => {
        await mkdir(path, { recursive: true });
    },
};
const SENSITIVE_USER_DIRS = ['.ssh', '.gnupg'];
const SYSTEM_ROOTS = [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/var',
    '/System',
    '/Library',
    '/Windows',
    '/Program Files',
];
async function canonicalOf(path, deps) {
    if (deps.canonicalize !== undefined)
        return await deps.canonicalize(path);
    // Injected filesystems retain their own boundary: never consult the host's
    // real disk when a test or caller supplies only realpath/stat/access seams.
    let current = resolve(path);
    const missing = [];
    for (;;) {
        try {
            const canonical = await deps.realpath(current);
            if (missing.length > 0) {
                const info = await deps.stat(canonical);
                if (!info.isDirectory())
                    throw new Error('the existing ancestor is not a directory');
                await deps.access(canonical, constants.R_OK);
            }
            return join(canonical, ...missing.reverse());
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            const parent = dirname(current);
            if (parent === current)
                throw error;
            missing.push(basename(current));
            current = parent;
        }
    }
}
async function sensitiveRoots(deps) {
    const home = await canonicalOf((deps.home ?? homedir)(), deps);
    const temp = await canonicalOf((deps.temp ?? tmpdir)(), deps);
    const system = await Promise.all(SYSTEM_ROOTS.map(async (root) => await canonicalOf(root, deps)));
    const user = await Promise.all(SENSITIVE_USER_DIRS.map(async (name) => await canonicalOf(resolve(home, name), deps)));
    return { exact: [sep, home], system, user, temp };
}
function isSensitivePath(candidate, roots) {
    const contains = (root) => candidate === root || candidate.startsWith(root + sep);
    // A temp-root exception must not permit the home itself or its credentials.
    if (roots.exact.includes(candidate) || roots.user.some(contains))
        return true;
    // macOS temporary directories canonically live below /private/var.
    if (contains(roots.temp))
        return false;
    return roots.system.some(contains);
}
/** Resolve one canonical root, checking the full path before touching disk. */
export async function resolveSafeDirectoryPath(options) {
    const deps = options.deps ?? hostSafePathDeps;
    const { refuse } = options;
    const trimmed = options.configured.trim();
    const expanded = expandHomePath(trimmed === '' ? options.defaultRoot : trimmed);
    const absolute = isAbsolute(expanded) ? resolve(expanded) : refuse('the path is not absolute');
    const resolvePath = async (path) => await canonicalOf(path, deps).catch((error) => refuse(`the path cannot be resolved (${error.message})`));
    let canonical = await resolvePath(absolute);
    const roots = await sensitiveRoots(deps).catch((error) => refuse(`the path cannot be resolved (${error.message})`));
    const checkPath = (path) => {
        if (!isAbsolute(path))
            refuse('the resolved path is not absolute');
        if (isSensitivePath(path, roots)) {
            refuse('the path is a sensitive system or credential directory');
        }
    };
    checkPath(canonical);
    const inspect = async (path) => {
        const info = await deps.stat(path).catch((error) => {
            if (error.code === 'ENOENT')
                return undefined;
            return refuse(`the directory could not be inspected (${error.message})`);
        });
        if (info === undefined)
            return false;
        if (!info.isDirectory())
            refuse('the path is not a directory');
        try {
            await deps.access(path, options.readOnly ? constants.R_OK : constants.R_OK | constants.W_OK);
        }
        catch (error) {
            refuse(`the directory is not ${options.readOnly ? 'readable' : 'writable'} (${error.message})`);
        }
        return true;
    };
    if (await inspect(canonical))
        return canonical;
    if (!options.create || options.readOnly) {
        if (options.allowMissing)
            return canonical;
        refuse('the directory does not exist (ENOENT)');
    }
    try {
        await deps.mkdir(canonical);
    }
    catch (error) {
        refuse(`could not create ${trimmed === '' ? 'the default directory' : 'the directory'} (${error.message})`);
    }
    try {
        canonical = await canonicalOf(canonical, deps);
    }
    catch (error) {
        refuse(`the created path cannot be resolved (${error.message})`);
    }
    checkPath(canonical);
    if (!(await inspect(canonical)))
        refuse('the created directory does not exist (ENOENT)');
    return canonical;
}
//# sourceMappingURL=safe-directory-path.js.map