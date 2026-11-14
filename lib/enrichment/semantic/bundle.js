/**
 * On-disk verification and loading of one local model bundle.
 *
 * A bundle is trusted only after three checks against the catalog: its
 * `manifest.json` matches the catalog record exactly, every pinned file is
 * present at the pinned size, and every file hashes to the pinned SHA-256.
 * The checks run before the ONNX session opens, so a corrupted or tampered
 * bundle can never produce embeddings — it fails with
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` instead.
 * @module dsh-zotero/enrichment/semantic/bundle
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { manifestOf } from '../../enrichment-model-catalog.js';
import { catalogFilePinsOf, catalogFingerprintOf, MANIFEST_PATH, } from '../../enrichment/model-manifest.js';
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js';
import { openEmbedder } from './session.js';
function refuse(reason) {
    throw new ZoteroError(`The local semantic model is unusable: ${reason}`, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE);
}
const hostDeps = {
    readFile: (path) => readFile(path),
    stat: async (path) => {
        const info = await stat(path);
        return { size: info.size };
    },
    identity: async (path) => {
        const info = await stat(path);
        return {
            dev: info.dev,
            ino: info.ino,
            size: info.size,
            mtimeMs: info.mtimeMs,
            ctimeMs: info.ctimeMs,
        };
    },
    hashFile: (path) => new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(path);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    }),
};
/**
 * The on-disk identity of every file a verification reads, including the
 * manifest. A path that cannot be stat'ed contributes its name, so the
 * verification that follows reports the real reason instead of a stale hit.
 * @param dir - the bundle directory.
 * @param spec - the catalog entry the bundle claims to be.
 * @param deps - filesystem seams.
 * @returns a digest over the pinned paths and their identities.
 */
async function identityFingerprintOf(dir, spec, deps) {
    const hash = createHash('sha256');
    hash.update(dir);
    const paths = [MANIFEST_PATH, ...spec.files.map((file) => file.path)];
    for (const path of paths) {
        const absolute = join(dir, path);
        const identity = deps.identity === undefined
            ? {
                ...(await deps.stat(absolute).catch(() => undefined)),
                dev: 0,
                ino: 0,
                mtimeMs: 0,
                ctimeMs: 0,
            }
            : await deps.identity(absolute).catch(() => undefined);
        hash.update(path);
        hash.update(identity === undefined
            ? 'missing'
            : `${identity.dev}:${identity.ino}:${identity.size}:${identity.mtimeMs}:${identity.ctimeMs}`);
    }
    return hash.digest('hex');
}
/**
 * One verifier per owner (the semantic loader): the first load of a bundle
 * hashes every pinned file, and a later load of the same bytes reuses that
 * answer. Re-reading a 600 MB checkpoint on every model switch cost more than
 * the load itself; the inode, size and both timestamps are what make the reuse
 * safe, and an out-of-band rewrite changes them.
 * @param deps - filesystem seams.
 * @returns the memoized verifier.
 */
export function createBundleVerifier(deps = hostDeps) {
    const verified = new Map();
    return {
        async verify(dir, spec) {
            const fingerprint = await identityFingerprintOf(dir, spec, deps);
            // The catalog record is part of the key: a revision, dimension, or
            // prefix change invalidates the remembered verification even when the
            // files on disk are byte-for-byte the same.
            const key = `${resolve(dir)}|${catalogFingerprintOf(manifestOf(spec))}`;
            const cached = verified.get(key);
            if (cached !== undefined && cached.identityFingerprint === fingerprint)
                return;
            await verifySemanticBundle(dir, spec, deps);
            // Record only after the bytes matched: a failed verification must be
            // re-run, not remembered as the answer for this identity.
            verified.set(key, { identityFingerprint: fingerprint });
        },
    };
}
/** Read and parse one JSON file from the bundle. */
export async function readJsonFile(path) {
    const bytes = await readFile(path);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}
/**
 * Verify one bundle directory against the catalog: manifest agreement, pinned
 * sizes, pinned digests.
 * @param dir - the bundle directory.
 * @param spec - the catalog entry the bundle claims to be.
 * @param deps - filesystem seams; defaults to the host.
 */
export async function verifySemanticBundle(dir, spec, deps = hostDeps) {
    let manifest;
    try {
        manifest = JSON.parse(new TextDecoder('utf-8').decode(await deps.readFile(join(dir, MANIFEST_PATH))));
    }
    catch (error) {
        refuse(`manifest.json is missing or unreadable (${error.message})`);
    }
    const expected = manifestOf(spec);
    // The shared catalog rule: schema, physical key, path safety, duplicates,
    // byte and digest shapes, and at least one pinned file.
    const pins = catalogFilePinsOf(expected, refuse);
    if (typeof manifest !== 'object' ||
        manifest === null ||
        manifest.schema !== expected.schema ||
        manifest.key !== expected.key ||
        manifest.physicalKey !== expected.physicalKey ||
        manifest.modelId !== expected.modelId ||
        manifest.revision !== expected.revision ||
        manifest.dimension !== expected.dimension ||
        manifest.maxTokens !== expected.maxTokens ||
        manifest.pooling !== expected.pooling ||
        manifest.normalize !== expected.normalize ||
        manifest.queryPrefix !== expected.queryPrefix ||
        manifest.documentPrefix !== expected.documentPrefix) {
        refuse('manifest.json disagrees with the catalog about this model');
    }
    const files = manifest.files;
    if (typeof files !== 'object' || files === null)
        refuse('manifest.json has no file record');
    for (const [path, pin] of pins) {
        const entry = files[path];
        if (entry === undefined || entry.bytes !== pin.bytes || entry.sha256 !== pin.sha256) {
            refuse(`manifest.json disagrees about ${path}`);
        }
        const onDisk = await deps.stat(join(dir, path)).catch((error) => {
            refuse(`${path} is missing (${error.message})`);
        });
        if (onDisk.size !== pin.bytes) {
            refuse(`${path} is ${onDisk.size} bytes, expected ${pin.bytes}`);
        }
        const digest = await deps.hashFile(join(dir, path)).catch((error) => {
            refuse(`${path} could not be hashed (${error.message})`);
        });
        if (digest !== pin.sha256) {
            refuse(`${path} failed its SHA-256 check`);
        }
    }
}
/**
 * Verify a bundle and open its embedder. This is the one entry the ranker's
 * loader uses; every failure mode above surfaces as
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`.
 * @param spec - the catalog entry to load.
 * @param dir - the bundle directory.
 * @param deps - filesystem seams.
 * @param verifier - the owner's memoized verifier; a plain verification when absent.
 */
export async function openSemanticEmbedder(spec, dir, deps = hostDeps, verifier) {
    if (verifier === undefined)
        await verifySemanticBundle(dir, spec, deps);
    else
        await verifier.verify(dir, spec);
    return await openEmbedder(spec, dir);
}
//# sourceMappingURL=bundle.js.map