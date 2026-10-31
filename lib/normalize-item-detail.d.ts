/**
 * Normalize a parent item and its bounded child listings into item detail.
 * @module dsh-zotero/normalize-item-detail
 */
import type { SupportedLocalLibrary, ZoteroChildCollection, ZoteroInclude, ZoteroItemDetail } from './types.js';
export interface ChildPageMeta {
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
    readonly nextOffset?: number;
}
export interface NormalizeItemDetailInput {
    readonly parent: unknown;
    readonly library?: SupportedLocalLibrary;
    readonly serverId?: string;
    readonly include: ReadonlySet<ZoteroInclude>;
    readonly childrenRows?: readonly unknown[];
    readonly directChildCount?: number;
    readonly childPages?: Partial<Record<'notes' | 'attachments' | 'annotations', ChildPageMeta>>;
    readonly collectionNames?: ReadonlyMap<string, string>;
    readonly maxAbstractChars: number;
    readonly maxNoteBodyChars: number;
    readonly maxNoteChars: number;
    readonly maxNoteRecords: number;
    readonly maxAnnotationRecords: number;
    readonly maxAttachmentRecords: number;
    readonly fields?: 'standard' | 'all';
}
export declare function childCollection<T>(items: readonly T[], cap: number, page?: ChildPageMeta): ZoteroChildCollection<T>;
export declare function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail;
//# sourceMappingURL=normalize-item-detail.d.ts.map