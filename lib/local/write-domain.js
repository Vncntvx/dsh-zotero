/**
 * The core item write domain: item creation/update plus the shared identity,
 * authorization, and versioned-write primitives used by the focused note,
 * collection, list, batch, and maintenance modules. Every write follows the
 * lifecycle the Zotero 10 protocol implies:
 *
 * - the target is always the personal library (`users/0`); a ref naming a
 *   group or a foreign user id is refused before any network happens;
 * - the serving instance id is established (and pinned) before any read or
 *   write, because every write must carry `Zotero-Server-ID`;
 * - the API key comes from {@link WriteAuthorizer}, and a 401 replays the
 *   same request exactly once after a fresh authorization: single-use keys
 *   are consumed at authentication time, so a burned key is forgotten;
 * - tag, collection-membership, and scalar updates are read-merge-write under
 *   an `If-Unmodified-Since-Version` precondition: PATCH replaces arrays
 *   wholesale, so the merged list must be sent whole;
 * - collection and tag deletes carry the library version of their preceding
 *   read; item Trash PATCHes carry each object's version while processing its
 *   complete child graph, so concurrent changes fail closed;
 * - one object per batch means a Zotero refusal surfaces as a typed error,
 *   never as a silently skipped entry in a bucket.
 *
 * There is no retry beyond the re-authorization replay, and a version
 * conflict (412) is reported as `ZOTERO_WRITE_CONFLICT` for the model to
 * re-run: the tool re-reads and reapplies on top of what is there now.
 * Non-idempotent creates (note, item, collection) never retry: an unprovable
 * commit surfaces as `committed-unverified` with `retryable: false`.
 * @module dsh-zotero/local/write-domain
 */
import { ZOTERO_LIBRARY_VERSION_HEADER } from '../constants.js';
import { WRITE_IDENTITY_UNSUPPORTED_MESSAGE, WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE, WRITE_ITEM_TYPE_MISSING_MESSAGE, WRITE_VERSION_MISSING_MESSAGE, writeFieldNotForItemTypeMessage, writeObjectStateMissingMessage, requireNonBlank, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZOTERO_WRITE_UNAUTHORIZED, ZoteroError, } from '../errors.js';
import { asRecord, asString, isNonNegativeSafeInteger, isObjectKey, parseNonNegativeSafeInteger, } from '../json.js';
import { formatRef, isRefString, libraryPrefix, parseRef, PERSONAL_LIBRARY, requireSupportedLocalRef, requireWritableRef, } from '../refs.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { normalizeCreator, requireCreatableItemType, requireTitleOrUrl, validateItemUpdateFields, wireFieldOf, } from '../write-item-rules.js';
import { settleCreate } from './write-verdicts.js';
export function tagState(data) {
    const tags = tagsOf(data);
    if (data.tags === undefined || tags === undefined)
        throw new ZoteroError(writeObjectStateMissingMessage('tags'), ZOTERO_UNEXPECTED);
    return { tags };
}
export function collectionState(data) {
    if (typeof data.parentItem === 'string' && data.parentItem !== '') {
        throw new ZoteroError('Child items inherit collection membership from their parent; update the parent instead.', ZOTERO_INVALID_ARGUMENT);
    }
    const collectionKeys = strictCollectionKeysOf(data);
    if (data.collections === undefined || collectionKeys === undefined)
        throw new ZoteroError(writeObjectStateMissingMessage('collections'), ZOTERO_UNEXPECTED);
    return { collectionKeys };
}
/** True when the error is Zotero refusing the write for a missing or consumed key. */
export function isWriteUnauthorized(error) {
    return error instanceof ZoteroError && error.code === ZOTERO_WRITE_UNAUTHORIZED;
}
/**
 * The one legitimate write replay: authorize, send once; on a 401 forget the
 * key (single-use keys are consumed at authentication, and a stored grant may
 * have been revoked), authorize again, send the identical request once more.
 * A second 401 escalates with the after-authorization guidance; a one-time
 * key is always forgotten once its write settles, consumed either way.
 */
export async function withWriteKey(deps, serverId, signal, send) {
    const first = await deps.authorizer.keyFor(serverId, signal);
    try {
        return await send(first.key);
    }
    catch (error) {
        if (!isWriteUnauthorized(error))
            throw error;
        await deps.authorizer.invalidate(serverId, first.key);
        const second = await deps.authorizer.keyFor(serverId, signal);
        try {
            return await send(second.key);
        }
        catch (retried) {
            if (isWriteUnauthorized(retried)) {
                await deps.authorizer.invalidate(serverId, second.key);
                throw new ZoteroError(WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED, {
                    cause: retried,
                });
            }
            throw retried;
        }
        finally {
            if (second.oneTime)
                deps.authorizer.forget(second.key);
        }
    }
    finally {
        if (first.oneTime)
            deps.authorizer.forget(first.key);
    }
}
/**
 * The instance id every write must carry. The read client remembers it from
 * the latest response; when this process has read nothing yet, one probe of
 * `/api/` establishes it. A build that reports no instance id has no local
 * write protocol to talk to.
 */
export async function ensureServerId(deps, signal) {
    const remembered = deps.client.serverId;
    if (remembered !== undefined)
        return remembered;
    await deps.client.get('', undefined, { signal });
    const id = deps.client.serverId;
    if (id === undefined) {
        throw new ZoteroError(WRITE_IDENTITY_UNSUPPORTED_MESSAGE, ZOTERO_UNEXPECTED);
    }
    return id;
}
/** Refuse a qualified ref that names another Zotero instance before any write. */
export function requireWritableRefAtServer(ref, kinds, serverId) {
    const checked = requireWritableRef(ref, kinds);
    assertServerIdMatches(ref.serverId, serverId);
    return checked;
}
/** Refuse a qualified ref that names another Zotero instance before citing as relation source. */
export function requireSupportedRefAtServer(ref, kinds, serverId) {
    const checked = requireSupportedLocalRef(ref, kinds);
    assertServerIdMatches(ref.serverId, serverId);
    return checked;
}
export function normalizeWriteList(name, values) {
    return [...new Set(values.map((value) => requireNonBlank(name, value)))];
}
/** Validate a ref-shaped collection argument locally; names remain live lookups. */
export function normalizeCollectionInput(name, value) {
    const collection = requireNonBlank(name, value);
    if (isRefString(collection))
        requireWritableRef(parseRef(collection), ['collection']);
    return collection;
}
/**
 * Merge string lists: `merged = (existing − remove) ∪ (add − existing)`.
 * Order is existing-first, then genuinely new additions in request order;
 * duplicates collapse. `added`/`removed` name the actual changes, not the
 * request, and `changed` is false exactly when nothing would move.
 */
export function mergeList(existing, remove, add) {
    const existingSet = new Set(existing);
    const removeSet = new Set(remove);
    const remaining = existing.filter((entry) => !removeSet.has(entry));
    const seen = new Set(remaining);
    const merged = [...remaining];
    const added = [];
    for (const entry of add) {
        // (add − existing): an entry already present is not an addition, even when
        // it was also removed; the removal wins for saved entries.
        if (existingSet.has(entry))
            continue;
        if (seen.has(entry))
            continue;
        seen.add(entry);
        merged.push(entry);
        added.push(entry);
    }
    const mergedSet = new Set(merged);
    const removed = existing.filter((entry) => !mergedSet.has(entry));
    // Deduplicate the removed report while preserving first-seen order; the
    // existing list itself should hold no duplicates, but a malformed saved
    // state must not report one removal twice.
    const dedupedRemoved = [...new Set(removed)];
    return {
        merged,
        added,
        removed: dedupedRemoved,
        changed: added.length > 0 || dedupedRemoved.length > 0,
    };
}
/**
 * Merge tag entries, preserving each retained tag's type. New tags carry no
 * type; removed tags are gone. Shape mirrors {@link mergeList} for the
 * collection and tag tools to share one semantic.
 */
export function mergeTagList(existing, remove, add) {
    const names = existing.map((entry) => entry.tag);
    const { merged, added, removed, changed } = mergeList(names, remove, add);
    const typeOf = new Map(existing.map((entry) => [entry.tag, entry.type]));
    return {
        merged: merged.map((tag) => {
            const type = typeOf.get(tag);
            return type === undefined ? { tag } : { tag, type };
        }),
        added,
        removed,
        changed,
    };
}
/**
 * Read one item's write-relevant state, pinning the read to the instance the
 * write will target. Only the operation's reader requires list state;
 * child items legitimately omit collections in Zotero's JSON.
 */
async function readItem(deps, ref, serverId, readState, signal) {
    const { json, headers } = await deps.client.getJson(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`, undefined, { signal, serverId });
    const record = asRecord(json);
    const version = isNonNegativeSafeInteger(record?.version) ? record.version : undefined;
    if (version === undefined) {
        throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
    }
    const data = asRecord(record?.data);
    const responseKey = asString(record?.key);
    const dataKey = asString(data?.key);
    if (data === undefined || responseKey !== ref.key || dataKey !== ref.key) {
        throw new ZoteroError(`Zotero answered the write read with a different item than ${ref.key}; the response cannot be used for this write.`, ZOTERO_UNEXPECTED);
    }
    const itemType = asString(data?.itemType);
    if (itemType === undefined || itemType === '') {
        throw new ZoteroError(WRITE_ITEM_TYPE_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
    }
    const observedServerId = serverIdFromHeaders(headers);
    assertServerIdMatches(observedServerId, serverId);
    return {
        ...readState(data),
        version,
        itemType,
        serverId: observedServerId ?? serverId,
    };
}
/**
 * Read one collection or saved search under the instance pin and prove the
 * object version its update must carry. Deletes additionally use the library
 * version this same read reports as their precondition, so any concurrent
 * write fails the delete instead of slipping past it.
 */
export async function readRecordForWrite(deps, object, key, serverId, signal) {
    const segment = object === 'collection' ? 'collections' : 'searches';
    const { json, headers } = await deps.client.getJson(`${libraryPrefix(PERSONAL_LIBRARY)}/${segment}/${key}`, undefined, { signal, serverId });
    const record = asRecord(json);
    const data = asRecord(record?.data);
    const version = isNonNegativeSafeInteger(record?.version) ? record.version : undefined;
    if (version === undefined) {
        throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
    }
    if (asString(record?.key) !== key || asString(data?.key) !== key) {
        throw new ZoteroError(`Zotero answered the write read with a different ${object} than ${key}; the response cannot be used for this write.`, ZOTERO_UNEXPECTED);
    }
    const observed = serverIdFromHeaders(headers);
    assertServerIdMatches(observed, serverId);
    return {
        data,
        version,
        libraryVersion: parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER)),
        serverId: observed ?? serverId,
    };
}
/** The delete paths cannot proceed without the library version their read reported. */
export function requireLibraryVersion(libraryVersion) {
    if (libraryVersion === undefined) {
        throw new ZoteroError(WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, ZOTERO_UNEXPECTED);
    }
    return libraryVersion;
}
/** Parse a saved tag array strictly; undefined means malformed, absent means empty. */
export function tagsOf(data) {
    const raw = data?.tags;
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        return undefined;
    const entries = [];
    for (const row of raw) {
        const record = asRecord(row);
        const tag = record === undefined ? asString(row) : asString(record.tag);
        if (tag === undefined || tag.trim() === '')
            return undefined;
        const type = record?.type;
        if (type !== undefined && !isNonNegativeSafeInteger(type))
            return undefined;
        entries.push(type === undefined ? { tag } : { tag, type });
    }
    return entries;
}
/** Parse a saved collection-key array strictly; undefined means malformed. */
export function strictCollectionKeysOf(data) {
    const raw = data?.collections;
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw) ||
        raw.some((entry) => typeof entry !== 'string' || !isObjectKey(entry))) {
        return undefined;
    }
    return raw;
}
import { collectionRef, itemRef } from './write-refs.js';
/**
 * The read-merge-write scaffold shared by every item update: pin the instance,
 * check the ref against it, read the item once, and hand the plan a snapshot
 * plus a `send` that carries the version precondition. The plan owns the merge
 * and the result shaping; an unchanged plan simply never calls `send`.
 */
async function withItemWrite(deps, item, signal, plan) {
    return await withItemStateWrite(deps, item, signal, () => ({}), plan);
}
/**
 * The same scaffold for plans that merge list state: the reader decides what
 * the snapshot must carry, and its result is the only place that state is
 * read, so a plan never guesses at a field the read did not prove.
 */
export async function withItemStateWrite(deps, item, signal, readState, plan) {
    const serverId = await ensureServerId(deps, signal);
    const ref = requireWritableRefAtServer(item, ['item'], serverId);
    const snapshot = await readItem(deps, ref, serverId, readState, signal);
    // The read pins the serving instance and always reports it, so the write
    // carries the identity the item was actually read under.
    const send = (body) => withWriteKey(deps, snapshot.serverId, signal, async (apiKey) => await deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`, body, {
        serverId: snapshot.serverId,
        apiKey,
        ifUnmodifiedSinceVersion: snapshot.version,
        signal,
    }));
    return await plan({
        snapshot,
        serverId: snapshot.serverId,
        resultRef: itemRef(ref.key, snapshot.serverId),
        send,
    });
}
export function normalizeCreateFields(raw, labels) {
    const itemType = requireCreatableItemType(requireNonBlank('itemType', raw.itemType));
    const title = raw.title?.trim() ?? '';
    const url = raw.url?.trim() ?? '';
    requireTitleOrUrl(title, url);
    const tags = normalizeWriteList('tags', raw.tags ?? []);
    const colInputs = (raw.collections ?? []).map((collection) => typeof collection === 'string'
        ? normalizeCollectionInput(labels.collections, collection)
        : formatRef(collection));
    const creators = (raw.creators ?? []).map((creator, index) => normalizeCreator(creator, index));
    return {
        itemType,
        title: title !== '' ? title : undefined,
        url: url !== '' ? url : undefined,
        date: raw.date?.trim() || undefined,
        doi: raw.doi?.trim() || undefined,
        abstractNote: raw.abstractNote?.trim() || undefined,
        publicationTitle: raw.publicationTitle?.trim() || undefined,
        creators: creators.length > 0 ? creators : undefined,
        tags,
        colInputs,
    };
}
export function createWireEntry(checked, collectionKeys) {
    return {
        itemType: checked.itemType,
        ...(checked.title !== undefined ? { title: checked.title } : {}),
        ...(checked.url !== undefined ? { url: checked.url } : {}),
        ...(checked.date !== undefined ? { date: checked.date } : {}),
        ...(checked.doi !== undefined ? { DOI: checked.doi } : {}),
        ...(checked.abstractNote !== undefined ? { abstractNote: checked.abstractNote } : {}),
        ...(checked.publicationTitle !== undefined
            ? { publicationTitle: checked.publicationTitle }
            : {}),
        ...(checked.creators !== undefined ? { creators: checked.creators } : {}),
        ...(checked.tags.length > 0 ? { tags: checked.tags.map((tag) => ({ tag })) } : {}),
        ...(collectionKeys.length > 0 ? { collections: collectionKeys } : {}),
    };
}
/**
 * Create a bibliographic item from the closed field set. No BibTeX/CSL-JSON
 * channel exists: `POST /items` only accepts Zotero item JSON, so the entry
 * is assembled field-by-field and anything outside the set never leaves this
 * module.
 */
export async function createItem(deps, request, signal) {
    const checked = normalizeCreateFields(request, { collections: 'collection' });
    const serverId = await ensureServerId(deps, signal);
    const collectionRefs = checked.colInputs.length > 0 ? await deps.resolveCollections(checked.colInputs, signal) : [];
    for (const ref of collectionRefs)
        requireWritableRefAtServer(ref, ['collection'], serverId);
    const entry = createWireEntry(checked, collectionRefs.map((ref) => ref.key));
    return await withWriteKey(deps, serverId, signal, async (apiKey) => {
        const proven = (data) => {
            if (asString(data.itemType) !== checked.itemType)
                return undefined;
            const savedTags = tagsOf(data);
            const savedCollections = strictCollectionKeysOf(data);
            if (savedTags === undefined || savedCollections === undefined)
                return undefined;
            return {
                savedTitle: asString(data.title),
                savedTags: savedTags.map((entry) => entry.tag),
                savedCollections: savedCollections.map((key) => collectionRef(key, serverId)),
            };
        };
        const settled = await settleCreate(deps, {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/items`,
            entry,
            serverId,
            apiKey,
            signal,
            kind: 'item',
        }, proven);
        if (settled.status === 'unverified')
            return settled.result;
        const { key, version, payload } = settled.entry;
        return {
            kind: 'applied',
            ref: itemRef(key, serverId),
            key,
            version,
            itemType: checked.itemType,
            // Saved state comes only from the echo. An echo that names no title
            // reports none: filling it from the request would claim a save the
            // response did not prove (the note-create rule, applied here too).
            ...(payload.savedTitle !== undefined ? { title: payload.savedTitle } : {}),
            tags: payload.savedTags,
            collections: payload.savedCollections,
            libraryVersion: settled.entry.libraryVersion,
            serverId,
        };
    });
}
/**
 * Update one item's scalar metadata. Every requested field must belong to the
 * closed set and be valid for the item's own type (checked against the
 * injected `itemTypeFields` reader); the PATCH then carries only wire names
 * under the version precondition. `creators`, `itemType`, `tags`, and
 * `collections` have their own tools and never enter here.
 */
export async function updateItem(deps, request, signal) {
    const localRef = requireWritableRef(request.item, ['item']);
    const updates = validateItemUpdateFields(request.set);
    return await withItemWrite(deps, localRef, signal, async ({ snapshot, serverId, resultRef, send }) => {
        const valid = await deps.itemTypeFields(snapshot.itemType, signal);
        const patch = {};
        const changed = [];
        for (const [field, value] of updates) {
            const wire = wireFieldOf(field);
            if (!valid.has(wire)) {
                throw new ZoteroError(writeFieldNotForItemTypeMessage(field, snapshot.itemType), ZOTERO_INVALID_ARGUMENT);
            }
            patch[wire] = value;
            changed.push(field);
        }
        changed.sort();
        const { libraryVersion } = await send(patch);
        return {
            kind: 'applied',
            ref: resultRef,
            version: libraryVersion,
            changed,
            libraryVersion,
            serverId,
        };
    });
}
/**
 * The typed error a write-capability-less provider raises. It is unreachable
 * through the service's capability gate, but the direct-provider contract
 * fails with the same code instead of crashing.
 */
export function writeCapabilityUnavailableMessage(providerId) {
    return `Zotero provider "${providerId}" does not support the write capability.`;
}
//# sourceMappingURL=write-domain.js.map