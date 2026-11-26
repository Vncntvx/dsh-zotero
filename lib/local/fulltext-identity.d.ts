/** Resolve a local document's attachment and parent from actual Zotero metadata. */
import type { ZoteroHttpClient } from '../http-client.js';
import type { ZoteroFulltextItem } from '../types.js';
export interface FulltextIdentity {
    readonly serverId: string | undefined;
    readonly attachmentRef: string;
    readonly attachmentContentType?: string;
    readonly item?: ZoteroFulltextItem;
    readonly collectionKeys?: readonly string[];
}
export declare function fulltextIdentityOf(client: ZoteroHttpClient, attachment: string, signal?: AbortSignal, activeOnly?: boolean): Promise<FulltextIdentity>;
//# sourceMappingURL=fulltext-identity.d.ts.map