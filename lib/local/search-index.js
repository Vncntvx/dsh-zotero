/**
 * The filtered-search index: the host-side store behind the library panel's
 * year and attachment filters. The Local API cannot filter by year or by
 * attachment presence, so an exact answer requires reading every candidate
 * once; the index keeps that read's result (the ordered candidate keys) so
 * paging a filtered list costs one batched key lookup instead of a rescan.
 *
 * Two fences keep the served pages correct:
 * - `cacheGeneration`: the panel bumps its data generation on every refresh
 *   and post-write invalidation, and the key carries it, so a bumped
 *   generation rescans instead of serving the previous scan.
 * - `Last-Modified-Version`: a stored index remembers the library version its
 *   scan read through, and serving a page from it compares that version with
 *   the batch read's; any drift drops the index and rescans once.
 * The TTL bounds memory only; freshness is the version fence's job.
 * @module dsh-zotero/local/search-index
 */
import { asRecord, asString } from '../json.js';
import { LruTtlCache } from '../ttl-cache.js';
import { readPagesConcurrentlyFolded } from './pagination.js';
import { fetchItemKeyBatches } from './item-batch.js';
import { libraryPrefix } from '../refs.js';
import { normalizeSearchItem } from '../normalize-search.js';
import { sharedRead } from '../concurrency.js';
/** How many distinct filtered listings stay cached; the oldest insertion evicts. */
const FILTERED_INDEX_LIMIT = 4;
/** How many libraries' attachment parent sets stay cached. */
const ATTACHMENT_PARENTS_LIMIT = 2;
/** Memory bound for both caches. Freshness is the version fence's job. */
export const SEARCH_INDEX_TTL_MS = 30_000;
/** A scan has at most four live filter projections; WeakMap ownership follows its eviction. */
const filteredProjections = new WeakMap();
export function filteredCandidatesOf(index, request) {
    const key = JSON.stringify([request.yearFrom, request.yearTo, request.hasAttachment]);
    const projections = filteredProjections.get(index) ?? new Map();
    const cached = projections.get(key);
    if (cached !== undefined) {
        projections.delete(key);
        projections.set(key, cached);
        return cached;
    }
    const candidates = index.candidates.filter((candidate) => (request.yearFrom === undefined ||
        (candidate.year !== undefined && candidate.year >= request.yearFrom)) &&
        (request.yearTo === undefined ||
            (candidate.year !== undefined && candidate.year <= request.yearTo)) &&
        (request.hasAttachment === undefined || candidate.hasAttachment === request.hasAttachment));
    if (projections.size === 4)
        projections.delete(projections.keys().next().value);
    projections.set(key, candidates);
    filteredProjections.set(index, projections);
    return candidates;
}
export function createSearchIndexCaches() {
    return {
        filtered: new LruTtlCache(FILTERED_INDEX_LIMIT, SEARCH_INDEX_TTL_MS),
        attachmentParents: new LruTtlCache(ATTACHMENT_PARENTS_LIMIT, SEARCH_INDEX_TTL_MS),
        filteredInFlight: new Map(),
        attachmentParentsInFlight: new Map(),
    };
}
/**
 * The cache key of one filtered listing: every request field that can change
 * the accepted set or its order, plus the resolved scope and the panel's data
 * generation. A missing field would make two different filters share one
 * index.
 */
export function searchIndexKeyOf(scope, request, cacheGeneration) {
    return JSON.stringify({
        path: scope.path,
        resolved: scope.resolved,
        serverId: scope.serverId ?? null,
        query: request.query ?? '',
        mode: request.mode ?? 'metadata',
        sort: request.sort,
        direction: request.direction,
        itemLevel: request.itemLevel ?? 'top',
        itemTypes: [...(request.itemTypes ?? [])].sort(),
        tags: [...(request.tags ?? [])].sort(),
        tagMatch: request.tagMatch ?? 'all',
        excludeTags: [...(request.excludeTags ?? [])].sort(),
        includeTrashed: request.includeTrashed === true,
        attachmentPresenceScanned: request.hasAttachment !== undefined,
        cacheGeneration: cacheGeneration ?? 0,
    });
}
/**
 * The cache key of one attachment-presence walk. The walk's freshness is the
 * caller's version fence: the stored entry carries the version it read
 * through, and a hit whose version disagrees with the caller's scan is
 * dropped and re-read.
 */
export function attachmentParentsCacheKey(library, serverId, includeTrashed, cacheGeneration) {
    return JSON.stringify([library.type, library.id, serverId, includeTrashed, cacheGeneration ?? 0]);
}
/**
 * The parent keys of every attachment in one library. Existence filters need
 * the exact set — Zotero's "best attachment" choice cannot prove absence —
 * and one paginated `?itemType=attachment` walk answers every candidate,
 * instead of one `/children` probe per item.
 */
export async function attachmentParentKeys(deps, caches, library, serverId, includeTrashed, options) {
    const key = attachmentParentsCacheKey(library, serverId, includeTrashed, options.cacheGeneration);
    const cached = caches.attachmentParents.get(key);
    if (cached !== undefined) {
        return {
            parents: cached.parents,
            ...(cached.libraryVersion !== undefined ? { libraryVersion: cached.libraryVersion } : {}),
            fromCache: true,
        };
    }
    // Two listings in flight over the same library share one walk: the walk
    // reads every attachment page, and a panel refresh must not double it.
    const walked = await sharedRead({
        cache: caches.attachmentParents,
        inFlight: caches.attachmentParentsInFlight,
        keys: { flightKey: key, find: () => caches.attachmentParents.get(key), store: () => [key] },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        load: async (loadSignal) => {
            const initial = new URLSearchParams({ itemType: 'attachment' });
            if (includeTrashed)
                initial.set('includeTrashed', '1');
            const parents = new Set();
            const { libraryVersion } = await readPagesConcurrentlyFolded(deps.client, `${libraryPrefix(library)}/items`, initial, serverId, loadSignal, { body: 'attachment index', page: 'attachment index' }, options.concurrency ?? deps.limits.searchConcurrency, (rows) => {
                for (const row of rows) {
                    const parent = asString(asRecord(asRecord(row)?.data)?.parentItem);
                    if (parent !== undefined && parent !== '')
                        parents.add(parent);
                }
                return null;
            });
            return { parents, libraryVersion, fetchedAt: Date.now() };
        },
    });
    return {
        parents: walked.parents,
        ...(walked.libraryVersion !== undefined ? { libraryVersion: walked.libraryVersion } : {}),
        fromCache: false,
    };
}
/**
 * Fetch the item rows for exactly the requested keys, in chunked
 * `itemKey=` batches, and return them keyed by object key. Every batch keeps
 * the identity guard, and all batches must agree on the library version so a
 * page served from the index can be fenced against a stored scan.
 */
export async function searchRowsByKeys(deps, library, serverId, keys, includeTrashed, signal) {
    return await fetchItemKeyBatches(deps, library, keys, {
        ...(serverId !== undefined ? { serverId } : {}),
        includeTrashed,
        ...(signal !== undefined ? { signal } : {}),
        what: 'filtered search page',
        onMissingKey: 'throw',
        mapRow: (row) => normalizeSearchItem(row, { library, ...(serverId !== undefined ? { serverId } : {}) }),
    });
}
//# sourceMappingURL=search-index.js.map