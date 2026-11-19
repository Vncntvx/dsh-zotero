import { asRecord, asString, isObjectKey } from '../json.js';
import { normalizeSearchItem } from '../normalize-search.js';
import { formatRef, libraryPrefix, parseSupportedRef, refStringFor } from '../refs.js';
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js';
import { assertAttachmentTarget } from './detail.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
export async function fulltextIdentityOf(client, attachment, signal) {
    const ref = parseSupportedRef(attachment, ['attachment']);
    const library = ref.library;
    const prefix = libraryPrefix(library);
    const expected = ref.serverId ?? client.serverId;
    const { json, headers } = await client.getJson(`${prefix}/items/${ref.key}`, undefined, {
        signal,
        serverId: expected,
        sendServerId: false,
    });
    let serverId = serverIdFromHeaders(headers, expected);
    assertServerIdMatches(serverId, expected);
    const record = asRecord(json), data = asRecord(record?.data);
    if (record?.key !== ref.key)
        throw new ZoteroError('Zotero returned different or invalid fulltext attachment metadata.', ZOTERO_UNEXPECTED);
    const itemType = asString(data?.itemType);
    assertAttachmentTarget(itemType ?? '', ref.key);
    const attachmentContentType = asString(data?.contentType);
    const identity = () => ({
        serverId,
        attachmentRef: refStringFor(library, 'attachment', ref.key, serverId),
        ...(attachmentContentType === undefined ? {} : { attachmentContentType }),
    });
    if (data?.parentItem === undefined || data.parentItem === false || data.parentItem === '')
        return identity();
    const parent = asString(data.parentItem);
    if (parent === undefined || !isObjectKey(parent))
        throw new ZoteroError('Zotero returned an invalid parent for the fulltext attachment.', ZOTERO_UNEXPECTED);
    const { json: parentJson, headers: parentHeaders } = await client.getJson(`${prefix}/items/${parent}`, undefined, { signal, serverId, sendServerId: false });
    const parentServerId = serverIdFromHeaders(parentHeaders, serverId);
    assertServerIdMatches(parentServerId, serverId);
    serverId = parentServerId;
    const parentRecord = asRecord(parentJson), parentData = asRecord(parentRecord?.data);
    if (parentRecord?.key !== parent ||
        !asString(parentData?.itemType) ||
        ['attachment', 'note', 'annotation'].includes(String(parentData?.itemType)))
        throw new ZoteroError(`Zotero returned invalid parent metadata for ${formatRef(ref)}.`, ZOTERO_UNEXPECTED);
    const normalized = normalizeSearchItem(parentJson, { library, serverId });
    return {
        ...identity(),
        item: {
            ref: normalized.ref,
            title: normalized.title,
            creatorSummary: normalized.creatorSummary,
            ...(normalized.year === undefined ? {} : { year: normalized.year }),
            ...(normalized.venue === undefined ? {} : { venue: normalized.venue }),
        },
    };
}
//# sourceMappingURL=fulltext-identity.js.map