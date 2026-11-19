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
import { limitsFor } from './types.js';
/**
 * How long one resolved attachment stands. The badge is advisory: a row says
 * its parsed artifact was fresh when probed, and the next probe after this
 * window resolves the attachment again.
 */
const ATTACHMENT_RESOLUTION_TTL_MS = 30_000;
/** The most resolved attachments one cache holds; a visible page is smaller. */
const ATTACHMENT_RESOLUTION_LIMIT = 256;
/**
 * A bounded, time-scoped memo of resolved attachments, keyed by ref.
 *
 * One badge probe needs the attachment twice — once to validate the parse
 * target and once to stat the file behind it — and two pages of one listing
 * ("show more", or a re-render whose revision moved) repeat that work for rows
 * whose attachment has not moved. Each entry is two loopback reads; the memo
 * makes them one per ref per listing.
 *
 * The owner is the component: the service creates one and clears it on
 * teardown, so no module-level state outlives the registration that filled it.
 */
export class AttachmentResolutionCache {
    limit;
    ttlMs;
    now;
    answers = new Map();
    /**
     * @param limit - the most entries held; the oldest is evicted at the cap.
     * @param ttlMs - how long one entry stands.
     * @param now - the clock, injectable so a spec can age an entry.
     */
    constructor(limit = ATTACHMENT_RESOLUTION_LIMIT, ttlMs = ATTACHMENT_RESOLUTION_TTL_MS, now = Date.now) {
        this.limit = limit;
        this.ttlMs = ttlMs;
        this.now = now;
    }
    /**
     * The resolved attachment for one ref, if it is still fresh.
     * @param ref - the attachment ref.
     * @returns the view, or undefined when absent or stale.
     */
    get(ref) {
        const entry = this.answers.get(ref);
        if (entry === undefined)
            return undefined;
        if (entry.expiresAt <= this.now()) {
            this.answers.delete(ref);
            return undefined;
        }
        // Touch: the most recently read entry is the last to be evicted.
        this.answers.delete(ref);
        this.answers.set(ref, entry);
        return entry.view;
    }
    /**
     * Remember one resolution until its TTL runs out.
     * @param ref - the attachment ref.
     * @param view - what the core answered for it.
     */
    set(ref, view) {
        this.answers.delete(ref);
        if (this.answers.size >= this.limit) {
            const oldest = this.answers.keys().next().value;
            if (oldest !== undefined)
                this.answers.delete(oldest);
        }
        this.answers.set(ref, { view, expiresAt: this.now() + this.ttlMs });
    }
    /** Drop every remembered resolution; called from the owner's teardown. */
    clear() {
        this.answers.clear();
    }
}
/**
 * The prober's resolver: the core is asked once per ref per TTL window, and
 * the target validation and the source stat agree by construction because
 * both read the same answer.
 * @param resolve - the core's resolver.
 * @param cache - the owner's memo; absent means every call resolves.
 * @returns the resolver the probe should use.
 */
export function cachedAttachmentResolver(resolve, cache) {
    if (cache === undefined)
        return resolve;
    return async (ref, signal) => {
        signal?.throwIfAborted();
        const remembered = cache.get(ref);
        if (remembered !== undefined)
            return remembered;
        const view = await resolve(ref, signal);
        cache.set(ref, view);
        return view;
    };
}
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
    const currentArtifactId = request.target.kind === 'artifact'
        ? (await store.sourceRecord(meta.sourceId))?.cacheKey
        : cacheKey;
    signal.throwIfAborted();
    return {
        ...(currentArtifactId !== undefined ? { currentArtifactId } : {}),
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
    const resolve = cachedAttachmentResolver(deps.resolveAttachment, deps.resolutionCache);
    const results = await mapWithConcurrency(request.refs, 8, async (ref, perCall) => {
        try {
            const fields = refFieldsOf(ref);
            if (fields === undefined || fields.kind !== 'attachment')
                return { ref, state: 'missing' };
            const record = index.sources[sourceKeyOf(canonicalSourceIdentityOf(ref))];
            if (record === undefined)
                return { ref, state: 'missing' };
            const meta = await store.metadataFor(record);
            if (meta === undefined)
                return { ref, state: 'expired' };
            const target = await resolveParseTarget(parseTargetOf({ kind: 'attachment', ref }), resolve, perCall);
            const stamp = await probeSource(target.input, limitsFor(meta.mode).maxBytes, hostSourceBytesDeps(resolve, deps.client), perCall);
            if (!stampMatches(record.stamp, stamp))
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