/**
 * Create and update Zotero note items.
 * @module dsh-zotero/local/write-notes
 */
import { WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT, ZoteroError, requireNonBlank, } from '../errors.js';
import { asRecord, asString } from '../json.js';
import { formatZoteroRelationUri, libraryPrefix, PERSONAL_LIBRARY, relationTargetRef, requireSupportedLocalRef, requireWritableRef, } from '../refs.js';
import { markdownToNoteHtml } from './note-format.js';
import { settleCreate } from './write-verdicts.js';
import { collectionRef, itemRef } from './write-refs.js';
import { ensureServerId, normalizeCollectionInput, normalizeWriteList, requireSupportedRefAtServer, requireWritableRefAtServer, tagsOf, strictCollectionKeysOf, withItemStateWrite, withWriteKey, } from './write-domain.js';
const DC_RELATION = 'dc:relation';
function relationUrisOf(data) {
    const raw = asRecord(data['relations'])?.[DC_RELATION];
    if (typeof raw === 'string')
        return [raw];
    return Array.isArray(raw)
        ? raw.map(asString).filter((value) => value !== undefined)
        : [];
}
function relationUriToRef(uri, serverId) {
    return relationTargetRef(uri, serverId, { personalContext: true }) ?? uri;
}
export async function createNote(deps, request, signal) {
    requireNonBlank('markdown', request.markdown);
    const localParent = request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item']);
    const collectionInputs = (request.collections ?? []).map((value) => normalizeCollectionInput('collections', value));
    const localSources = (request.sourceRefs ?? []).map((ref) => requireSupportedLocalRef(ref, ['item']));
    const tags = normalizeWriteList('tags', request.tags ?? []);
    if (localParent !== undefined && collectionInputs.length > 0) {
        throw new ZoteroError(WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    const serverId = await ensureServerId(deps, signal);
    const parent = localParent === undefined
        ? undefined
        : requireWritableRefAtServer(localParent, ['item'], serverId);
    const collections = (await deps.resolveCollections(collectionInputs, signal)).map((ref) => requireWritableRefAtServer(ref, ['collection'], serverId));
    const sources = localSources.map((ref) => requireSupportedRefAtServer(ref, ['item'], serverId));
    const entry = {
        itemType: 'note',
        note: markdownToNoteHtml(request.markdown),
        ...(parent !== undefined ? { parentItem: parent.key } : {}),
        ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
        ...(parent === undefined && collections.length > 0
            ? { collections: collections.map((ref) => ref.key) }
            : {}),
        ...(sources.length > 0
            ? { relations: { [DC_RELATION]: sources.map((ref) => formatZoteroRelationUri(ref)) } }
            : {}),
    };
    return await withWriteKey(deps, serverId, signal, async (apiKey) => {
        const prove = (data) => {
            if (data.itemType !== 'note' ||
                typeof data.note !== 'string' ||
                (parent !== undefined && data.parentItem !== parent.key) ||
                (parent === undefined && data.parentItem !== undefined))
                return undefined;
            const savedTags = tagsOf(data);
            const savedCollections = strictCollectionKeysOf(data);
            if (savedTags === undefined || savedCollections === undefined)
                return undefined;
            return {
                savedTags: savedTags.map((tag) => tag.tag),
                savedCollections,
                savedRelations: relationUrisOf(data),
            };
        };
        const settled = await settleCreate(deps, {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/items`,
            entry,
            serverId,
            apiKey,
            signal,
            kind: 'note',
        }, prove);
        if (settled.status === 'unverified')
            return settled.result;
        const { key, version, payload } = settled.entry;
        return {
            kind: 'applied',
            ref: itemRef(key, serverId),
            key,
            version,
            ...(parent !== undefined ? { parentItem: itemRef(parent.key, serverId) } : {}),
            collections: parent === undefined
                ? payload.savedCollections.map((collectionKey) => collectionRef(collectionKey, serverId))
                : [],
            tags: payload.savedTags,
            sourceRefs: payload.savedRelations.map((uri) => relationUriToRef(uri, serverId)),
            libraryVersion: settled.entry.libraryVersion,
            serverId,
        };
    });
}
export async function updateNote(deps, request, signal) {
    const markdown = requireNonBlank('markdown', request.markdown);
    const localRef = requireWritableRef(request.item, ['item']);
    return await withItemStateWrite(deps, localRef, signal, () => ({}), async ({ snapshot, serverId, resultRef, send }) => {
        if (snapshot.itemType !== 'note') {
            throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT);
        }
        const { libraryVersion } = await send({ note: markdownToNoteHtml(markdown) });
        return { kind: 'applied', ref: resultRef, version: libraryVersion, libraryVersion, serverId };
    });
}
//# sourceMappingURL=write-notes.js.map