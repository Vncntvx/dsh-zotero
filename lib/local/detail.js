/**
 * The `zotero_get` and `zotero_children` domain: one item's detail with its
 * lazily loaded child rows, and child-object exploration. Child rows are
 * shared with retrieve.
 *
 * Child objects ride two distinct Local API wire contracts
 * ({@link ./children-wire.ts}): a bare `/children` listing is notes and
 * attachments only; annotations appear solely under
 * `/children?itemType=annotation`. Callers name which halves they need.
 * @module dsh-zotero/local/detail
 */
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { asRecord, asString } from '../json.js';
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js';
import { ZOTERO_CHILD_PAGE_MAX_ROWS, ZOTERO_CHILD_PAGE_ROWS } from '../constants.js';
import { childCollection, normalizeItemDetail } from '../normalize-item-detail.js';
import { collectionKeysOf } from '../normalize-search.js';
import { attachmentRecordOf, partitionChildren } from '../normalize-children.js';
import { libraryPrefix, refStringFor, requireSupportedLocalRef } from '../refs.js';
import { fetchAnnotationChildren, fetchChildPage, fetchDirectChildren } from './children-wire.js';
const INCLUDE_ORDER = ['notes', 'annotations', 'attachments'];
/**
 * The model-facing message for an attachment ref whose target is another item
 * type. Annotations hang off attachments, so the model has to re-aim the ref.
 */
export function attachmentTargetKindMessage(itemType) {
    return `The referenced object is a ${itemType}, not an attachment; annotations hang off attachment refs.`;
}
/**
 * Validate and clamp one child-listing page window to the kind's record cap.
 * The detail read and the dedicated child-page read share this rule, so a
 * page the panel pages by is the page the host actually serves.
 */
export function childPageWindowOf(request, limits) {
    if (!Number.isInteger(request.offset) ||
        request.offset < 0 ||
        !Number.isInteger(request.limit) ||
        request.limit < 1 ||
        request.limit > ZOTERO_CHILD_PAGE_MAX_ROWS) {
        throw new ZoteroError(`Child pages require a nonnegative offset and a limit between 1 and ${ZOTERO_CHILD_PAGE_MAX_ROWS}.`, ZOTERO_INVALID_ARGUMENT);
    }
    const cap = request.kind === 'notes'
        ? limits.maxNoteRecords
        : request.kind === 'attachments'
            ? limits.maxAttachmentRecords
            : limits.maxAnnotationRecords;
    return { offset: request.offset, limit: Math.min(request.limit, cap) };
}
/**
 * Fetch one item's full detail. The parent is always fetched once; child
 * rows are fetched lazily only when the caller asked to include
 * notes/annotations/attachments, since the Local API ignores `?include=` on
 * single-item responses. Direct children (notes/attachments) come from the
 * bare `/children` endpoint; annotations additionally require the
 * `?itemType=annotation` listing under the same key. Collection names
 * resolve from a cached full listing only when the item belongs to
 * collections.
 */
export async function getItem(deps, directory, request, signal) {
    const ref = requireSupportedLocalRef(request.ref, ['item']);
    const prefix = libraryPrefix(ref.library);
    const parent = await deps.client.getJson(`${prefix}/items/${ref.key}`, undefined, {
        signal,
        serverId: ref.serverId,
    });
    const serverId = serverIdFromHeaders(parent.headers, ref.serverId);
    assertServerIdMatches(serverId, ref.serverId);
    const includes = INCLUDE_ORDER.filter((kind) => request.include.has(kind));
    const keys = collectionKeysOf(parent.json);
    if (request.childPages !== undefined) {
        // The configured record caps bound every page: the panel asks for its full
        // page and the domain serves at most what the config allows, so the
        // response's `limit` is the size the caller must page by.
        const pages = await Promise.all(includes.map(async (kind) => {
            const requested = request.childPages?.[kind] ?? {
                offset: 0,
                limit: ZOTERO_CHILD_PAGE_ROWS,
            };
            const page = childPageWindowOf({ kind, ...requested }, deps.limits);
            return {
                kind,
                ...(await fetchChildPage(deps, kind, ref.key, ref.library, serverId, page, signal)),
            };
        }));
        const collectionNames = keys.length > 0
            ? await directory.collectionNamesFor(keys, ref.library, serverId, signal)
            : undefined;
        const directPages = pages.filter((page) => page.kind !== 'annotations');
        return normalizeItemDetail({
            parent: parent.json,
            library: ref.library,
            serverId,
            include: request.include,
            childrenRows: pages.flatMap((page) => page.rows),
            // Every requested direct kind contributes its server-reported total, so
            // `children.total` stays exact even when only one of the two kinds rides
            // along; with neither, `childrenTotal` falls back to `meta.numChildren`.
            directChildCount: directPages.length > 0 ? directPages.reduce((sum, page) => sum + page.total, 0) : undefined,
            childPages: Object.fromEntries(pages.map((page) => [
                page.kind,
                {
                    total: page.total,
                    offset: page.offset,
                    limit: page.limit,
                    ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
                },
            ])),
            collectionNames,
            maxAbstractChars: deps.limits.maxDetailChars,
            maxNoteBodyChars: deps.limits.maxNoteBodyChars,
            maxNoteChars: deps.limits.maxNoteChars,
            maxNoteRecords: deps.limits.maxNoteRecords,
            maxAnnotationRecords: deps.limits.maxAnnotationRecords,
            maxAttachmentRecords: deps.limits.maxAttachmentRecords,
            fields: request.fields,
        });
    }
    // Children and the collections listing are independent once the parent
    // has arrived; the Local API is a loopback server with no per-client
    // throttling, so both ride the same await.
    const [children, collectionNames] = await Promise.all([
        includes.length > 0
            ? loadChildRows(deps, ref.key, ref.library, serverId, signal, {
                direct: request.include.has('notes') || request.include.has('attachments'),
                annotations: request.include.has('annotations'),
            })
            : undefined,
        keys.length > 0
            ? directory.collectionNamesFor(keys, ref.library, serverId, signal)
            : undefined,
    ]);
    return normalizeItemDetail({
        parent: parent.json,
        library: ref.library,
        serverId: serverId ?? undefined,
        include: request.include,
        childrenRows: children?.rows,
        directChildCount: children?.directCount,
        collectionNames,
        maxAbstractChars: deps.limits.maxDetailChars,
        maxNoteBodyChars: deps.limits.maxNoteBodyChars,
        maxNoteChars: deps.limits.maxNoteChars,
        maxNoteRecords: deps.limits.maxNoteRecords,
        maxAnnotationRecords: deps.limits.maxAnnotationRecords,
        maxAttachmentRecords: deps.limits.maxAttachmentRecords,
        fields: request.fields,
    });
}
/**
 * Explore one item's or attachment's child-object graph. An item ref yields
 * the requested direct notes/attachments and, when asked, annotations under
 * the item (one filtered children listing); an attachment ref yields that
 * file's annotations. The target row is always fetched first so the whole
 * result pins to one Server-ID and a non-attachment target of an attachment
 * ref fails with a typed error.
 */
export async function children(deps, request, signal) {
    const ref = requireSupportedLocalRef(request.ref, ['item', 'attachment']);
    const library = ref.library;
    const prefix = libraryPrefix(library);
    const row = await deps.client.getJson(`${prefix}/items/${ref.key}`, undefined, {
        signal,
        serverId: ref.serverId,
    });
    const serverId = serverIdFromHeaders(row.headers, ref.serverId);
    const ctx = { library, serverId: serverId ?? undefined };
    const data = asRecord(asRecord(row.json)?.data);
    const itemType = asString(data?.itemType) ?? '';
    if (ref.kind === 'attachment' && itemType !== 'attachment') {
        throw new ZoteroError(itemType === ''
            ? `The referenced object ${ref.key} could not be confirmed as an attachment.`
            : attachmentTargetKindMessage(itemType), ZOTERO_INVALID_ARGUMENT);
    }
    if (ref.kind === 'attachment') {
        // An attachment's own child objects are its annotations, served only
        // under the annotation-filtered listing.
        if (!request.include.has('annotations')) {
            return {
                ref: refStringFor(library, 'attachment', ref.key, serverId),
                itemType,
                ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
            };
        }
        const rows = await fetchAnnotationChildren(deps, ref.key, library, serverId, signal);
        const partitioned = partitionChildren(rows, ctx, undefined, new Set(['annotation']));
        return {
            ref: refStringFor(library, 'attachment', ref.key, serverId),
            itemType,
            annotations: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords),
            ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
        };
    }
    const wantsDirect = request.include.has('notes') || request.include.has('attachments');
    const wantsAnnotations = request.include.has('annotations');
    const graphRows = (await loadChildRows(deps, ref.key, library, serverId, signal, {
        direct: wantsDirect,
        annotations: wantsAnnotations,
    })).rows;
    const kinds = new Set();
    if (request.include.has('notes'))
        kinds.add('note');
    if (request.include.has('attachments'))
        kinds.add('attachment');
    if (request.include.has('annotations'))
        kinds.add('annotation');
    const partitioned = kinds.size > 0 ? partitionChildren(graphRows, ctx, undefined, kinds) : undefined;
    return {
        ref: refStringFor(library, 'item', ref.key, serverId),
        ...(itemType !== '' ? { itemType } : {}),
        ...(request.include.has('notes') && partitioned !== undefined
            ? { notes: childCollection(partitioned.notes, deps.limits.maxNoteRecords) }
            : {}),
        ...(request.include.has('annotations') && partitioned !== undefined
            ? {
                annotations: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords),
            }
            : {}),
        ...(request.include.has('attachments') && partitioned !== undefined
            ? {
                attachments: childCollection(partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, ctx)), deps.limits.maxAttachmentRecords),
            }
            : {}),
        ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
    };
}
/**
 * Read one page of a single child kind without re-reading the parent item or
 * its collection names. An attachment ref serves annotations only and is
 * validated against its target row; an item ref reads the child listing
 * directly, proving the parent exists only when the first page is empty (so a
 * deleted item still yields the typed 404 instead of a silent empty page).
 */
export async function getChildPage(deps, request, signal) {
    const ref = requireSupportedLocalRef(request.ref, ['item', 'attachment']);
    const library = ref.library;
    const page = childPageWindowOf(request, deps.limits);
    if (ref.kind === 'attachment') {
        if (request.kind !== 'annotations') {
            throw new ZoteroError('An attachment ref serves annotations only.', ZOTERO_INVALID_ARGUMENT);
        }
        const row = await deps.client.getJson(`${libraryPrefix(library)}/items/${ref.key}`, undefined, {
            signal,
            serverId: ref.serverId,
        });
        const serverId = serverIdFromHeaders(row.headers, ref.serverId);
        assertServerIdMatches(serverId, ref.serverId);
        const itemType = asString(asRecord(asRecord(row.json)?.data)?.itemType) ?? '';
        if (itemType !== 'attachment') {
            throw new ZoteroError(itemType === ''
                ? `The referenced object ${ref.key} could not be confirmed as an attachment.`
                : attachmentTargetKindMessage(itemType), ZOTERO_INVALID_ARGUMENT);
        }
        const fetched = await fetchChildPage(deps, 'annotations', ref.key, library, serverId, page, signal);
        const ctx = { library, serverId: fetched.serverId ?? serverId ?? undefined };
        const partitioned = partitionChildren(fetched.rows, ctx, deps.limits.maxNoteChars, new Set(['annotation']));
        return {
            kind: 'annotations',
            page: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords, pageMetaOf(fetched)),
        };
    }
    const fetched = await fetchChildPage(deps, request.kind, ref.key, library, ref.serverId, page, signal);
    let serverId = fetched.serverId ?? ref.serverId;
    if (fetched.total === 0 && page.offset === 0) {
        // A missing parent must still surface as the typed 404; a parent that
        // exists with no children stays an empty page.
        const parent = await deps.client.getJson(`${libraryPrefix(library)}/items/${ref.key}`, undefined, { signal, serverId: ref.serverId });
        const parentServerId = serverIdFromHeaders(parent.headers, ref.serverId);
        assertServerIdMatches(parentServerId, ref.serverId);
        serverId = parentServerId ?? serverId;
    }
    const ctx = { library, serverId };
    const kinds = new Set(request.kind === 'notes'
        ? ['note']
        : request.kind === 'attachments'
            ? ['attachment']
            : ['annotation']);
    const partitioned = partitionChildren(fetched.rows, ctx, deps.limits.maxNoteChars, kinds);
    const meta = pageMetaOf(fetched);
    switch (request.kind) {
        case 'notes':
            return {
                kind: 'notes',
                page: childCollection(partitioned.notes, deps.limits.maxNoteRecords, meta),
            };
        case 'attachments':
            return {
                kind: 'attachments',
                page: childCollection(partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, ctx)), deps.limits.maxAttachmentRecords, meta),
            };
        case 'annotations':
            return {
                kind: 'annotations',
                page: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords, meta),
            };
    }
}
/** The page metadata one fetched child page reports. */
function pageMetaOf(fetched) {
    return {
        total: fetched.total,
        offset: fetched.offset,
        limit: fetched.limit,
        ...(fetched.nextOffset !== undefined ? { nextOffset: fetched.nextOffset } : {}),
    };
}
/**
 * One key's child rows for get/retrieve/children. Each half of the request
 * rides its own wire contract; both may run in parallel. The direct row
 * count rides along so a detail's `children.total` stays honest after
 * annotation rows are merged in.
 */
export async function loadChildRows(deps, key, library, serverId, signal, needs) {
    const [direct, annotations] = await Promise.all([
        needs.direct
            ? fetchDirectChildren(deps, key, library, serverId, signal)
            : Promise.resolve([]),
        needs.annotations
            ? fetchAnnotationChildren(deps, key, library, serverId, signal)
            : Promise.resolve([]),
    ]);
    return {
        rows: annotations.length > 0 ? [...direct, ...annotations] : direct,
        directCount: needs.direct ? direct.length : undefined,
    };
}
//# sourceMappingURL=detail.js.map