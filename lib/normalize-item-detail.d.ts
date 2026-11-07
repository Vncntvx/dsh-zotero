/**
 * Normalize a parent item and its bounded child listings into item detail.
 * @module dsh-zotero/normalize-item-detail
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { NormalizeContext } from './normalize-context.js';
import { type PartitionedChildren } from './normalize-children.js';
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
export declare function extraFieldsOf(data: Record<string, unknown> | undefined): Record<string, JsonValue> | undefined;
export declare function childCollection<T>(items: readonly T[], cap: number, page?: ChildPageMeta): ZoteroChildCollection<T>;
/**
 * Partition one page of child rows into the detail's included kinds. The
 * whole-detail normalizer and the paged reader share this one composition,
 * so a page and a complete read produce identical child records.
 * @param rows - raw child rows from one `/children` listing.
 * @param context - the library and serving instance the rows belong to.
 * @param include - the child kinds the caller requested.
 * @param noteMaxChars - the per-note preview budget.
 * @returns the normalized notes, annotations, and attachment candidates.
 */
export declare function partitionDetailChildren(rows: readonly unknown[], context: NormalizeContext, include: ReadonlySet<ZoteroInclude>, noteMaxChars: number): PartitionedChildren;
export declare function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail;
//# sourceMappingURL=normalize-item-detail.d.ts.map