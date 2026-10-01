/**
 * The `zotero_changes` domain: baseline version readings and `?since=` diffs
 * over the versions-format endpoints, with tombstones from /deleted. A kind
 * this Zotero build cannot serve (or cannot serve for the requested range)
 * degrades to absence — and is named, with the reason, in `unobservable` —
 * instead of failing the whole read.
 *
 * Every versions resource is read unbounded (no `limit`): the local API
 * returns the whole changed set for such a request, which is what lets the
 * version the response reports be a cursor a caller may resume from, while
 * `maxChangesResults` only shortens the listings the model sees.
 *
 * The item space is read as the API itself partitions it: `/items` (live
 * items), `/items/top` (their top-level subset) and `/items/trash` (the
 * trash). Zotero keeps child objects — notes, attachments, annotations — as
 * items with versions of their own, and excludes the trash from its item
 * listings, so a diff over `/items/top` alone would report a version advance
 * whose changes it never mentioned: editing one annotation moves the library
 * version without touching any top-level item. Top-level items are the
 * top-level read, child objects are the difference between the two live
 * reads, and the trash is its own listing.
 *
 * A cursor is more than a number: it carries the instance and the library it
 * describes. The claim travels with every request (`Zotero-Server-ID`), so a
 * cursor from another database is rejected by the server rather than silently
 * diffing this one's counter, and the library is checked before the first
 * read. The cursor is handed back only when the whole range was read, the
 * library version did not move during the fan-out, and the answering instance
 * is known — otherwise the caller must not advance at all.
 * @module dsh-zotero/local/changes-domain
 */
import { SERVER_MISMATCH_MESSAGE, ZOTERO_INVALID_ARGUMENT, ZOTERO_SERVER_MISMATCH, isNotFoundError, isRangeUnsupportedError, } from '../errors.js';
import { asRecord, isNonNegativeSafeInteger, isObjectKey, parseNonNegativeSafeInteger, } from '../json.js';
import { libraryPrefix, PERSONAL_LIBRARY, sameLibrary } from '../refs.js';
import { ZoteroError } from '../errors.js';
/**
 * The kinds a diff covers when the caller names none. `fulltext` is left out
 * on purpose: `/fulltext?since=` filters on `fulltextItems.version`, a counter
 * of its own (`fulltext_<libraryID>`, see Zotero's `fulltext.js`), not on the
 * library version — live-checked at Zotero 10.0.2-beta.9, where `since=0` and
 * `since=<library version>` return the same rows, and the endpoint sends no
 * version header of its own. Such rows cannot be part of a library-version
 * delta, so they are only read when a caller asks for them explicitly.
 */
export const DEFAULT_CHANGES_INCLUDES = [
    'items',
    'collections',
    'savedSearches',
    'deleted',
];
/** Canonical order for the coverage carried by a cursor. */
export const ALL_CHANGES_INCLUDES = [
    'items',
    'collections',
    'savedSearches',
    'fulltext',
    'deleted',
];
function orderedIncludes(include) {
    return ALL_CHANGES_INCLUDES.filter((kind) => include.has(kind));
}
/** The tombstone payload's documented lists; anything else is counted, not read. */
const TOMBSTONE_LISTS = ['items', 'collections', 'searches', 'tags'];
/** A non-negative safe-integer header reading, or undefined when absent or malformed. */
function numericHeader(headers, name) {
    return parseNonNegativeSafeInteger(headers.get(name));
}
/** True for a version counter reading: a non-negative safe integer, never a string. */
function isVersion(value) {
    return isNonNegativeSafeInteger(value);
}
/** `user/0` or `group/42`, the way the model names a library. */
function libraryLabel(library) {
    return `${library.type}/${String(library.id)}`;
}
/**
 * The model-facing message for a cursor minted in one library and passed to a
 * diff of another. A version counter is a per-library transaction count, so
 * the two numbers are unrelated and no response would reveal the mix-up.
 */
export function cursorLibraryMismatchMessage(cursorLibrary, requestLibrary) {
    return `This cursor belongs to ${cursorLibrary}, but the call diffs ${requestLibrary}. A library version is only meaningful in the library it came from — diff that library, or take a baseline reading here.`;
}
/** A response identity is usable only when it is a non-blank string. */
function observedServerId(value) {
    return value !== null && value !== undefined && value.trim() !== '' ? value : undefined;
}
/** The cursor for `version`, or undefined when there is no instance to pin it to. */
function cursorFor(serverId, library, version, include) {
    const id = observedServerId(serverId);
    return id === undefined || version === undefined
        ? undefined
        : { serverId: id, library, version, include: orderedIncludes(include) };
}
/**
 * Assert a response came from the instance this call is pinned to. The request
 * carries the claim, so the server refuses a foreign database first (412);
 * this is the second half of the same invariant — a result never mixes
 * databases, even if a build were to ignore the request header. A response
 * that names no instance leaves the claim as the call's identity.
 */
function assertSameInstance(observed, expected) {
    if (observed !== undefined && observed !== expected) {
        throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
    }
}
/**
 * Resolve the trash partition, falling back when the build does not serve
 * `/items/trash`. Official Zotero Syncing standard: query `/items` with
 * `includeTrashed=1` and diff against the live listing. Completeness is the
 * conjunction of both whole reads — a capped half cannot vouch for the
 * derived split. Any other failure (or a failed fallback) returns the
 * original read so the caller records one verdict for the item space.
 */
async function resolveTrashRead(readResource, prefix, signal, live, initialTrash) {
    if (initialTrash.status !== 'failed' || initialTrash.reason !== 'not-served') {
        return initialTrash;
    }
    if (live.status !== 'ok')
        return initialTrash;
    const allRead = await readResource(`${prefix}/items`, true, signal, { includeTrashed: true });
    if (allRead.status !== 'ok')
        return initialTrash;
    const liveKeys = new Set(live.value.entries.map((entry) => entry.key));
    const trashEntries = allRead.value.entries.filter((entry) => !liveKeys.has(entry.key));
    return {
        status: 'ok',
        value: {
            entries: trashEntries,
            total: trashEntries.length,
            complete: allRead.value.complete && live.value.complete,
            ...(allRead.value.serverId !== undefined ? { serverId: allRead.value.serverId } : {}),
            ...(allRead.value.version !== undefined ? { version: allRead.value.version } : {}),
        },
    };
}
/**
 * Diff the library against a local transaction version. On the verified build
 * (Zotero 10.0.2-beta.9) versions are local transactions: every object save
 * advances the library's counter and stamps the object, so `?since=` answers
 * "what changed here" without the cloud and without a background watcher. The
 * domain never assumes that from a build number — no response header names the
 * build, and one that reports no library version is reported as
 * `versionUnavailable` instead. Without `since` this is a baseline reading —
 * just the current version for the next call to diff from. `format=versions`
 * responses are key→version maps; `/deleted` returns tombstone key lists.
 * Each listing is capped at `maxChangesResults` entries with its true count
 * in `totals` and an honest `truncated` flag.
 */
export async function changes(deps, request, signal, onProgress) {
    const library = request.library ?? PERSONAL_LIBRARY;
    const prefix = libraryPrefix(library);
    const cap = deps.limits.maxChangesResults;
    const include = request.include ?? new Set(DEFAULT_CHANGES_INCLUDES);
    if (include.size === 0) {
        throw new ZoteroError('include must list at least one resource kind', ZOTERO_INVALID_ARGUMENT);
    }
    const since = request.since;
    // A version is a counter of one library's transactions, so a cursor only
    // means something in the library it came from. The instance claim is
    // checked with the server (below); the library claim is checked here, before
    // any request, because no response would reveal the mix-up.
    if (since !== undefined && !sameLibrary(since.library, library)) {
        throw new ZoteroError(cursorLibraryMismatchMessage(libraryLabel(since.library), libraryLabel(library)), ZOTERO_INVALID_ARGUMENT);
    }
    if (since !== undefined && observedServerId(since.serverId) === undefined) {
        throw new ZoteroError('since.serverId must be a non-blank instance id', ZOTERO_INVALID_ARGUMENT);
    }
    if (since !== undefined) {
        const coverage = since.include;
        if (!Array.isArray(coverage) ||
            coverage.length === 0 ||
            coverage.some((kind) => !ALL_CHANGES_INCLUDES.includes(kind)) ||
            new Set(coverage).size !== coverage.length) {
            throw new ZoteroError('since.include must list the resource kinds covered by the cursor', ZOTERO_INVALID_ARGUMENT);
        }
        const cursorInclude = new Set(coverage);
        for (const kind of include) {
            if (!cursorInclude.has(kind)) {
                throw new ZoteroError(`since.include does not cover requested resource kind '${kind}'`, ZOTERO_INVALID_ARGUMENT);
            }
        }
    }
    const unobservable = [];
    const changed = {};
    const totals = {};
    let truncated = false;
    /**
     * Run a read that the local API can answer with "not here": 404 for an
     * endpoint this build does not serve, 409 for one whose history does not
     * reach back to the requested version (the documented answer for a `since`
     * older than the tombstone log). Both are facts about the range, not faults,
     * and both mean the kind contributed nothing to this diff; every other
     * failure is a real fault and propagates.
     */
    const attempt = async (run) => {
        try {
            return { status: 'ok', value: await run() };
        }
        catch (error) {
            if (isNotFoundError(error))
                return { status: 'failed', reason: 'not-served' };
            if (isRangeUnsupportedError(error))
                return { status: 'failed', reason: 'range-not-covered' };
            throw error;
        }
    };
    /** The display listing for one read: at most `cap` rows, with the cap noted. */
    const display = (rows) => {
        if (rows.length > cap)
            truncated = true;
        return rows.slice(0, cap);
    };
    /**
     * The library's current transaction version, read before any resource so
     * the fan-out can be pinned to one snapshot. Only the headers matter, so
     * the probe itself asks for a single row; `claim` travels as the request's
     * instance header, which is how the server gets to refuse a foreign one.
     */
    const probeVersion = async (claim) => {
        const params = new URLSearchParams();
        params.set('limit', '1');
        const response = await deps.client.get(`${prefix}/items/top`, params, {
            signal,
            ...(claim === undefined ? {} : { serverId: claim }),
        });
        const version = numericHeader(response.headers, 'last-modified-version');
        const observed = observedServerId(response.headers.get('zotero-server-id'));
        return {
            ...(version !== undefined ? { version } : {}),
            ...(observed !== undefined ? { serverId: observed } : {}),
        };
    };
    if (since === undefined) {
        onProgress?.({ phase: 'baseline', message: 'Reading library baseline version...' });
        // A baseline is one reading: the version a later call diffs from. A build
        // that reports none — no items read, or no version header on it — has no
        // changes story to tell, and the result says so rather than handing back a
        // cursor pinned to nothing.
        const probe = await attempt(() => probeVersion());
        const observed = probe.status === 'ok' ? probe.value.serverId : undefined;
        const version = probe.status === 'ok' ? probe.value.version : undefined;
        const cursor = cursorFor(observed, library, version, include);
        return {
            library,
            ...(observed !== undefined ? { serverId: observed } : {}),
            // A baseline mints the cursor the next call diffs from. Without a
            // version, or without an instance to pin it to, there is nothing this
            // call can hand back — a cursor-less result is the honest answer.
            ...(cursor !== undefined ? { cursor } : {}),
            ...(version === undefined ? { versionUnavailable: true } : {}),
            changed: {},
        };
    }
    // The cursor's instance is this call's identity: every request carries it,
    // and every response has to confirm it (below).
    const instance = since.serverId;
    onProgress?.({
        phase: 'probe',
        message: `Probing library version since ${since.version}...`,
    });
    // The version this diff is pinned to. Every array resource reports the
    // library's *current* version in `Last-Modified-Version` — not the newest
    // version on its page — so any other reading means a write landed while this
    // call was reading, and the range cannot be attributed to one version.
    const probe = await attempt(() => probeVersion(instance));
    const probeValue = probe.status === 'ok' ? probe.value : undefined;
    assertSameInstance(probeValue?.serverId, instance);
    const snapshot = probeValue?.version;
    let complete = snapshot !== undefined;
    let libraryChanged = false;
    /**
     * Read one versions resource whole. `Total-Results` counts the matched
     * objects before any listing cap, so a map carrying fewer keys than the
     * header promises means this build capped the response and the read is not
     * the whole range. Without the header the unbounded request is trusted to be
     * whole — a short page is complete, and nothing more is knowable here.
     *
     * A body that is not a key→version map is a different matter: it is not a
     * short answer but an unreadable one, so it is reported as such (no listing,
     * no count, nothing for the cursor to certify) instead of being read as
     * "nothing changed".
     */
    const readResource = async (path, versioned = true, requestSignal = signal, options) => {
        const payload = await attempt(async () => {
            const params = new URLSearchParams();
            params.set('since', String(since.version));
            params.set('format', 'versions');
            if (options?.includeTrashed) {
                params.set('includeTrashed', '1');
            }
            // Deliberately no `limit`: the local API answers an unbounded request in
            // full, and a capped read could not be resumed (the API has no version
            // upper bound, and the reported version would already sit past the rows
            // the cap hid).
            return await deps.client.getJson(path, params, {
                signal: requestSignal,
                serverId: instance,
            });
        });
        if (payload.status === 'failed')
            return payload;
        const { json, headers } = payload.value;
        const map = asRecord(json);
        const rows = map === undefined ? undefined : Object.entries(map);
        if (rows === undefined || !rows.every(([key, value]) => isObjectKey(key) && isVersion(value))) {
            return { status: 'failed', reason: 'unreadable' };
        }
        const observed = observedServerId(headers.get('zotero-server-id'));
        const rawTotal = headers.get('total-results');
        const headerTotal = numericHeader(headers, 'total-results');
        const rawVersion = headers.get('last-modified-version');
        const version = numericHeader(headers, 'last-modified-version');
        if (rawTotal !== null && headerTotal === undefined) {
            return { status: 'failed', reason: 'unreadable' };
        }
        if (rawVersion !== null && version === undefined) {
            return { status: 'failed', reason: 'unreadable' };
        }
        if (headerTotal !== undefined && headerTotal < rows.length) {
            return { status: 'failed', reason: 'unreadable' };
        }
        if (versioned && version === undefined) {
            return { status: 'failed', reason: 'unreadable' };
        }
        return {
            status: 'ok',
            value: {
                entries: rows
                    .map(([key, value]) => ({ key, version: value }))
                    .sort((a, b) => b.version - a.version || a.key.localeCompare(b.key)),
                total: headerTotal ?? rows.length,
                // A shape we cannot read is not a shape we can vouch for, so the
                // header check only speaks once the body was readable.
                complete: headerTotal === undefined || headerTotal === rows.length,
                ...(observed !== undefined ? { serverId: observed } : {}),
                ...(version !== undefined ? { version } : {}),
            },
        };
    };
    /**
     * Record a kind this call could not observe — once per kind, which is what
     * every caller does: a kind whose endpoint is read more than once (the item
     * space) collapses its reads to one verdict before calling this. An
     * unreadable read also withholds the cursor: unlike a missing endpoint, the
     * rows exist and this call failed to read them, so advancing would step over
     * them.
     */
    const recordUnobservable = (kind, reason) => {
        unobservable.push({ kind, reason });
        if (reason === 'unreadable')
            complete = false;
    };
    /**
     * Fold one successful read into the call: assert the answering instance,
     * fold its completeness and snapshot reading in, and keep its true count.
     */
    const foldRead = (page, versioned = true) => {
        assertSameInstance(page.serverId, instance);
        if (versioned &&
            snapshot !== undefined &&
            page.version !== undefined &&
            page.version !== snapshot) {
            // A write landed while this call was reading, so no single version
            // describes the range this result reports.
            libraryChanged = true;
            complete = false;
        }
        complete = complete && page.complete;
    };
    /** Read one single-endpoint kind into its listing, its count, or its absence. */
    const readKind = async (kind, path, totalKey, versioned = true) => {
        const read = await readResource(path, versioned);
        if (read.status === 'failed') {
            recordUnobservable(kind, read.reason);
            return undefined;
        }
        foldRead(read.value, versioned);
        totals[totalKey] = read.value.total;
        return display(read.value.entries);
    };
    if (include.has('items')) {
        onProgress?.({
            phase: 'items',
            message: 'Reading items partitions (/items, /items/top, /items/trash)...',
        });
        // The item space in the API's own three reads. All three are needed for
        // the partition: without the top-level read no key can be told from a
        // child object, and without the trash read a trashing would advance the
        // library version invisibly (item listings exclude the trash). A build
        // that serves only some of these reads leaves the kind unobservable as a
        // whole rather than reporting a slice of the item space as the item space.
        const itemController = new AbortController();
        const forwardAbort = itemController.abort.bind(itemController);
        signal?.addEventListener('abort', forwardAbort, { once: true });
        // An abort event is not replayed. If cancellation happened after the probe
        // resolved but before this fan-out attached its listener, propagate the
        // already-aborted state explicitly instead of starting three live reads.
        if (signal?.aborted)
            forwardAbort();
        let settled;
        let firstFailure;
        try {
            const reads = [
                readResource(`${prefix}/items`, true, itemController.signal),
                readResource(`${prefix}/items/top`, true, itemController.signal),
                readResource(`${prefix}/items/trash`, true, itemController.signal),
            ].map((read) => read.catch((error) => {
                // Preserve the failure that caused the sibling abort. Promise
                // allSettled is ordered by input, not settlement time, so selecting
                // its first rejected entry would turn a real 500/timeout into the
                // sibling's later TOOL_ABORTED.
                firstFailure ??= { error };
                itemController.abort();
                throw error;
            }));
            settled = await Promise.allSettled(reads);
        }
        finally {
            signal?.removeEventListener('abort', forwardAbort);
        }
        if (firstFailure !== undefined)
            throw firstFailure.error;
        const [live, top, initialTrash] = settled.map((result) => result.value);
        const trash = await resolveTrashRead(readResource, prefix, signal, live, initialTrash);
        if (live.status === 'ok' && top.status === 'ok' && trash.status === 'ok') {
            foldRead(live.value);
            foldRead(top.value);
            foldRead(trash.value);
            // The top-level listing is useful even when the build capped it, but a
            // child list computed as `live - top` is not: a missing top-level key
            // would be indistinguishable from a child object. Keep the independent
            // top/trash digests, and withhold only the derived child split unless
            // both whole reads prove it.
            changed.items = display(top.value.entries);
            changed.trashedItems = display(trash.value.entries);
            totals.items = top.value.total;
            totals.trashedItems = trash.value.total;
            if (live.value.complete && top.value.complete) {
                const topKeys = new Set(top.value.entries.map((entry) => entry.key));
                const childEntries = live.value.entries.filter((entry) => !topKeys.has(entry.key));
                changed.childItems = display(childEntries);
                // The split is a difference of two whole reads of one range, so it is
                // the true count whenever neither read was capped.
                totals.childItems = childEntries.length;
            }
        }
        else {
            complete = false;
            // The conjunction above failed, so one of the three carries the reason;
            // the kind is named once. Prefer an unreadable partition over a merely
            // absent/range-limited one: it is the actionable diagnosis and avoids
            // reporting `not-served` when a sibling did answer malformed data.
            const failed = [live, top, trash].filter((read) => read.status === 'failed');
            const reason = failed.find((read) => read.reason === 'unreadable')?.reason ?? failed[0]?.reason;
            if (reason !== undefined)
                recordUnobservable('items', reason);
        }
    }
    if (include.has('collections')) {
        onProgress?.({ phase: 'collections', message: 'Reading changed collections...' });
        const entries = await readKind('collections', `${prefix}/collections`, 'collections');
        if (entries !== undefined)
            changed.collections = entries;
    }
    if (include.has('savedSearches')) {
        onProgress?.({ phase: 'savedSearches', message: 'Reading changed saved searches...' });
        const entries = await readKind('savedSearches', `${prefix}/searches`, 'savedSearches');
        if (entries !== undefined)
            changed.savedSearches = entries;
    }
    if (include.has('fulltext')) {
        onProgress?.({ phase: 'fulltext', message: 'Reading reindexed full text...' });
        // The index listing, read only when asked for: unbounded and unversioned,
        // it answers in the full-text counter's own namespace, so its rows are a
        // listing for this library version rather than a delta on it.
        const entries = await readKind('fulltext', `${prefix}/fulltext`, 'fulltextAttachments', false);
        if (entries !== undefined)
            changed.fulltextAttachments = entries;
    }
    /**
     * Parse the tombstone payload. Zotero documents four lists — items,
     * collections, searches, tags — and its own sync reader walks whichever keys
     * the response carries, so a list the payload omits means "nothing of that
     * kind was removed", while a payload that is not the documented shape is
     * unreadable: removals are then unknown, never zero. Keys outside the
     * documented four (Zotero also syncs a list of settings) are counted in
     * `deletedOther` so nothing the response carried is dropped in silence.
     */
    const parseTombstones = (json) => {
        const record = asRecord(json);
        if (record === undefined)
            return undefined;
        /** One documented list: absent means empty, anything else has to be strings. */
        const strings = (field) => {
            const value = record[field];
            if (value === undefined)
                return [];
            if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
                return undefined;
            }
            return value;
        };
        const keys = (field) => {
            const list = strings(field);
            return list === undefined || list.some((key) => !isObjectKey(key)) ? undefined : list;
        };
        const items = keys('items');
        const collections = keys('collections');
        const savedSearches = keys('searches');
        // Tag names are not object keys; a blank one would be an entry the model
        // cannot act on, so it counts as a malformed payload like any other.
        const tags = strings('tags');
        if (items === undefined ||
            collections === undefined ||
            savedSearches === undefined ||
            tags === undefined ||
            tags.some((tag) => tag.trim() === '')) {
            return undefined;
        }
        let other = 0;
        for (const [field, value] of Object.entries(record)) {
            if (TOMBSTONE_LISTS.includes(field))
                continue;
            if (Array.isArray(value))
                other += value.length;
        }
        return { items, collections, savedSearches, tags, other };
    };
    // When the tombstone read succeeds every list exists, possibly empty — the
    // positive statement "nothing was removed in this range", which is why it is
    // never omitted for brevity. The endpoint carries no version of its own, so
    // it can never make the read incomplete: it only shortens what is listed.
    let deleted;
    if (include.has('deleted')) {
        onProgress?.({ phase: 'deleted', message: 'Reading deleted tombstones...' });
        const read = await attempt(async () => {
            const params = new URLSearchParams();
            params.set('since', String(since.version));
            const payload = await deps.client.getJson(`${prefix}/deleted`, params, {
                signal,
                serverId: instance,
            });
            assertSameInstance(observedServerId(payload.headers.get('zotero-server-id')), instance);
            return parseTombstones(payload.json);
        });
        const tombstones = read.status === 'ok' ? read.value : undefined;
        if (read.status === 'failed') {
            recordUnobservable('deleted', read.reason);
        }
        else if (tombstones === undefined) {
            recordUnobservable('deleted', 'unreadable');
        }
        else {
            deleted = {
                items: display(tombstones.items),
                collections: display(tombstones.collections),
                savedSearches: display(tombstones.savedSearches),
                tags: display(tombstones.tags),
            };
            totals.deletedItems = tombstones.items.length;
            totals.deletedCollections = tombstones.collections.length;
            totals.deletedSavedSearches = tombstones.savedSearches.length;
            totals.deletedTags = tombstones.tags.length;
            if (tombstones.other > 0)
                totals.deletedOther = tombstones.other;
        }
    }
    const served = Object.keys(totals).length > 0;
    // The next cursor is the snapshot reading, pinned to the instance that
    // answered. Every served resource was read whole (or the call would not be
    // complete) and none reported another version, so this cursor covers the
    // entire range the result reports — and only this library on this instance.
    // Fulltext has an independent counter, so a library cursor cannot safely
    // resume a result that mixes its rows with versioned library resources.
    const cursor = complete && !include.has('fulltext')
        ? cursorFor(instance, library, snapshot, include)
        : undefined;
    onProgress?.({
        phase: 'done',
        message: `Changes reading completed at version ${snapshot ?? since.version}`,
    });
    return {
        library,
        serverId: instance,
        fromVersion: since.version,
        ...(cursor !== undefined ? { cursor } : {}),
        ...(libraryChanged ? { libraryChanged } : {}),
        ...(snapshot === undefined ? { versionUnavailable: true } : {}),
        changed,
        ...(deleted !== undefined ? { deleted } : {}),
        ...(served ? { totals } : {}),
        ...(unobservable.length > 0 ? { unobservable } : {}),
        ...(truncated ? { truncated } : {}),
    };
}
//# sourceMappingURL=changes-domain.js.map