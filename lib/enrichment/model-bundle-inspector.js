/**
 * Dependency-free inspection of one installed model bundle.
 *
 * The host status/verify endpoints, the installer, and the CLI all judge a
 * bundle with this one rule: the commit marker must equal the catalog record
 * exactly, every pinned path must be a regular file (never a symlink) at its
 * pinned size, and a successful SHA-256 check must belong to the same file
 * identity snapshot now on disk. A same-size mutation therefore invalidates
 * readiness without a second hash on every poll.
 *
 * This module imports only Node built-ins and types, so Node's native
 * TypeScript stripping can load it from `scripts/fetch-semantic-model.mjs`
 * without pulling the ONNX runtime or tokenizer into the CLI process.
 * @module dsh-zotero/enrichment/model-bundle-inspector
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open as openFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { catalogFilePinsOf, catalogFingerprintOf, MANIFEST_MAX_BYTES, MANIFEST_PATH, READ_CHUNK_BYTES, } from './model-manifest.js';
/** One per-process coalescing entry. Polling reuses a successful hash only
 * while the on-disk identity and the catalog record are unchanged. */
const verifiedSnapshots = new Map();
function identityOf(info) {
    return {
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
    };
}
function catalogFiles(expected) {
    // The shared rule; this module keeps its plain-error mapping.
    return catalogFilePinsOf(expected, (reason) => {
        throw new Error(reason);
    });
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
/** A missing path still contributes its absolute expected path to the snapshot;
 * the installer uses that list as its publication whitelist. */
async function pathSnapshot(dir, relativePath) {
    const path = join(dir, relativePath);
    const info = await lstatOrUndefined(path);
    if (info === undefined)
        return { relativePath, path };
    return { relativePath, path, identity: identityOf(info) };
}
function identityFingerprintOf(snapshot) {
    const hash = createHash('sha256');
    hash.update(snapshot.catalogFingerprint);
    const each = (entry) => {
        hash.update(entry.relativePath);
        hash.update(entry.path);
        const id = entry.identity;
        if (id === undefined)
            hash.update('missing');
        else
            hash.update(`${id.dev}:${id.ino}:${id.size}:${id.mtimeMs}:${id.ctimeMs}`);
    };
    each(snapshot.manifest);
    for (const entry of snapshot.files)
        each(entry);
    for (const entry of snapshot.directories)
        each(entry);
    return hash.digest('hex');
}
async function hashFile(path, signal) {
    const handle = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(READ_CHUNK_BYTES);
        for (;;) {
            signal?.throwIfAborted();
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
async function readManifest(path) {
    const info = await lstatOrUndefined(path);
    if (info === undefined)
        return { kind: 'missing' };
    if (info.isSymbolicLink() || !info.isFile())
        return { kind: 'corrupt', reason: 'the commit marker is not a regular file' };
    if (info.size > MANIFEST_MAX_BYTES)
        return { kind: 'corrupt', reason: 'the commit marker exceeds its bounded size' };
    try {
        const bytes = await readFile(path);
        const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return { kind: 'corrupt', reason: 'the commit marker is not a JSON object' };
        return { kind: 'valid' };
    }
    catch (error) {
        return { kind: 'corrupt', reason: error.message };
    }
}
/** One inspector instance owns the coalescing cache for its bundle directory. */
export function createBundleInspector() {
    const cacheKeyOf = (target) => `${resolve(target.dir)}|${catalogFingerprintOf(target.expected)}`;
    const snapshot = async (target, options) => {
        options?.signal?.throwIfAborted();
        const dir = resolve(target.dir);
        const expected = target.expected;
        const files = catalogFiles(expected);
        const relativePaths = [...files.keys()].sort();
        const directories = new Set();
        for (const relativePath of relativePaths) {
            const segments = relativePath.split('/');
            for (let i = 1; i < segments.length; i += 1)
                directories.add(segments.slice(0, i).join('/'));
        }
        const directorySnapshots = [];
        for (const relativePath of [...directories].sort()) {
            options?.signal?.throwIfAborted();
            directorySnapshots.push(await pathSnapshot(dir, relativePath));
        }
        const fileSnapshots = [];
        for (const relativePath of relativePaths) {
            options?.signal?.throwIfAborted();
            fileSnapshots.push(await pathSnapshot(dir, relativePath));
        }
        const manifest = await pathSnapshot(dir, MANIFEST_PATH);
        const partial = {
            dir,
            catalogFingerprint: catalogFingerprintOf(expected),
            directories: directorySnapshots,
            manifest,
            files: fileSnapshots,
        };
        return { ...partial, identityFingerprint: identityFingerprintOf(partial) };
    };
    const inspect = async (target, options) => {
        const signal = options?.signal;
        signal?.throwIfAborted();
        const dir = resolve(target.dir);
        const expected = target.expected;
        const files = catalogFiles(expected);
        const current = await snapshot(target, { signal });
        const totalBytes = [...files.values()].reduce((sum, file) => sum + file.bytes, 0);
        let presentBytes = 0;
        let verifiedBytes = 0;
        const marker = await readManifest(join(dir, MANIFEST_PATH));
        const fileResults = [];
        let corruptReason;
        if (marker.kind !== 'valid') {
            corruptReason = marker.reason ?? 'the commit marker is missing';
        }
        else {
            try {
                const bytes = await readFile(join(dir, MANIFEST_PATH));
                if (JSON.stringify(JSON.parse(new TextDecoder('utf-8').decode(bytes))) !==
                    JSON.stringify(expected))
                    corruptReason = 'the commit marker disagrees with the catalog';
            }
            catch (error) {
                corruptReason = `the commit marker is unreadable (${error.message})`;
            }
        }
        const cacheKey = cacheKeyOf(target);
        const cached = verifiedSnapshots.get(cacheKey);
        // A status poll reuses the last successful full hash only if the catalog
        // record, the marker, and every file identity are unchanged. `verify` and
        // the installer pass forceHash so a repair never trusts a stale entry.
        const reusable = options?.forceHash !== true &&
            cached !== undefined &&
            cached.catalogFingerprint === current.catalogFingerprint &&
            cached.identityFingerprint === current.identityFingerprint &&
            corruptReason === undefined;
        let allValid = corruptReason === undefined;
        for (const [relativePath, pin] of files) {
            signal?.throwIfAborted();
            const path = join(dir, relativePath);
            const info = await lstatOrUndefined(path);
            if (info === undefined || info.isSymbolicLink() || !info.isFile()) {
                allValid = false;
                fileResults.push({
                    relativePath,
                    kind: 'missing',
                    bytes: 0,
                    reason: `${relativePath} is missing or not a regular file`,
                });
                continue;
            }
            if (info.size === pin.bytes)
                presentBytes += pin.bytes;
            if (info.size !== pin.bytes) {
                allValid = false;
                fileResults.push({
                    relativePath,
                    kind: 'corrupt',
                    bytes: info.size,
                    reason: `${relativePath} is ${info.size} bytes, expected ${pin.bytes}`,
                });
                continue;
            }
            if (reusable) {
                verifiedBytes += pin.bytes;
                fileResults.push({ relativePath, kind: 'valid', bytes: info.size, sha256: pin.sha256 });
                continue;
            }
            signal?.throwIfAborted();
            const digest = await hashFile(path, signal).catch((error) => error);
            if (digest instanceof Error || digest !== pin.sha256) {
                allValid = false;
                fileResults.push({
                    relativePath,
                    kind: 'corrupt',
                    bytes: info.size,
                    ...(typeof digest === 'string' ? { sha256: digest } : {}),
                    reason: `${relativePath} failed its SHA-256 check`,
                });
                continue;
            }
            verifiedBytes += pin.bytes;
            fileResults.push({ relativePath, kind: 'valid', bytes: info.size, sha256: digest });
        }
        const kind = allValid
            ? 'ready'
            : presentBytes === 0 && marker.kind === 'missing'
                ? 'missing'
                : 'corrupt';
        const reason = kind === 'corrupt'
            ? (corruptReason ??
                fileResults.find((file) => file.kind !== 'valid')?.reason ??
                'the model bundle failed validation')
            : undefined;
        if (allValid)
            verifiedSnapshots.set(cacheKey, {
                catalogFingerprint: current.catalogFingerprint,
                identityFingerprint: current.identityFingerprint,
            });
        else
            verifiedSnapshots.delete(cacheKey);
        return {
            kind,
            snapshot: current,
            totalBytes,
            presentBytes,
            verifiedBytes,
            ...(reason !== undefined ? { reason } : {}),
            manifest: marker,
            files: fileResults,
        };
    };
    return { snapshot, inspect };
}
/** Read-only status: a missing root is a normal miss, never a write. */
export async function inspectInstalledBundle(dir, expected, options) {
    return await createBundleInspector().inspect({ dir, expected }, options);
}
//# sourceMappingURL=model-bundle-inspector.js.map