/** Runtime loading uses the same bundle inspection as status and installation. */
import { manifestOf } from '../../enrichment-model-catalog.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createBundleInspector } from '../model-bundle-inspector.js';
import { readRegularFile } from '../../regular-file.js';
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js';
import { openEmbedder } from './session.js';
import { SemanticBundleFailure } from './bundle-failure.js';
/** Reuse the inspector's bounded process cache across loader replacements. */
export function createBundleVerifier() {
    const inspector = createBundleInspector();
    return {
        async verify(dir, spec) {
            try {
                const inspection = await inspector.inspect({ dir, expected: manifestOf(spec) }, { runtime: true });
                if (inspection.kind !== 'ready')
                    throw new SemanticBundleFailure(`The local semantic model is unusable: ${inspection.reason ?? 'the model bundle is missing'}`, inspection.kind, inspection.snapshot);
            }
            catch (cause) {
                if (cause instanceof SemanticBundleFailure)
                    throw cause;
                throw new ZoteroError(`The local semantic model is unusable: ${cause instanceof Error ? cause.message : String(cause)}`, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, { cause });
            }
        },
    };
}
/** The verified bytes are the bytes the runtime receives, including after a path replacement. */
export async function readPinnedBundleFile(spec, dir, path) {
    const pin = spec.files.find((file) => file.path === path);
    if (pin === undefined)
        throw new Error(`The catalog does not pin ${path}`);
    const bytes = await readRegularFile(join(dir, path), pin.bytes);
    if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        throw new Error(`${path} failed its SHA-256 check before runtime use`);
    return bytes;
}
export async function readJsonFile(spec, dir, path) {
    return JSON.parse((await readPinnedBundleFile(spec, dir, path)).toString('utf8'));
}
export async function verifySemanticBundle(dir, spec) {
    await createBundleVerifier().verify(dir, spec);
}
/** Verify the complete bundle before creating a session. */
export async function openSemanticEmbedder(spec, dir, verifier = createBundleVerifier()) {
    await verifier.verify(dir, spec);
    return await openEmbedder(spec, dir);
}
//# sourceMappingURL=bundle.js.map