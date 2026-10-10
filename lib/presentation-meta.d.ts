/**
 * Card-sized presentation projections for the Zotero tools. Each
 * projector is a pure function of the canonical tool output (plus, for
 * export, the requested ref count) and feeds `output.presentationMeta`, so
 * the projected facts persist into the `tool/result` event's `meta` and
 * reach the browser as `block.meta`, where the dedicated Zotero web view
 * renders from them. A single UTF-8 byte budget bounds the whole projection;
 * over-budget projections drop their detail field and set `detailOmitted`
 * instead of inventing a per-field truncation policy. The complete data stays
 * in the canonical result and the trajectory Inspect.
 * @module dsh-zotero/presentation-meta
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { type EvidenceItem } from './evidence-item.js';
import type { SupportedLocalLibrary, ZoteroAttachmentLocation, ZoteroCoverage, ZoteroEvidenceSource, ZoteroItemDetail, ZoteroResolvedScope, ZoteroRetrieveResult, ZoteroSearchResult } from './types.js';
/** UTF-8 byte budget for one tool's presentation meta. */
export declare const MAX_PRESENTATION_META_BYTES = 8192;
/** Logical caps applied inside each projector before the byte budget. */
export declare const MAX_PRESENTATION_SEARCH_ROWS = 20;
/** Row-bytes allowance inside the search projection (kept well under the total budget). */
export declare const MAX_PRESENTATION_SEARCH_ROWS_BYTES = 6144;
export declare const MAX_PRESENTATION_GET_VENUE_CHARS = 200;
export declare const MAX_PRESENTATION_EVIDENCE_CHARS = 400;
/** The search projection's row shape (subset of the tool output record). */
/** The canonical search output the projector reads. */
export type SearchProjectionInput = ZoteroSearchResult;
/** One compact search row: the card's list unit with its copyable ref. */
interface ZoteroSearchPresentationRow {
    readonly ref: string;
    readonly title: string;
    readonly creatorSummary: string;
    readonly year?: number;
    readonly itemType: string;
    /** Zotero's own attachment selection for the row; the open-PDF deep-link key. */
    readonly bestAttachmentRef?: string;
    /** The content type of Zotero's attachment selection; tells a PDF from other kinds. */
    readonly bestAttachmentType?: string;
}
export interface ZoteroSearchPresentationMeta {
    readonly returned: number;
    readonly total: number;
    readonly nextOffset: number | null;
    readonly displayed: number;
    readonly omitted: number;
    /** Note-body matches merged into the first page; null when the page had none. */
    readonly noteMatches: number | null;
    readonly items: ZoteroSearchPresentationRow[];
    readonly scope: ZoteroResolvedScope;
    /**
     * The library the scope resolved to; absent when the scope ref is
     * unparseable or names an unsupported library, and callers then omit the
     * badge instead of mislabeling the page as personal.
     */
    readonly library?: SupportedLocalLibrary;
}
/** One bounded child preview: personal note/annotation, kept distinct from item metadata. */
interface ZoteroChildPreview {
    readonly ref: string;
    readonly preview: string;
    readonly pageLabel?: string;
    readonly parentRef?: string;
}
interface ZoteroChildCount {
    readonly total: number;
    readonly returned: number;
}
/** The canonical get output the projector reads. */
export type GetProjectionInput = ZoteroItemDetail;
export interface ZoteroGetPresentationMeta {
    readonly title: string;
    readonly creators: string;
    readonly year?: number;
    readonly venue?: string;
    /** The item's own type; kept on the wire for clients that distinguish notes. */
    readonly itemType?: string;
    /** The item's own ref, so the Sources panel can attribute the detail directly. */
    readonly ref?: string;
    readonly notes?: ZoteroChildCount;
    readonly annotations?: ZoteroChildCount;
    readonly attachments?: ZoteroChildCount;
    /** Zotero's attachment selection with its ref (the open-PDF deep-link key). */
    readonly bestAttachment?: {
        readonly ref?: string;
        readonly contentType: string;
    };
    readonly notesPreview: ZoteroChildPreview[];
    readonly annotationsPreview: ZoteroChildPreview[];
    readonly relations?: readonly {
        readonly predicate: string;
        readonly targetUri: string;
        readonly targetRef?: string;
    }[];
}
/** Per-source availability facts: provable from the canonical result alone. */
interface ZoteroSourceAvailabilityView {
    readonly requested: boolean;
    readonly returnedPassages: number;
    readonly unavailable: boolean;
}
export interface ZoteroRetrievePresentationMeta {
    readonly count: number;
    readonly sources: ZoteroEvidenceSource[];
    readonly truncated: boolean;
    readonly sourcesSkipped: ZoteroEvidenceSource[];
    readonly items: EvidenceItem[];
    /** The full-text attachment the retrieval read (the open-PDF deep-link key). */
    readonly attachmentRef?: string;
    /** The content type of that attachment; tells a PDF from other kinds. */
    readonly attachmentContentType?: string;
    /** Full-text indexing coverage as reported by Zotero. */
    readonly coverage?: ZoteroCoverage;
    /** Per-source availability facts, keyed by the requested source names. */
    readonly sourceAvailability: Record<string, ZoteroSourceAvailabilityView>;
}
/** The retrieval facts the projection reads (the schema-inferred output satisfies this). */
/** The canonical retrieve output the projector reads. */
export type RetrieveProjectionInput = ZoteroRetrieveResult;
export interface ZoteroAttachmentPresentationMeta {
    readonly kind: 'file' | 'url';
    readonly title: string;
    readonly contentType: string;
    /** The resolved attachment's own ref (the open-PDF deep-link key). */
    readonly ref?: string;
    readonly path?: string;
    readonly url?: string;
}
/** One bounded export document item: the ref with its format-local key, display title, and located entry. */
interface ZoteroExportPresentationItem {
    readonly ref: string;
    /** The format-local identifier (citation key, CSL JSON id). */
    readonly key?: string;
    /** The item's title for display, when the entry carried one. */
    readonly title?: string;
    /** The located entry's index within the parsed CSL JSON array. */
    readonly entryIndex?: number;
    /** The located entry's text span within the trimmed batch body (text formats). */
    readonly start?: number;
    readonly end?: number;
}
export interface ZoteroExportPresentationMeta {
    readonly format: string;
    readonly requested: number;
    /** Actual exported citation count (citation arm only; text formats carry no per-item count). */
    readonly count?: number;
    readonly style?: string;
    readonly locale?: string;
    /** The bounded exported ref list (first {@link MAX_PRESENTATION_EXPORT_REFS}). */
    readonly refs: string[];
    /** Exported refs beyond the bounded list. */
    readonly refsOmitted: number;
    /**
     * The bounded per-document items (first {@link MAX_PRESENTATION_EXPORT_REFS},
     * without their entry text, which the byte budget drops wholesale rather
     * than mid-cutting); absent for exports without items or when the budget
     * dropped the detail.
     */
    readonly items?: readonly ZoteroExportPresentationItem[];
}
/** The canonical attachment output the projector reads (discriminated on `kind`). */
export type AttachmentProjectionInput = ZoteroAttachmentLocation;
/**
 * Project one search result into card-sized facts. Rows are bounded by both
 * a logical cap and a row-bytes allowance, so a normal page projects whole
 * (no arbitrary 6-row cut) while a heavy page still fits the shared budget
 * without ever tripping the detail-dropping overflow.
 * @param value - the canonical search result.
 * @returns the bounded projection.
 */
export declare function projectSearchMeta(value: SearchProjectionInput): ZoteroSearchPresentationMeta;
/**
 * Project one item detail into card-sized facts: the header line, child
 * counts, and (when requested) bounded note/annotation previews kept apart
 * from the item's own metadata.
 * @param value - the canonical item detail.
 * @returns the bounded projection.
 */
export declare function projectGetMeta(value: GetProjectionInput): ZoteroGetPresentationMeta;
/**
 * Project one retrieval result into card-sized evidence facts. Fulltext
 * passages never carry page locators, so the projection copies what the
 * canonical record owns and nothing more. The per-source availability facts
 * come from the canonical result alone: `requested` is the caller's source
 * list, `unavailable` the skipped list, `returnedPassages` the evidence count
 * per source.
 * @param value - the canonical retrieval result.
 * @param requestedSources - the sources the call asked for.
 * @returns the bounded projection.
 */
export declare function projectRetrieveMeta(value: RetrieveProjectionInput, requestedSources: readonly ZoteroEvidenceSource[]): ZoteroRetrievePresentationMeta;
/**
 * Project one attachment location into card-sized facts; the full path or
 * URL stays the copyable canonical value.
 * @param value - the canonical attachment location.
 * @returns the bounded projection.
 */
export declare function projectAttachmentMeta(value: AttachmentProjectionInput): ZoteroAttachmentPresentationMeta;
/**
 * Project one export result into card-sized facts. The citation arm counts
 * the actually exported citations; the text formats are opaque joined text,
 * so they report the requested ref count instead of inventing an item count.
 * The exported ref list is itemized up to {@link MAX_PRESENTATION_EXPORT_REFS}
 * entries, and the translator formats carry their per-document items (ref,
 * key, and title, never the entry text) in the same bound. The byte-budget
 * guard may drop them entirely (see `boundedPresentationMeta`), never part
 * of it.
 * @param value - the canonical export result.
 * @param refs - the exported refs, in the caller's order; their count is the request size.
 * @returns the bounded projection.
 */
export declare function projectExportMeta(value: {
    readonly format: string;
    readonly style?: string;
    readonly locale?: string;
    readonly citations?: readonly {
        readonly ref: string;
        readonly text: string;
    }[];
    readonly text?: string;
    readonly items?: readonly {
        readonly ref: string;
        readonly key?: string;
        readonly title?: string;
        readonly entryIndex?: number;
        readonly start?: number;
        readonly end?: number;
    }[];
}, refs: readonly string[]): ZoteroExportPresentationMeta;
/** The UTF-8 byte size of one JSON projection. */
export declare function presentationMetaBytes(meta: Record<string, unknown>): number;
/**
 * Enforce the shared byte budget. A projection that fits returns unchanged;
 * an over-budget one drops its detail keys (keeping the summary facts) and
 * records `detailOmitted`. No per-field truncation is invented here, and the
 * complete data stays in the canonical result.
 * @param meta - one projector's output.
 * @param detailKeys - the keys holding per-item detail rows or long values.
 * @returns the bounded projection.
 */
export declare function boundedPresentationMeta(meta: unknown, detailKeys: readonly string[]): JsonValue;
export {};
//# sourceMappingURL=presentation-meta.d.ts.map