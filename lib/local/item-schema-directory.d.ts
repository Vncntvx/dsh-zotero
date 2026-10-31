/**
 * Identity-pinned cache for Zotero item types, fields, and creator types.
 * Browse and write operations share this provider-owned schema snapshot.
 * @module dsh-zotero/local/item-schema-directory
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { ZoteroCreatorTypeInfo, ZoteroItemFieldInfo } from '../types.js';
export interface ItemTypesSchema {
    readonly serverId?: string;
    readonly items: readonly {
        itemType: string;
        localized?: string;
    }[];
}
export interface ItemFieldsSchema {
    readonly serverId?: string;
    readonly items: readonly (ZoteroItemFieldInfo | ZoteroCreatorTypeInfo)[];
}
export declare class ItemSchemaDirectory {
    private readonly client;
    private readonly itemTypesCache;
    private readonly itemTypesInFlight;
    private readonly itemFieldsCache;
    private readonly itemFieldsInFlight;
    private readonly fieldListCache;
    private readonly fieldListInFlight;
    private readonly itemTypeFieldsCache;
    private readonly itemTypeFieldsInFlight;
    constructor(client: ZoteroHttpClient);
    /**
     * The static item types schema, cached per serving instance.
     */
    getItemTypes(signal?: AbortSignal, claim?: string): Promise<ItemTypesSchema>;
    /**
     * The static metadata fields and creator types valid for an item type,
     * cached per serving instance and item type.
     */
    getItemFields(itemType: string, signal?: AbortSignal, claim?: string): Promise<ItemFieldsSchema>;
    /**
     * The field names one item type accepts, memoized per serving instance and
     * item type. The public value is the set alone; the memo carries the identity
     * that served it so the aliases below can be written from the answer.
     */
    getWritableItemFields(itemType: string, signal?: AbortSignal): Promise<ReadonlySet<string>>;
    private getFieldList;
}
//# sourceMappingURL=item-schema-directory.d.ts.map