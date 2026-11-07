/**
 * Identity-pinned cache for Zotero item types, fields, and creator types.
 * Browse and write operations share this provider-owned schema snapshot.
 * @module dsh-zotero/local/item-schema-directory
 */
import { sharedRead } from '../concurrency.js';
import { asRecord, asString } from '../json.js';
import { requireAgreedServerId, serverIdFromHeaders } from './identity.js';
import { requireArrayBody } from './pagination.js';
/** One cache key family: the caller's instance claim plus the item type. */
function itemTypeKeyOf(claim, itemType) {
    return `${claim ?? ''}:${itemType}`;
}
export class ItemSchemaDirectory {
    client;
    itemTypesCache = new Map();
    itemTypesInFlight = new Map();
    itemFieldsCache = new Map();
    itemFieldsInFlight = new Map();
    fieldListCache = new Map();
    fieldListInFlight = new Map();
    itemTypeFieldsCache = new Map();
    itemTypeFieldsInFlight = new Map();
    constructor(client) {
        this.client = client;
    }
    /**
     * The static item types schema, cached per serving instance.
     */
    async getItemTypes(signal, claim) {
        return await sharedRead({
            cache: this.itemTypesCache,
            inFlight: this.itemTypesInFlight,
            keys: {
                flightKey: claim ?? '',
                find: () => claim !== undefined
                    ? this.itemTypesCache.get(claim)
                    : (this.itemTypesCache.get('') ?? this.itemTypesCache.values().next().value),
                // The instance that served the answer, the default alias, and the
                // caller's claim all answer the same snapshot.
                store: (value) => [
                    value.serverId ?? '',
                    '',
                    ...(claim !== undefined && claim !== '' ? [claim] : []),
                ],
            },
            load: async (loadSignal) => {
                const { json, headers } = await this.client.getJson('itemTypes', undefined, {
                    signal: loadSignal,
                    ...(claim !== undefined ? { serverId: claim } : {}),
                });
                const serverId = serverIdFromHeaders(headers, claim);
                const items = requireArrayBody(json, 'item types')
                    .map((row) => {
                    const record = asRecord(row);
                    const itemType = asString(record?.itemType) ?? asString(record?.name);
                    if (itemType === undefined)
                        return null;
                    const localized = asString(record?.localized) ?? asString(record?.displayName);
                    return { itemType, ...(localized ? { localized } : {}) };
                })
                    .filter((row) => row !== null)
                    .sort((a, b) => a.itemType.localeCompare(b.itemType));
                return { serverId, items };
            },
            signal,
        });
    }
    /**
     * The static metadata fields and creator types valid for an item type,
     * cached per serving instance and item type.
     */
    async getItemFields(itemType, signal, claim) {
        const cacheKey = itemTypeKeyOf(claim, itemType);
        return await sharedRead({
            cache: this.itemFieldsCache,
            inFlight: this.itemFieldsInFlight,
            keys: {
                flightKey: cacheKey,
                find: () => this.itemFieldsCache.get(cacheKey),
                store: (value) => [
                    itemTypeKeyOf(value.serverId, itemType),
                    itemTypeKeyOf('', itemType),
                    ...(claim !== undefined && claim !== '' ? [itemTypeKeyOf(claim, itemType)] : []),
                ],
            },
            load: async (loadSignal) => {
                const params = new URLSearchParams({ itemType });
                const [fieldList, creatorTypes] = await Promise.all([
                    this.getFieldList(itemType, loadSignal, claim),
                    this.client.getJson('itemTypeCreatorTypes', params, {
                        signal: loadSignal,
                        ...(claim !== undefined ? { serverId: claim } : {}),
                    }),
                ]);
                const serverId = requireAgreedServerId(fieldList.serverId, serverIdFromHeaders(creatorTypes.headers, claim));
                const creatorTypeItems = requireArrayBody(creatorTypes.json, 'creator types')
                    .flatMap((row) => {
                    const record = asRecord(row);
                    const creatorType = asString(record?.creatorType);
                    if (creatorType === undefined)
                        return [];
                    const localized = asString(record?.localized);
                    return [{ creatorType, ...(localized !== undefined ? { localized } : {}) }];
                })
                    .sort((a, b) => a.creatorType.localeCompare(b.creatorType));
                return { serverId, items: [...fieldList.items, ...creatorTypeItems] };
            },
            signal,
        });
    }
    /**
     * The field names one item type accepts, memoized per serving instance and
     * item type. The public value is the set alone; the memo carries the identity
     * that served it so the aliases below can be written from the answer.
     */
    async getWritableItemFields(itemType, signal) {
        const claim = this.client.serverId;
        const cacheKey = itemTypeKeyOf(claim, itemType);
        // The memo is looked up under the client's claim, so the claim key must
        // carry the value too: otherwise a client whose remembered instance id
        // differs from the one that served the answer never hits the memo.
        const schema = await sharedRead({
            cache: this.itemTypeFieldsCache,
            inFlight: this.itemTypeFieldsInFlight,
            keys: {
                flightKey: cacheKey,
                find: () => this.itemTypeFieldsCache.get(cacheKey),
                store: (value) => [
                    itemTypeKeyOf(value.serverId, itemType),
                    itemTypeKeyOf('', itemType),
                    ...(claim !== undefined && claim !== '' ? [itemTypeKeyOf(claim, itemType)] : []),
                ],
            },
            load: async (loadSignal) => {
                const { items, serverId } = await this.getFieldList(itemType, loadSignal, claim);
                return { serverId, fields: new Set(items.map((item) => item.field)) };
            },
            signal,
        });
        return schema.fields;
    }
    async getFieldList(itemType, signal, claim) {
        const cacheKey = itemTypeKeyOf(claim, itemType);
        return await sharedRead({
            cache: this.fieldListCache,
            inFlight: this.fieldListInFlight,
            keys: {
                flightKey: cacheKey,
                find: () => this.fieldListCache.get(cacheKey),
                store: (value) => [
                    itemTypeKeyOf(value.serverId, itemType),
                    itemTypeKeyOf('', itemType),
                    ...(claim !== undefined && claim !== '' ? [itemTypeKeyOf(claim, itemType)] : []),
                ],
            },
            load: async (loadSignal) => {
                const params = new URLSearchParams({ itemType });
                const { json, headers } = await this.client.getJson('itemTypeFields', params, {
                    signal: loadSignal,
                    ...(claim !== undefined ? { serverId: claim } : {}),
                });
                const serverId = serverIdFromHeaders(headers, claim);
                const items = requireArrayBody(json, 'item type fields')
                    .flatMap((row) => {
                    const record = asRecord(row);
                    const field = asString(record?.field);
                    if (field === undefined)
                        return [];
                    const localized = asString(record?.localized);
                    return [{ field, ...(localized !== undefined ? { localized } : {}) }];
                })
                    .sort((a, b) => a.field.localeCompare(b.field));
                return { serverId, items };
            },
            signal,
        });
    }
}
//# sourceMappingURL=item-schema-directory.js.map