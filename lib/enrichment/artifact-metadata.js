/**
 * Lease-free metadata and batched freshness probes over committed artifacts.
 *
 * Both arms answer from the source index and one meta.json per artifact; the
 * probe arm additionally validates the source against the stored stamp. The
 * service and the test fixtures compose the same functions, so a probe always
 * means exactly what a single-target inspect means.
 * @module dsh-zotero/enrichment/artifact-metadata
 */
import { hostSourceBytesDeps, probeSource } from './source-bytes.js';
import { parseTargetOf, resolveParseTarget } from './parse-target.js';
import { canonicalSourceIdentityOf } from './identity.js';
import { sourceKeyOf, stampMatches } from './source-stamp.js';
import { refFieldsOf } from '../ref-grammar.js';
import { mapWithConcurrency } from '../concurrency.js';
import { ENRICHMENT_DOCUMENT_LIMITS, } from '../enrichment-preferences.js';
/**
 * Lease-free metadata for one stored artifact: the tab-title path. This arm
 * never resolves an attachment, stats a source or issues a HEAD — it reads
 * the source index and one meta.json, nothing else.
 */
export async function storedMetadata(deps, config, request, signal) {
    signal.throwIfAborted();
    const store = await deps.store();
    let cacheKey;
    if (request.target.kind === 'artifact') {
        cacheKey = request.target.artifactId;
    }
    else {
        const identity = canonicalSourceIdentityOf(request.target.kind === 'attachment' ? request.target.ref : request.target.url);
        cacheKey = (await store.sourceRecord(sourceKeyOf(identity)))?.cacheKey;
        signal.throwIfAborted();
    }
    if (cacheKey === undefined)
        return { kind: 'missing' };
    const stored = await store.metaFor(cacheKey);
    signal.throwIfAborted();
    if (stored === undefined)
        return { kind: 'missing' };
    const { meta } = stored;
    return {
        metadata: {
            sourceId: meta.sourceId,
            targetLabel: meta.identity,
            mode: meta.mode,
            artifactId: cacheKey,
            fingerprint: meta.contentFingerprint,
            characterCount: meta.characterCount,
            images: meta.images ?? [],
            ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
            ...(meta.title !== undefined ? { title: meta.title } : {}),
        },
    };
}
/**
 * One freshness probe per visible attachment row, answered from a single
 * index snapshot: rows with no committed artifact cost nothing, resolved rows
 * cost one attachment resolution and one stat or HEAD. A per-ref failure is
 * the badge's absence, never an error on the wire.
 */
export async function probeAttachments(deps, config, request, signal) {
    signal.throwIfAborted();
    const store = await deps.store();
    const index = await store.snapshot();
    const results = await mapWithConcurrency(request.refs, 8, async (ref, perCall) => {
        try {
            const fields = refFieldsOf(ref);
            if (fields === undefined || fields.kind !== 'attachment')
                return { ref, state: 'missing' };
            const record = index.sources[sourceKeyOf(canonicalSourceIdentityOf(ref))];
            if (record === undefined)
                return { ref, state: 'missing' };
            const target = await resolveParseTarget(parseTargetOf({ kind: 'attachment', ref }), deps.resolveAttachment, perCall);
            const stamp = await probeSource(target.input, ENRICHMENT_DOCUMENT_LIMITS.pro.maxBytes, hostSourceBytesDeps(deps.resolveAttachment, deps.client), perCall);
            if (!stampMatches(record.stamp, stamp))
                return { ref, state: 'expired' };
            if ((await store.metadataFor(record)) === undefined)
                return { ref, state: 'expired' };
            return { ref, state: 'ready' };
        }
        catch {
            return { ref, state: 'missing' };
        }
    }, { signal });
    return { kind: 'probed', results };
}
//# sourceMappingURL=artifact-metadata.js.map