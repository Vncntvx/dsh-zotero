/**
 * One shared, transactional installation for a pinned semantic model bundle.
 *
 * Host and CLI installers supply their own transport. This module owns the
 * cross-process writer lock, private staging, exact byte/hash validation, the
 * catalog-only publication whitelist, and the manifest commit marker. Its only
 * non-relative runtime imports are bare packages (the atomic-write seam and the
 * `HarnessError` base), so the CLI can load its TypeScript source directly with
 * Node's native type stripping.
 * @module dsh-zotero/enrichment/model-installation
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open as openFile, readdir, realpath, rename, rmdir, unlink, } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { HarnessError } from '@deepseek-ai/dsh-error';
import { catalogFilePinsOf, MANIFEST_MAX_BYTES, MANIFEST_PATH, READ_CHUNK_BYTES, unsafeRelativePathReason, } from './model-manifest.js';
const LOCK_WAIT_MS = 60_000;
/**
 * The machine code every installation failure carries. `runInstall` hands the
 * failure to its caller inside a `ZoteroError`, so the code stays out of the
 * Zotero vocabulary; `HarnessError` is what lets a direct caller route on
 * `name`/`code` instead of parsing the message.
 */
export const MODEL_INSTALLATION_FAILED = 'MODEL_INSTALLATION_FAILED';
export class ModelInstallationError extends HarnessError {
    constructor(message, options) {
        super(message, MODEL_INSTALLATION_FAILED, options);
    }
}
function unsafe(reason) {
    throw new ModelInstallationError(`The model installation path is unsafe: ${reason}`);
}
function check(signal) {
    signal?.throwIfAborted();
}
function identityOf(info) {
    return {
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
    };
}
function sameIdentity(a, b) {
    return (a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.ctimeMs === b.ctimeMs);
}
async function lstatOrUndefined(path) {
    try {
        return await lstat(path);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
/** Reject symlinks and non-directories, including after a racing creation. */
async function assertDirectory(path, create, signal) {
    check(signal);
    let info = await lstatOrUndefined(path);
    if (info === undefined) {
        if (!create)
            throw new ModelInstallationError(`The model directory is missing: ${path}`);
        try {
            await mkdir(path);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        check(signal);
        info = await lstatOrUndefined(path);
    }
    if (info === undefined || info.isSymbolicLink() || !info.isDirectory())
        unsafe(`${path} is not a regular directory`);
    const canonical = await realpath(path);
    check(signal);
    if (resolve(canonical) !== resolve(path))
        unsafe(`${path} is not canonical`);
}
async function assertRegularFile(path, signal) {
    check(signal);
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
        unsafe(`${path} is not a regular file`);
    return identityOf(info);
}
export async function assertModelLockPath(filename, signal) {
    for (const path of [filename, `${filename}.lock`]) {
        check(signal);
        const info = await lstatOrUndefined(path);
        if (info !== undefined && (info.isSymbolicLink() || !info.isFile()))
            unsafe(`${path} is not a regular lock file`);
    }
}
export function safeModelRelativePath(value) {
    if (typeof value !== 'string' ||
        value === '' ||
        value.startsWith('/') ||
        unsafeRelativePathReason(value) !== undefined) {
        unsafe(`invalid relative path ${String(value)}`);
    }
    return value;
}
function fileListOf(expected) {
    // The shared rule; this module only supplies its own error class.
    return catalogFilePinsOf(expected, unsafe);
}
function markerOf(expected) {
    const bytes = new TextEncoder().encode(JSON.stringify(expected));
    if (bytes.byteLength === 0 || bytes.byteLength > MANIFEST_MAX_BYTES)
        unsafe('the catalog manifest is too large');
    return {
        bytes,
        file: {
            path: MANIFEST_PATH,
            bytes: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        },
    };
}
function parentsOf(relativePath) {
    const segments = relativePath.split('/');
    return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}
async function ensureParents(root, relativePath, signal) {
    let current = root;
    for (const segment of relativePath.split('/').slice(0, -1)) {
        current = join(current, segment);
        await assertDirectory(current, true, signal);
    }
}
/** Verify the same open file descriptor before and after hashing. */
async function hashStagedFile(path, file, signal) {
    const pre = await assertRegularFile(path, signal);
    const handle = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let failure;
    let opened;
    try {
        opened = identityOf(await handle.stat());
        if (!sameIdentity(pre, opened))
            unsafe(`${path} changed before hashing`);
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(READ_CHUNK_BYTES);
        let bytes = 0;
        for (;;) {
            check(signal);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            bytes += bytesRead;
            if (bytes > file.bytes)
                unsafe(`${path} exceeds its pinned size`);
            hash.update(buffer.subarray(0, bytesRead));
            check(signal);
        }
        if (bytes !== file.bytes || hash.digest('hex') !== file.sha256)
            unsafe(`${path} does not match its pinned bytes and SHA-256`);
        const post = identityOf(await handle.stat());
        if (!sameIdentity(opened, post))
            unsafe(`${path} changed while hashing`);
        return post;
    }
    catch (error) {
        failure = signal?.aborted ? signal.reason : error;
    }
    finally {
        try {
            await handle.close();
        }
        catch (error) {
            if (failure === undefined)
                failure = error;
        }
    }
    throw failure;
}
/** The private stage may contain only catalog files, their parents, and the marker. */
async function verifyStageTree(stage, files, includeManifest, signal) {
    const allowedFiles = new Set(files.keys());
    if (includeManifest)
        allowedFiles.add(MANIFEST_PATH);
    const allowedDirectories = new Set();
    for (const path of allowedFiles)
        for (const parent of parentsOf(path))
            allowedDirectories.add(parent);
    const walk = async (current, relative) => {
        check(signal);
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
            const child = join(current, entry.name);
            if (entry.isSymbolicLink()) {
                // Refuse symlinks planted at catalog paths. An unexpected symlink under
                // a predictable temp name is not followed or unlinked; owned writes use
                // exclusive random names, and the tree walk ignores it.
                if (allowedFiles.has(childRelative) || allowedDirectories.has(childRelative))
                    unsafe(`${child} is a symbolic link`);
                continue;
            }
            if (entry.isDirectory()) {
                if (!allowedDirectories.has(childRelative))
                    unsafe(`${child} is not a catalog directory`);
                await walk(child, childRelative);
            }
            else if (entry.isFile() && allowedFiles.has(childRelative)) {
                await assertRegularFile(child, signal);
            }
            else {
                unsafe(`${child} is not an owned catalog file`);
            }
        }
    };
    await walk(stage, '');
    check(signal);
}
/** Remove only the random private directory and entries inside it, without following links. */
async function cleanupStage(stage) {
    const initial = await lstatOrUndefined(stage);
    if (initial === undefined)
        return;
    if (initial.isSymbolicLink() || !initial.isDirectory()) {
        await unlink(stage);
        return;
    }
    const remove = async (current) => {
        const info = await lstatOrUndefined(current);
        if (info === undefined)
            return;
        if (info.isSymbolicLink() || !info.isDirectory()) {
            await unlink(current);
            return;
        }
        const canonical = await realpath(current);
        if (resolve(canonical) !== resolve(current))
            throw new ModelInstallationError(`The staging directory is not canonical: ${current}`);
        for (const entry of await readdir(current, { withFileTypes: true })) {
            const child = join(current, entry.name);
            if (entry.isDirectory())
                await remove(child);
            else
                await unlink(child);
        }
        await rmdir(current);
    };
    await remove(stage);
}
function publicationPathsOf(snapshot, canonicalDir, files) {
    const dir = resolve(snapshot.dir);
    if (dir !== resolve(canonicalDir))
        unsafe('the bundle snapshot names another directory');
    if (snapshot.files.length !== files.size)
        unsafe('the bundle snapshot has a different file list');
    const paths = new Map();
    for (const entry of snapshot.files) {
        const relativePath = safeModelRelativePath(entry.relativePath);
        if (!files.has(relativePath) || paths.has(relativePath))
            unsafe(`the bundle snapshot has an unexpected file ${relativePath}`);
        const path = resolve(entry.path);
        if (!isAbsolute(entry.path) || !path.startsWith(dir + sep))
            unsafe(`the bundle snapshot path escapes its directory: ${entry.path}`);
        paths.set(relativePath, entry.path);
    }
    const manifest = snapshot.manifest.path;
    if (!isAbsolute(manifest) ||
        basename(manifest) !== MANIFEST_PATH ||
        resolve(dirname(manifest)) !== dir)
        unsafe('the bundle snapshot manifest is not its commit marker');
    return { dir, manifest, files: paths };
}
async function installUnderLock(context) {
    const { options, target, canonicalRoot, canonicalDir, physicalKey, lockFilename } = context;
    const signal = options.signal;
    check(signal);
    await assertDirectory(canonicalRoot, false, signal);
    await assertModelLockPath(lockFilename, signal);
    if (options.force !== true) {
        const current = await options.inspector.inspect(target, { forceHash: true, signal });
        check(signal);
        if (current.kind === 'ready')
            return { status: 'already-ready', dir: canonicalDir };
    }
    await assertDirectory(canonicalDir, true, signal);
    // Nested catalog parents are created only at publication time, inside the
    // commit critical section. A cancelled or failed attempt never leaves a new
    // directory behind in the live model tree.
    const before = await options.inspector.snapshot(target, { signal });
    check(signal);
    publicationPathsOf(before, canonicalDir, context.files);
    const stage = await mkdtemp(join(canonicalRoot, `.${physicalKey}-install-`));
    context.stage.path = stage;
    check(signal);
    await assertDirectory(stage, false, signal);
    const canonicalStage = await realpath(stage);
    if (resolve(canonicalStage) !== resolve(stage))
        unsafe('the private staging directory is not canonical');
    for (const file of context.files.values()) {
        check(signal);
        await mkdir(dirname(join(stage, file.path)), { recursive: true });
        check(signal);
        await options.transfer(file, stage, context.workSignal);
    }
    check(signal);
    await verifyStageTree(stage, context.files, false, signal);
    for (const [path, file] of context.files) {
        check(signal);
        await hashStagedFile(join(stage, path), file, signal);
    }
    check(signal);
    await writeFileAtomic(join(stage, MANIFEST_PATH), context.markerBytes, {
        mode: 0o600,
        dirMode: 0o700,
    });
    check(signal);
    await verifyStageTree(stage, context.files, true, signal);
    await hashStagedFile(join(stage, MANIFEST_PATH), context.marker, signal);
    await assertDirectory(canonicalRoot, false, signal);
    await assertDirectory(canonicalDir, true, signal);
    const publication = await options.inspector.snapshot(target, { signal });
    check(signal);
    const paths = publicationPathsOf(publication, canonicalDir, context.files);
    const oldMarker = await lstatOrUndefined(paths.manifest);
    if (oldMarker !== undefined) {
        if (oldMarker.isSymbolicLink() || !oldMarker.isFile())
            unsafe('the existing commit marker is not a regular file');
        check(signal);
        await unlink(paths.manifest);
    }
    for (const [relativePath] of context.files) {
        check(signal);
        const finalPath = paths.files.get(relativePath);
        if (finalPath === undefined)
            unsafe(`the bundle snapshot omits ${relativePath}`);
        const existing = await lstatOrUndefined(finalPath);
        if (existing !== undefined && (existing.isSymbolicLink() || !existing.isFile()))
            unsafe(`the published path is not a regular file: ${finalPath}`);
        await ensureParents(canonicalDir, relativePath, signal);
        await rename(join(stage, relativePath), finalPath);
        // A cross-directory rename can change ctime/inode on some filesystems, so
        // the publication guarantee is a fresh hash of the final path, not an
        // inode-identity comparison against the staged file.
        const published = context.files.get(relativePath);
        if (published === undefined)
            unsafe(`the catalog omits ${relativePath}`);
        await hashStagedFile(finalPath, published, signal);
    }
    await assertDirectory(canonicalRoot, false, signal);
    // The last cancellation check is before the commit. A committed marker wins
    // over a cancellation that arrives while writeFileAtomic completes.
    check(signal);
    await writeFileAtomic(paths.manifest, context.markerBytes, { mode: 0o600, dirMode: 0o700 });
    return { status: 'installed', dir: paths.dir };
}
/**
 * Install or join one pinned bundle under a 60-second cross-process writer lock.
 * A transport failure never publishes a marker; a completed marker commit is a
 * real success even if the caller cancels during the final atomic rename.
 */
export async function installModelBundle(options) {
    const signal = options.signal;
    check(signal);
    const files = fileListOf(options.expected);
    const { bytes: markerBytes, file: marker } = markerOf(options.expected);
    const absoluteDir = resolve(options.dir);
    const physicalKey = basename(absoluteDir);
    const root = dirname(absoluteDir);
    if (!isAbsolute(options.dir) || physicalKey !== options.expected.physicalKey)
        unsafe('the requested directory is not this model’s physical directory');
    const canonicalRoot = await realpath(root);
    check(signal);
    await assertDirectory(canonicalRoot, false, signal);
    const canonicalDir = join(canonicalRoot, physicalKey);
    const target = { dir: canonicalDir, expected: options.expected };
    const lockFilename = join(canonicalRoot, `${physicalKey}.install`);
    const workSignal = signal ?? new AbortController().signal;
    const context = {
        options,
        target,
        canonicalRoot,
        canonicalDir,
        physicalKey,
        lockFilename,
        files,
        markerBytes,
        marker,
        workSignal,
        stage: {},
    };
    let outcome;
    let failure;
    let failed = false;
    try {
        const before = await options.inspector.snapshot(target, { signal });
        check(signal);
        publicationPathsOf(before, canonicalDir, files);
        let entered = false;
        try {
            outcome = await withFileLock(lockFilename, async () => {
                entered = true;
                return await installUnderLock(context);
            }, { waitMs: LOCK_WAIT_MS, ...(signal !== undefined ? { signal } : {}) });
        }
        catch (error) {
            // Public lock acquisition may replace a caller's reason with AbortError.
            // An error from inside the owned operation must remain its actual error.
            if (!entered && signal?.aborted)
                throw signal.reason;
            throw error;
        }
    }
    catch (error) {
        failed = true;
        failure = signal?.aborted ? signal.reason : error;
    }
    let cleanupError;
    try {
        if (context.stage.path !== undefined)
            await (options.cleanup ?? cleanupStage)(context.stage.path);
    }
    catch (error) {
        cleanupError = error;
    }
    if (outcome !== undefined && cleanupError !== undefined)
        outcome.cleanupError = cleanupError;
    if (!failed) {
        // The bundle is committed. A cleanup failure is reported on the outcome —
        // the caller surfaces it as a warning — because the installed files are
        // ready and telling the user the installation failed would be false. This
        // used to throw here, which made `installModelBundle` reject after a
        // successful commit and left the success branch that reads
        // `result.cleanupError` unreachable.
        if (outcome === undefined)
            throw new ModelInstallationError('The installation did not settle');
        return outcome;
    }
    if (cleanupError !== undefined && !signal?.aborted) {
        if (failure instanceof ModelInstallationError)
            throw new AggregateError([failure, cleanupError], 'Model installation and cleanup failed');
        throw cleanupError;
    }
    throw failure;
}
//# sourceMappingURL=model-installation.js.map