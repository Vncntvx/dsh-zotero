/**
 * Forward-tolerant normalization of Zotero Local API JSON into the plugin's
 * domain records. External JSON is a compatibility boundary: unknown fields
 * are ignored, missing optional fields are tolerated, but a broken required
 * invariant (an object key that is not a Zotero key) fails loud — silently
 * returning partially incorrect research metadata is never acceptable.
 * @module dsh-zotero/normalize
 */
import { type ZoteroAttachmentCandidate } from './attachments.js';
import type { SupportedLocalLibrary, ZoteroAnnotationRecord, ZoteroAttachmentRecord, ZoteroChildCollection, ZoteroCreator, ZoteroInclude, ZoteroItemDetail, ZoteroNoteRecord, ZoteroSearchItem } from './types.js';
/**
 * Shown when an API row names no usable object key. Every normalized record
 * is addressed by its key, so a row without one cannot be represented at all
 * — the message is one rule and lives here, with the normalizer that owns it,
 * for every caller that has to refuse the same row.
 */
export declare const ITEM_WITHOUT_KEY_MESSAGE = "Zotero returned an item without a valid object key.";
/**
 * Reduce a Zotero note body to plain text: block-level tags become line
 * breaks, remaining tags are dropped, and the common HTML entities are
 * decoded. Whitespace otherwise stays verbatim.
 */
export declare function plainNoteText(value: unknown): string;
export interface NormalizeContext {
    readonly library: SupportedLocalLibrary;
    readonly serverId?: string;
}
/**
 * Normalize one item JSON object into a compact search hit.
 * @param json - the raw API object; anything outside the documented shape is ignored.
 * @param ctx - the library+serverId context; omitted means the personal library without provenance.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export declare function normalizeSearchItem(json: unknown, ctx?: NormalizeContext): ZoteroSearchItem;
/**
 * Normalize one collection or saved-search JSON object into its identity pair.
 * Collections also carry their parent key, so a cached listing is rich enough
 * to rebuild breadcrumbs without a second fetch.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export declare function normalizeScopeEntry(json: unknown): ScopeNameEntry;
export interface ScopeNameEntry {
    readonly key: string;
    readonly name: string;
    /** Parent collection key; present only for non-root collections. */
    readonly parentKey?: string;
}
/**
 * Match a wanted name against scope entries: an exact Unicode match wins;
 * otherwise every case-insensitive match is returned (possibly none).
 * @returns the matching entries, exact or case-insensitive.
 */
export declare function matchScopeName(entries: readonly ScopeNameEntry[], wanted: string): ScopeNameEntry[];
/**
 * Near-match candidates for diagnostics: case-insensitive substring matches,
 * shortest names first, capped at `limit`.
 */
export declare function nearScopeCandidates(entries: readonly ScopeNameEntry[], wanted: string, limit?: number): ScopeNameEntry[];
/**
 * The creator role assumed when Zotero omits `creatorType`. Zotero creator
 * rows always carry a type in practice; inventing `author` keeps a named
 * creator instead of dropping research metadata over a missing role. Rows
 * with no name at all are still skipped — the default never fabricates a
 * creator, only a role.
 */
export declare const DEFAULT_CREATOR_TYPE = "author";
/**
 * Format creator records into structured ZoteroCreator objects.
 * Empty or malformed entries are skipped.
 */
export declare function normalizeCreators(data: Record<string, unknown> | undefined): ZoteroCreator[];
/** Format a single creator into a display name with optional role suffix. */
export declare function formatCreatorDisplayName(creator: ZoteroCreator): string;
/**
 * Format a list of creators, omitting any creators that have no display name,
 * joined by semicolons.
 */
export declare function formatCreatorsList(creators: readonly ZoteroCreator[]): string;
/**
 * Extract a citation key from unstructured extra text if present. One
 * grammar serves every consumer — the `[@citekey]` display on search hits
 * and the BibTeX/BibLaTeX alignment's first tier. The label matches
 * case-insensitively as "Citation Key" or "citekey", and the value is the
 * first token after the colon: a citation key is a single token, so any
 * trailing prose on the same line is never part of it.
 */
export declare function citekeyOf(extra?: string): string | undefined;
/** The first non-empty publication venue field, in Zotero's own priority order. */
export declare function normalizeVenue(data: Record<string, unknown> | undefined): string | undefined;
/** The collection keys an item belongs to, from its `data.collections` block. */
export declare function collectionKeysOf(json: unknown): string[];
/** Cut a text at `max` characters; `truncated` records whether the cut happened. */
export declare function truncateText(text: string, max: number): {
    text: string;
    truncated: boolean;
};
/**
 * Normalize one note child row. When `maxChars` is undefined the full body
 * is kept — retrieve chunks untruncated notes itself.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the row has no valid Zotero key.
 */
export declare function normalizeNoteRecord(json: unknown, ctx: NormalizeContext | undefined, maxChars?: number): ZoteroNoteRecord;
/**
 * Normalize one annotation child row. Optional fields are omitted rather
 * than undefined so the record stays lossless JSON.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the row has no valid Zotero key.
 */
export declare function normalizeAnnotationRecord(json: unknown, ctx?: NormalizeContext): ZoteroAnnotationRecord;
/** Child rows partitioned by kind. Attachments stay ref-free; callers add provenance. */
export interface PartitionedChildren {
    readonly notes: readonly ZoteroNoteRecord[];
    readonly annotations: readonly ZoteroAnnotationRecord[];
    readonly attachments: readonly ZoteroAttachmentCandidate[];
}
/** The child kinds `partitionChildren` can partition and normalize. */
export type ZoteroChildKind = 'note' | 'annotation' | 'attachment';
/**
 * Partition child rows into notes, annotations, and attachments. Notes keep
 * API order and are truncated to `noteMaxChars` when given (undefined keeps
 * the full body); annotations are ordered by Zotero's `annotationSortIndex`.
 * Only the requested kinds are normalized — rows of other kinds are still
 * classified by their `itemType` but never read deeper. Unknown child kinds
 * are ignored — the plugin only claims the three kinds it understands — but
 * a malformed row of a requested kind fails loud.
 * @param rows - raw child item JSON objects.
 * @param ctx - the library+serverId context.
 * @param noteMaxChars - per-note budget; undefined keeps the full body.
 * @param kinds - the kinds to normalize; defaults to all three.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` on a requested-kind child without a valid key.
 */
export declare function partitionChildren(rows: readonly unknown[], ctx: NormalizeContext | undefined, noteMaxChars?: number, kinds?: ReadonlySet<ZoteroChildKind>): PartitionedChildren;
export interface NormalizeItemDetailInput {
    /** The single-item response body of `GET /users/0/items/<key>`. */
    readonly parent: unknown;
    /** Library context (canonical personal or group); omitted defaults to user/0. */
    readonly library?: SupportedLocalLibrary;
    /** The instance that served the parent; recorded as ref provenance. */
    readonly serverId?: string;
    /** The child kinds the caller asked to include; unrequested kinds are omitted. */
    readonly include: ReadonlySet<ZoteroInclude>;
    /** Rows of `GET /users/0/items/<key>/children`; undefined when not fetched. */
    readonly childrenRows?: readonly unknown[];
    /**
     * The parent's direct child count when annotation rows gathered from
     * attachments were merged into `childrenRows` — the merged array is longer
     * than the direct child set, so the fallback total needs the original count.
     */
    readonly directChildCount?: number;
    /** Collection names by key; missing entries render ref-only records. */
    readonly collectionNames?: ReadonlyMap<string, string>;
    /** Character budget for the abstract preview. */
    readonly maxAbstractChars: number;
    /** Character budget for a note item's own body; `truncated` signals the cut. */
    readonly maxNoteBodyChars: number;
    /** Per-note character budget; `truncated` signals the cut. */
    readonly maxNoteChars: number;
    /** Upper bound for returned note records. */
    readonly maxNoteRecords: number;
    /** Upper bound for returned annotation records. */
    readonly maxAnnotationRecords: number;
    /** `all` passes through `data` fields the normalized model does not consume. */
    readonly fields?: 'standard' | 'all';
}
/** Bound records to `cap` while keeping Zotero's total honest. */
export declare function childCollection<T>(items: readonly T[], cap: number): ZoteroChildCollection<T>;
/** Project an attachment candidate into its ref-carrying record. */
export declare function attachmentRecordOf(candidate: ZoteroAttachmentCandidate, ctx: NormalizeContext): ZoteroAttachmentRecord;
/**
 * Normalize a full item detail from the single-item response plus its
 * optional children and collection names. Only the include-requested child
 * kinds appear in the result; `bestAttachment` always prefers Zotero's own
 * `links.attachment` choice and borrows the child row's title when present.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the parent or a claimed child has no valid key.
 */
export declare function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail;
//# sourceMappingURL=normalize.d.ts.map