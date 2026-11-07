/**
 * The meta decoding layer of the session source model for the search, get,
 * children, retrieve, attachment, and browse projections: each tool's
 * presentation projection read off a settled block. Export, write, and sync
 * (changes/job) projections own their decoders in `export-decoder.ts`,
 * `write-decoder.ts`, and `sync-decoder.ts`. The shapes are the
 * current wire shapes (session logs are per-session snapshots, so no legacy
 * projection versions are carried); reads are defensive, so an absent or
 * malformed field degrades to nothing instead of crashing the panel. Only
 * the fields the panel renders are decoded.
 * @module dsh-zotero/client/sources/decoders
 */
import type { EvidenceItem } from '../evidence-item.js';
import { type BrowseRow } from '../browse-rows.js';
import type { SourceAvailabilityEntry, SourceCoverage, SupportedLocalLibrary } from './model.js';
import type { ZoteroResolvedScope } from '../contract.js';
/** One decoded search row (with Zotero's attachment selection when present). */
interface SearchRowMeta {
    readonly ref: string;
    readonly title: string;
    readonly creatorSummary: string;
    readonly year?: number;
    /** The item's own Zotero type, e.g. `journalArticle`. */
    readonly itemType?: string;
    readonly citationKey?: string;
    readonly citationKeySource?: 'native' | 'extra';
    readonly citationKeyConflict?: {
        readonly native: string;
        readonly extra: string;
    };
    readonly bestAttachmentRef?: string;
    readonly bestAttachmentType?: string;
}
/**
 * Whether the host's 8 KiB meta budget dropped this projection's detail keys:
 * the summary facts stay (counts, totals) and `detailOmitted` stamps the cut,
 * so a card can say "details were omitted" instead of showing fewer rows with
 * no reason. See `presentation-meta.ts` (`boundedPresentationMeta`).
 */
export declare function detailOmittedOf(meta: Record<string, unknown>): boolean;
/** The search projection view; `rows === null` means malformed. */
interface SearchMetaView {
    readonly rows: readonly SearchRowMeta[] | null;
    /** Hits the paged primary listing returned; the note-body supplement is counted separately. */
    readonly returned: number | null;
    /** The whole hit count the scope carries, past the returned page. */
    readonly total: number | null;
    readonly omitted: number | null;
    /**
     * Note-body matches folded into the first page. `null` means the call made
     * no note scan at all (the producer's `supplemental` is absent), which is
     * distinct from `0`, the scan ran and found nothing.
     */
    readonly noteMatches: number | null;
    readonly scope: ZoteroResolvedScope | null;
    readonly library: SupportedLocalLibrary | null;
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
/** One child collection's own page facts: how many exist, how many came back. */
export interface ChildCountView {
    readonly total: number;
    readonly returned: number;
    readonly completeness?: 'complete' | 'page';
    readonly offset?: number;
    readonly limit?: number;
    readonly nextOffset?: number;
}
/** One bounded child preview: a note or annotation the projection kept. */
export interface ChildPreviewView {
    readonly ref: string;
    readonly preview: string;
    readonly pageLabel: string | null;
    /** The note's parent item, or an annotation's own PDF attachment. */
    readonly parentRef: string | null;
}
/** The get projection view; a null field is absent or malformed. */
interface GetMetaView {
    readonly resolvedAttachment: AttachmentMetaView | null;
    readonly title: string | null;
    readonly creators: string | null;
    readonly citationKey: string | null;
    readonly citationKeySource: 'native' | 'extra' | null;
    readonly citationKeyConflict: {
        readonly native: string;
        readonly extra: string;
    } | null;
    readonly year: number | null;
    readonly venue: string | null;
    readonly bestAttachment: {
        readonly ref?: string;
        readonly contentType: string;
    } | null;
    /** Per-kind child counts; a key is absent when the call did not ask for it. */
    readonly notes: ChildCountView | null;
    readonly annotations: ChildCountView | null;
    readonly attachments: ChildCountView | null;
    readonly notesPreview: readonly ChildPreviewView[];
    readonly annotationsPreview: readonly ChildPreviewView[];
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
/** The retrieve projection view; `items === null` means malformed. */
interface RetrieveMetaView {
    readonly items: readonly EvidenceItem[] | null;
    readonly count: number | null;
    readonly truncated: boolean | null;
    readonly attachmentRef: string | null;
    readonly attachmentContentType: string | null;
    readonly coverage: SourceCoverage | null;
    readonly sourceAvailability: Readonly<Record<string, SourceAvailabilityEntry>>;
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
/** The attachment projection view; a null field is absent or malformed. */
interface AttachmentMetaView {
    readonly kind: 'file' | 'url' | null;
    readonly title: string | null;
    readonly contentType: string | null;
    readonly location: string | null;
    readonly ref: string | null;
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
/**
 * The browse projection view. `returned`/`total`/`nextOffset` are the page
 * facts the summary and the pagination note read; they are never among the
 * keys the byte budget drops, so a summary stays exact even on a page too
 * heavy to itemize. `rows` is null exactly when the rows are unavailable:
 * an over-budget projection, an absent meta, or a malformed `items`.
 */
interface BrowseMetaView {
    readonly kind: string | null;
    readonly returned: number | null;
    readonly total: number | null;
    readonly nextOffset: number | null;
    readonly rows: readonly BrowseRow[] | null;
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
export declare function browseMetaOf(meta: Record<string, unknown>): BrowseMetaView;
export declare function searchMetaOf(meta: Record<string, unknown>): SearchMetaView;
export declare function getMetaOf(meta: Record<string, unknown>): GetMetaView;
export declare function retrieveMetaOf(meta: Record<string, unknown>): RetrieveMetaView;
export declare function attachmentMetaOf(meta: Record<string, unknown>): AttachmentMetaView;
export {};
//# sourceMappingURL=decoders.d.ts.map