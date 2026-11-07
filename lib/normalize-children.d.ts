/**
 * Normalize Zotero note, annotation, and attachment child rows.
 * @module dsh-zotero/normalize-children
 */
import { type ZoteroAttachmentCandidate } from './attachments.js';
import type { ZoteroAnnotationRecord, ZoteroNoteRecord, ZoteroAttachmentRecord } from './types.js';
import { type NormalizeContext } from './normalize-context.js';
export interface PartitionedChildren {
    readonly notes: readonly ZoteroNoteRecord[];
    readonly annotations: readonly ZoteroAnnotationRecord[];
    readonly attachments: readonly ZoteroAttachmentCandidate[];
}
export type ZoteroChildKind = 'note' | 'annotation' | 'attachment';
export declare function normalizeNoteRecord(json: unknown, context: NormalizeContext | undefined, maxChars?: number): ZoteroNoteRecord;
export declare function normalizeAnnotationRecord(json: unknown, context?: NormalizeContext): ZoteroAnnotationRecord;
export declare function partitionChildren(rows: readonly unknown[], context: NormalizeContext | undefined, noteMaxChars?: number, kinds?: ReadonlySet<ZoteroChildKind>): PartitionedChildren;
export declare function attachmentRecordOf(candidate: ZoteroAttachmentCandidate, context: NormalizeContext): ZoteroAttachmentRecord;
//# sourceMappingURL=normalize-children.d.ts.map