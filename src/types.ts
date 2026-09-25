/**
 * Zotero domain vocabulary for the dsh-zotero plugin.
 *
 * Model-facing tools exchange {@link ZoteroObjectRef}s serialized as
 * `zotero://user/0/item/<KEY>` strings, optionally carrying the serving
 * instance's identity as a provenance qualifier
 * (`?server=<Zotero-Server-ID>`). Everything in this module is a plain
 * lossless-JSON-safe DTO; tool `execute` bodies return these values directly
 * as canonical tool results.
 *
 * Terminology: the "v3" in `BREAKING CHANGE` remarks below denotes this
 * plugin's own DTO contract iteration, not the Zotero wire API version.
 * @module dsh-zotero/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** A capability a provider may safely support. */
export type ZoteroCapability =
  | 'search'
  | 'metadata'
  | 'attachments'
  /** Reserved for providers exposing raw full-text access; retrieval itself uses `retrieve`. */
  | 'fulltext'
  | 'citation'
  | 'browse'
  /** Ranked evidence across a work's sources; not synonymous with raw fulltext access. */
  | 'retrieve'
  /** Incremental library reads through local transaction versions (`?since=`). */
  | 'changes'
  /**
   * Writes to the local personal library: research notes, tags, collection
   * membership. Zotero 10 gates every write behind a locally issued API key
   * and the serving instance id; the write domain owns that protocol.
   */
  | 'write'

/** The library a Zotero object lives in. The Local API serves the logged-in user's library. */
export interface ZoteroLibraryRef {
  type: 'user' | 'group'
  id: number
}

/** The canonical personal library: the local API's logged-in user. */
export type PersonalLibrary = { type: 'user'; id: 0 }
/** A synced group library by its positive group id. */
export type GroupLibrary = { type: 'group'; id: number }
/** The local libraries this plugin contract supports: canonical personal + any group. */
export type SupportedLocalLibrary = PersonalLibrary | GroupLibrary

/** The object kinds the reference grammar distinguishes. */
export type ZoteroKind = 'item' | 'attachment' | 'annotation' | 'collection' | 'search'

/**
 * A parsed Zotero object reference. `serverId`, when present, records which
 * Zotero instance (database) produced the ref; using the ref against a
 * different instance must fail closed instead of resolving same-key objects.
 */
export interface ZoteroObjectRef {
  library: ZoteroLibraryRef
  kind: ZoteroKind
  key: string
  serverId?: string
}

/** Live connectivity facts for one provider, rendered by `/zotero status`. */
export interface ZoteroStatus {
  providerId: string
  connected: boolean
  apiVersion?: string
  serverId?: string
  schemaVersion?: string
  /**
   * The answering Zotero build (`X-Zotero-Version`). The API version and the
   * schema version are the same on every build that speaks API v3, so this is
   * the only header that identifies which build is actually answering — the
   * fact a version-scoped expectation has to be checked against.
   */
  zoteroVersion?: string
  /**
   * The write state of the answering provider, present only when the provider
   * wires the write capability at all. `authorized` says whether a grant for
   * the connected instance is already stored — a diagnostic fact, never a
   * capability: the gate still answers every write.
   */
  write?: { enabled: boolean; authorized: boolean }
  diagnosis: string
}

/** Where `zotero_search` looks for items. */
export type ZoteroSearchScope =
  | { kind: 'library' }
  | { kind: 'publications' }
  | { kind: 'collection'; refOrName: string }
  | { kind: 'savedSearch'; refOrName: string }

/**
 * Resolved scope echoed back to the Agent so pagination reuses a stable ref.
 * @remarks BREAKING CHANGE v3: `kind:"library"` now carries `library: SupportedLocalLibrary`
 * (previously `{kind:"library"}` without library). Consumers must handle the new field;
 * `SEARCH_DEFAULT_SCOPE` (`{kind:"library"}`) is normalized to `{kind:"library", library:{user:0}}`.
 */
export type ZoteroResolvedScope =
  | { kind: 'library'; library: PersonalLibrary }
  | { kind: 'library'; library: GroupLibrary }
  | { kind: 'publications'; library: PersonalLibrary }
  | { kind: 'publications'; library: GroupLibrary }
  | { kind: 'collection'; ref: string; name: string }
  | { kind: 'savedSearch'; ref: string; name: string }

/**
 * Sort field names accepted by `zotero_search`. Mirrors the runtime
 * `ZOTERO_SORT_FIELDS` array in `constants.ts`; keep the two in sync.
 */
export type ZoteroSortField = 'dateModified' | 'dateAdded' | 'date' | 'title' | 'creator'

export type ZoteroSortDirection = 'asc' | 'desc'

/** Search mode: `metadata` matches title/creator/year; `everything` adds indexed full text. */
export type ZoteroSearchMode = 'metadata' | 'everything'

export interface ZoteroSearchRequest {
  query?: string
  mode: ZoteroSearchMode
  scope: ZoteroSearchScope
  /** Library for library-scope or name-resolution; omitted defaults to user/0. */
  library?: SupportedLocalLibrary
  itemTypes?: string[]
  tags?: string[]
  /** Tag query mode: all=AND (default) any=OR */
  tagMatch?: 'all' | 'any'
  excludeTags?: string[]
  includeTrashed?: boolean
  sort: ZoteroSortField
  direction: ZoteroSortDirection
  offset: number
  limit: number
}

/** One compact search hit. `bestAttachment*` come from Zotero's own attachment selection. */
export interface ZoteroSearchItem {
  ref: string
  title: string
  creatorSummary: string
  year?: number
  itemType: string
  /** Parent item of a child note; provenance-qualified like the record's own ref. */
  parentRef?: string
  bestAttachmentRef?: string
  bestAttachmentType?: string
  attachmentSize?: number
}

/**
 * First-page note-body supplement: client-side scanned matches listed apart
 * from the paged primary results. Zotero's index never searches note bodies,
 * so these hits cannot join the API page; listing them separately keeps
 * `items`/`total`/`returned`/`nextOffset` describing one collection under the
 * requested sort.
 */
export interface ZoteroSearchSupplement {
  kind: 'noteBody'
  items: ZoteroSearchItem[]
  /** Note rows the scan examined before returning (≤ `maxNoteScanRecords`). */
  scanned: number
  /** True when the scan stopped at `maxNoteScanRecords` before reaching the library's last note. */
  truncated: boolean
}

export interface ZoteroSearchResult {
  scope: ZoteroResolvedScope
  /** Primary API hits only — the collection `total`/`offset`/`returned`/`nextOffset` describe. */
  items: ZoteroSearchItem[]
  /** The paged API total — the count `offset` pagination walks; supplements are not part of it. */
  total: number
  offset: number
  /** Primary hits on this page (`items.length`); supplements never inflate it. */
  returned: number
  nextOffset?: number
  /**
   * On the first page of a library/collection-scope query (saved-search
   * scopes never scan), note-body matches fill unused result slots — listed
   * here, ordered by dateModified desc, capped by the page headroom and
   * `maxNoteScanRecords`; omitted when none matched.
   */
  supplemental?: ZoteroSearchSupplement
}

/** Child content kinds `zotero_get` can include beyond plain metadata. */
export type ZoteroInclude = 'notes' | 'annotations' | 'attachments'

/**
 * Child content kinds `zotero_children` returns. The tool explores the
 * Zotero object graph: an item ref yields its direct notes and attachments
 * plus every attachment's annotations; an attachment ref yields its own
 * annotations.
 */
export type ZoteroChildrenInclude = 'notes' | 'attachments' | 'annotations'

export interface ZoteroChildrenRequest {
  /** An item or attachment ref; annotation refs have no children and fail closed. */
  ref: ZoteroObjectRef
  include: ReadonlySet<ZoteroChildrenInclude>
}

/** The explored child-object graph of one item or attachment. */
export interface ZoteroChildrenResult {
  /** Echo of the requested object's ref, provenance-qualified with the serving instance. */
  ref: string
  /** The requested object's Zotero item type (`attachment` for attachment refs). */
  itemType?: string
  notes?: ZoteroChildCollection<ZoteroNoteRecord>
  annotations?: ZoteroChildCollection<ZoteroAnnotationRecord>
  attachments?: ZoteroChildCollection<ZoteroAttachmentRecord>
  /** Identity of the Zotero instance that served these records. */
  serverId?: string
}

export interface ZoteroGetRequest {
  ref: ZoteroObjectRef
  include: ReadonlySet<ZoteroInclude>
  /**
   * `standard` (default) returns the normalized model; `all` additionally
   * passes through every `data` field the model does not consume, so
   * dataset/patent/statute-style metadata survives instead of being dropped.
   */
  fields?: 'standard' | 'all'
}

export interface ZoteroNoteRecord {
  ref: string
  text: string
  truncated: boolean
  /** The note's parent item, when Zotero reports one; provenance-qualified like `ref`. */
  parentRef?: string
}

export interface ZoteroAnnotationRecord {
  ref: string
  type: string
  text: string
  comment?: string
  color?: string
  /** Zotero-owned page label; never a plugin-invented locator. */
  pageLabel?: string
  /** The annotation's parent attachment, when Zotero reports one; provenance-qualified like `ref`. */
  parentRef?: string
}

export interface ZoteroAttachmentRecord {
  ref: string
  title: string
  contentType: string
  linkMode?: string
}

export interface ZoteroCollectionRecord {
  ref: string
  name?: string
}

/** One included child kind: Zotero's total count plus the bounded records returned. */
export interface ZoteroChildCollection<T> {
  total: number
  returned: number
  items: T[]
}

export interface ZoteroItemDetail {
  ref: string
  itemType: string
  title: string
  creators: string[]
  date?: string
  year?: number
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  abstractTruncated: boolean
  /** The item's own note body, when the item is a note; bounded, `truncated` signals the cut. */
  noteBody?: { text: string; truncated: boolean }
  tags: string[]
  collections: ZoteroCollectionRecord[]
  children: { total: number }
  bestAttachment?: ZoteroAttachmentRecord
  notes?: ZoteroChildCollection<ZoteroNoteRecord>
  annotations?: ZoteroChildCollection<ZoteroAnnotationRecord>
  attachments?: ZoteroChildCollection<ZoteroAttachmentRecord>
  relations?: ZoteroRelation[]
  /** Local object version (Zotero 10+); may differ from Web API versions. */
  version?: number
  /** Identity of the Zotero instance that served this record. */
  serverId?: string
  /**
   * `data` fields the normalized model does not consume, present only when
   * the request asked `fields:"all"`. Values are lossless JSON.
   */
  extraFields?: Record<string, JsonValue>
}

/** Evidence sources `zotero_retrieve` can rank against the query. */
export type ZoteroEvidenceSource = 'annotation' | 'note' | 'fulltext' | 'abstract'

/**
 * How `zotero_retrieve` picks the attachment(s) whose full text enters
 * ranking. `best` (default) keeps Zotero's own single choice; `allIndexed`
 * ranks every PDF child as a first-class source; `specified` ranks exactly
 * the attachments named in `attachmentRefs`.
 */
export type ZoteroAttachmentPolicy = 'best' | 'allIndexed' | 'specified'

export interface ZoteroRetrieveRequest {
  ref: ZoteroObjectRef
  query: string
  sources: ZoteroEvidenceSource[]
  passages: number
  attachmentPolicy?: ZoteroAttachmentPolicy
  /** Required for `attachmentPolicy:"specified"`: attachment refs of the same library. */
  attachmentRefs?: ZoteroObjectRef[]
}

/**
 * A ranked field of an evidence passage. Only an annotation has two: the
 * highlight a reader selected (`text`) and the comment they wrote on it
 * (`comment`).
 */
export type ZoteroEvidenceField = 'text' | 'comment'

/** One bounded evidence passage. Fulltext passages never carry page locators. */
export interface ZoteroEvidence {
  source: ZoteroEvidenceSource
  sourceRef: string
  text: string
  /** Position within a multi-chunk source (note/fulltext), so the Agent can locate the span. */
  chunkIndex?: number
  /** Total chunks of the source this passage belongs to. */
  chunkCount?: number
  comment?: string
  pageLabel?: string
  /** The annotation passage's parent attachment ref; absent for other sources. */
  attachmentRef?: string
  /**
   * The passage's fields that carry matched query terms, so a match found in
   * the annotator's own comment is never read as the paper saying it. Present
   * only for the two-field source (an annotation carrying a comment); absence
   * means the passage's single text field carried the match.
   */
  matchedFields?: ZoteroEvidenceField[]
}

/**
 * How one attachment of a multi-attachment retrieval was accounted for:
 * `indexed` — its full text was read and entered the ranking; `unindexed` —
 * Zotero's index has no full text for it; `unread` — this call did not read
 * it, because the per-call attachment cap was already reached.
 */
export type ZoteroRetrieveAttachmentStatus = 'indexed' | 'unindexed' | 'unread'

/**
 * One full-text source a multi-attachment retrieval considered, whether or
 * not it contributed text. The record exists so a source that produced
 * nothing is visible instead of absent: a work whose supplement is
 * unindexed reads as "the supplement is not covered here", never as
 * "the supplement has nothing on this".
 */
export interface ZoteroRetrieveAttachment {
  ref: string
  contentType?: string
  status: ZoteroRetrieveAttachmentStatus
  /** Zotero's own indexing coverage for this file; present when indexed. */
  coverage?: ZoteroCoverage
  /** True when this file's share of the call's character budget cut its text. */
  inputTruncated?: boolean
  /** Passages this file contributed to the ranked corpus, returned or not. */
  passages?: number
}

/** Full-text indexing coverage as reported by Zotero; `complete` is derived. */
export interface ZoteroCoverage {
  indexedPages?: number
  totalPages?: number
  indexedChars?: number
  totalChars?: number
  complete: boolean
}

export interface ZoteroRetrieveResult {
  ref: string
  /**
   * The attachment behind the fulltext evidence when exactly one attachment
   * contributed; with several (allIndexed/specified), per-passage
   * `attachmentRef` provenance carries the mapping instead.
   */
  attachmentRef?: string
  /** The content type of the attachment `attachmentRef` points at; absent when Zotero reported none. */
  attachmentContentType?: string
  coverage?: ZoteroCoverage
  /**
   * Every full-text source a multi-attachment policy considered, with its
   * status and what it contributed. Absent under `best`, whose single
   * source is already named by `attachmentRef`/`coverage`.
   */
  attachments?: ZoteroRetrieveAttachment[]
  evidence: ZoteroEvidence[]
  truncated: boolean
  /** Requested sources the item could not provide; retrieval degrades instead of failing. */
  sourcesSkipped: ZoteroEvidenceSource[]
}

export type ZoteroAttachmentLocation =
  | {
      ref: string
      title: string
      contentType: string
      kind: 'file'
      path: string
    }
  | {
      ref: string
      title: string
      contentType: string
      kind: 'url'
      url: string
    }

/** Export/citation output formats. `citation`/`bibliography` use Zotero's CSL engine. */
export type ZoteroExportFormat =
  'citation' | 'bibliography' | 'bibtex' | 'biblatex' | 'ris' | 'csljson'

/**
 * @remarks BREAKING CHANGE v3: Export is single-library only. All refs must belong to the same
 * `SupportedLocalLibrary` (personal user/0 or a single group). Mixed libraries throw
 * `ZOTERO_INVALID_ARGUMENT` with 0 HTTP; split by library.
 */
export interface ZoteroExportRequest {
  refs: ZoteroObjectRef[]
  format: ZoteroExportFormat
  style?: string
  locale?: string
}

/**
 * One exported document inside a translator-format export, keyed to its ref
 * and located within the merged body. The provider maps each ref to its
 * batch entry on the server (by content for BibTeX/BibLaTeX, by record id
 * for RIS and CSL JSON), so the browser never guesses which entry belongs
 * to which ref — the merged body's entry order belongs to Zotero, and
 * citation keys are generated in the export context.
 */
export interface ZoteroExportItem {
  /** The formatted `zotero://` ref the entry was exported for. */
  ref: string
  /**
   * The batch body's real key: the BibTeX/BibLaTeX citation key or the CSL
   * JSON id; absent when the format has none (RIS) or the entry could not
   * be located.
   */
  key?: string
  /** The item's title for display, when the entry carried one. */
  title?: string
  /** The located entry's index within the parsed CSL JSON array. */
  entryIndex?: number
  /** The located entry's start offset within the trimmed batch body. */
  start?: number
  /** The located entry's end offset (exclusive) within the trimmed batch body. */
  end?: number
}

/**
 * Citation exports keep Zotero's per-item HTML strings paired with their
 * refs, ordered as requested. The bibliography's ordering belongs to the CSL
 * style, not the caller. The translator formats keep the merged body opaque
 * (same ordering caveat) but itemize each exported document with its ref.
 */
export type ZoteroExportResult =
  | {
      format: 'citation'
      style?: string
      locale?: string
      citations: { ref: string; text: string }[]
    }
  | {
      format: 'bibliography'
      style?: string
      locale?: string
      text: string
    }
  | {
      format: 'bibtex' | 'biblatex' | 'ris' | 'csljson'
      style?: string
      locale?: string
      text: string
      items: ZoteroExportItem[]
    }

/** Raw fulltext payload from `GET /items/<attachmentKey>/fulltext`. */
export interface ZoteroFulltextPayload {
  content: string
  indexedPages?: number
  totalPages?: number
  indexedChars?: number
  totalChars?: number
}

/** A single relation extracted from Zotero data.relations */
export interface ZoteroRelation {
  predicate: string
  targetUri: string
  targetRef?: string
}

/** Bounded browse kinds (v3 lock: no recursive collection) */
export type ZoteroBrowseKind =
  'libraries' | 'collections' | 'savedSearches' | 'tags' | 'itemTypes' | 'itemFields'

export interface ZoteroBrowseRequest {
  kind: ZoteroBrowseKind
  library?: SupportedLocalLibrary
  /**
   * Collections only: a collection ref whose children to list. Omitted lists
   * top-level collections (`/collections/top`); present lists that
   * collection's children (`/collections/<key>/collections`) — real
   * server-side tree navigation instead of one whole-library snapshot.
   */
  parentRef?: string
  /**
   * Tags only: the item set whose tags the listing counts. Omitted keeps the
   * whole-library `/tags` listing; `collection` and `publications` use the
   * scoped tag endpoints, turning browse into a faceted-navigation primitive
   * (search → scoped tags for the same query → narrow).
   */
  scope?: ZoteroTagScope
  /** Tags only with a scope: `top` counts bibliographic items (default), `all` includes child items. */
  itemLevel?: 'top' | 'all'
  /** Tags only with a scope: count only tags of items matching this item query (`itemQ`). */
  itemQuery?: string
  /** Tags only with an itemQuery: the Zotero item-query mode (default titleCreatorYear). */
  itemQueryMode?: 'titleCreatorYear' | 'everything'
  /** ItemFields only: the Zotero item type whose fields and creator types to list. */
  itemType?: string
  q?: string
  match?: 'contains' | 'startsWith'
  offset: number
  limit: number
}

/** The item set a scoped tags listing counts over. */
export type ZoteroTagScope =
  { kind: 'library' } | { kind: 'collection'; refOrName: string } | { kind: 'publications' }

export interface ZoteroLibraryInfo {
  library: SupportedLocalLibrary
  name: string
}

export interface ZoteroCollectionInfo {
  ref: string
  name: string
  parentRef?: string
  path: string[]
  depth: number
}

export interface ZoteroSavedSearchInfo {
  ref: string
  name: string
  /** Zotero's saved-search condition rows; absent when the record carried none. */
  conditions?: Record<string, JsonValue>[]
}

export interface ZoteroTagInfo {
  tag: string
  count?: number
}

export interface ZoteroItemTypeInfo {
  itemType: string
  localized?: string
}

/** One metadata field valid for a requested item type, with its localized label. */
export interface ZoteroItemFieldInfo {
  field: string
  localized?: string
}

/** One creator type valid for a requested item type. */
export interface ZoteroCreatorTypeInfo {
  creatorType: string
  localized?: string
}

export type ZoteroBrowseItem =
  | ZoteroLibraryInfo
  | ZoteroCollectionInfo
  | ZoteroSavedSearchInfo
  | ZoteroTagInfo
  | ZoteroItemTypeInfo
  | ZoteroItemFieldInfo
  | ZoteroCreatorTypeInfo

export interface ZoteroBrowseResult {
  kind: ZoteroBrowseKind
  library?: SupportedLocalLibrary
  serverId?: string
  items: ZoteroBrowseItem[]
  total: number
  offset: number
  returned: number
  nextOffset?: number
}

/** The resource kinds `zotero_changes` can diff. */
export type ZoteroChangesInclude =
  'items' | 'collections' | 'savedSearches' | 'fulltext' | 'deleted'

/**
 * An incremental checkpoint: the library version a diff read through, pinned
 * to the instance and the library it came from.
 *
 * A library version is a counter of one database's transactions — the same
 * integer means unrelated things in another Zotero instance, and nothing at
 * all in another library. A cursor therefore carries its provenance, and
 * passing one back is the only way to diff from a previous read: the instance
 * travels with the request as `Zotero-Server-ID` (the server rejects a foreign
 * one with 412), the library is checked before any read, and the covered
 * resource kinds travel with the checkpoint so a later diff cannot silently
 * switch streams and skip changes.
 */
export interface ZoteroChangesCursor {
  /** The instance the version describes (`Zotero-Server-ID` of its responses). */
  serverId: string
  /** The library whose version counter `version` belongs to. */
  library: SupportedLocalLibrary
  /** The library version the diff read through. */
  version: number
  /** Resource kinds this checkpoint covered; reuse it with the same include set. */
  include: ZoteroChangesInclude[]
}

export interface ZoteroChangesRequest {
  library?: SupportedLocalLibrary
  /**
   * The cursor to diff from, passed back verbatim from an earlier result.
   * Omitted takes a baseline reading: the result carries the current cursor,
   * which the next call can pass as `since`.
   */
  since?: ZoteroChangesCursor
  include?: ReadonlySet<ZoteroChangesInclude>
}

/** One changed object: its key and the local version it reached. */
export interface ZoteroChangedObject {
  key: string
  version: number
}

/** Why a kind this call included contributed nothing to the diff. */
export type ZoteroChangesUnobservableReason =
  /**
   * The build does not serve the endpoint (it answered 404). The kind is not
   * observable in any range on this build, so no cursor could ever account for
   * it and withholding one would not recover anything.
   */
  | 'not-served'
  /**
   * The build serves the kind but not back to `fromVersion` (Zotero's delete
   * log starts later and answered 409). Removals in this range are lost; a
   * fresh baseline covers them from here on.
   */
  | 'range-not-covered'
  /**
   * The response arrived but did not carry the documented shape, so this call
   * cannot know what changed. Unlike the two above, the data exists and this
   * call failed to read it — which is why this reason withholds the cursor.
   */
  | 'unreadable'

/** A kind this call included that contributed nothing, and the reason why. */
export interface ZoteroChangesUnobservable {
  kind: ZoteroChangesInclude
  reason: ZoteroChangesUnobservableReason
}

/**
 * The true changed-object counts per resource, as the server reported them.
 * A listing under `changed` / `deleted` may be capped for the model; these are
 * the totals behind it, and they are also what tells a caller how much of a
 * capped listing it is not seeing. A count is present exactly when its kind
 * was read, so presence — not the value — is the coverage statement.
 */
export interface ZoteroChangesTotals {
  /** Changed live top-level items. */
  items?: number
  /** Changed live child objects: notes, attachments, annotations. */
  childItems?: number
  /** Changed items currently in the trash. */
  trashedItems?: number
  collections?: number
  savedSearches?: number
  /** Rows the full-text index listed — the index's counter, not the library version. */
  fulltextAttachments?: number
  deletedItems?: number
  deletedCollections?: number
  deletedSavedSearches?: number
  /** Tombstoned tags (names, not keys). */
  deletedTags?: number
  /** Tombstoned entries of kinds this plugin does not model. */
  deletedOther?: number
}

export interface ZoteroChangesResult {
  library: SupportedLocalLibrary
  serverId?: string
  /** The version the diff started from; absent on a baseline reading. */
  fromVersion?: number
  /**
   * The checkpoint to diff from next — present only when this call verified
   * the whole reported range, the library version did not move while it read,
   * and the instance answering is known, which is what makes it safe to pass
   * back as `since`. Absent means the caller must not advance from this
   * result. The version inside is the one the diff read through.
   *
   * For a standalone resource, a kind that is `not-served` or
   * `range-not-covered` does not withhold the cursor: those changes were never
   * observable, so no version could account for them. The `items` kind is
   * stricter — every top-level, live, and trash partition must succeed. An
   * `unreadable` kind always withholds the cursor, because the rows exist and
   * this call failed to read them. A result that explicitly includes
   * independently versioned `fulltext` also omits the library cursor.
   */
  cursor?: ZoteroChangesCursor
  /**
   * A write landed in the library while this call was reading, so the range
   * could not be pinned to a version (`cursor` is withheld). Re-running is
   * the remedy: the next call either reads a quiet library or reports again.
   */
  libraryChanged?: boolean
  /**
   * The answering build reported no library version for this call, so no
   * version can be read or advanced here — a Zotero build without local
   * transaction versions cannot be diffed at all. This is decided per call
   * from what the responses carry, never from a version number: the wire has
   * no header that says which build serves versioned reads.
   */
  versionUnavailable?: boolean
  changed: {
    /**
     * Changed live top-level items (`/items/top`), the entries a library
     * listing shows.
     */
    items?: ZoteroChangedObject[]
    /**
     * Changed live child objects — notes, attachments, and annotations, read
     * as the difference between `/items` and `/items/top`. They carry their
     * own versions, so an edit to one of them advances the library without
     * touching its parent; reporting only top-level items would drop them
     * silently.
     */
    childItems?: ZoteroChangedObject[]
    /**
     * Changed items that are currently in the trash (`/items/trash`). Zotero's
     * item listings exclude the trash, so without this read trashing an item
     * would advance the library version invisibly.
     */
    trashedItems?: ZoteroChangedObject[]
    collections?: ZoteroChangedObject[]
    savedSearches?: ZoteroChangedObject[]
    /**
     * Attachments the full-text index mentions (`/fulltext?since=`). That
     * endpoint filters on the index's own version counter rather than the
     * library version, so these rows are a listing and not a delta on
     * `cursor` — they are read only when a caller names `fulltext`.
     */
    fulltextAttachments?: ZoteroChangedObject[]
  }
  /**
   * Tombstoned objects, keyed by kind. Present exactly when the tombstone read
   * was observed — an empty object is the positive statement "nothing was
   * removed in this range", which is why it is never omitted for brevity.
   */
  deleted?: {
    items: string[]
    collections: string[]
    savedSearches: string[]
    /** Tombstoned tag names; the endpoint lists names, not keys. */
    tags: string[]
  }
  /** The uncapped changed counts behind `changed` and `deleted`. */
  totals?: ZoteroChangesTotals
  /**
   * Resource kinds this call included that contributed nothing, each with the
   * reason. Absence from this list is the statement that the kind was read.
   */
  unobservable?: ZoteroChangesUnobservable[]
  /** True when a listing was capped at the configured display bound. */
  truncated?: boolean
}

/**
 * The write domain. Zotero 10 accepts local writes only behind its own
 * authorization: a locally issued API key bound to the serving instance id.
 * Requests here are validated and converted by the provider (markdown
 * becomes note HTML under an escape-unknown grammar); a per-object failure
 * inside a batch surfaces as a typed error, never as a silently skipped
 * object. Every applied result carries the written object's ref and the
 * library version the write advanced to.
 */
export interface ZoteroCreateNoteRequest {
  /** The note body in markdown; converted to safe note HTML under the plugin's restricted grammar. */
  markdown: string
  /** Parent item ref: the note is created as that item's child note. */
  parentItem?: ZoteroObjectRef
  /**
   * Collections (refs or names) a standalone note joins. Must be omitted (or
   * empty) when `parentItem` is set — child notes inherit their parent's
   * collections; non-empty collections on a child note are refused with
   * `WRITE_CHILD_COLLECTIONS_MESSAGE` at the tool `buildRequest` and again in
   * the write domain for non-tool callers.
   */
  collections?: string[]
  /** Tags applied at creation. */
  tags?: string[]
  /** Source item refs the note derives from, recorded as `dc:relation` links. */
  sourceRefs?: ZoteroObjectRef[]
}

export interface ZoteroCreateNoteResult {
  kind: 'applied'
  /** The created note ref, provenance-qualified with the serving instance id. */
  ref: string
  key: string
  /** The note's object version; equals the library version it was written at. */
  version: number
  /** The parent item ref, for a child note. */
  parentItem?: string
  /** Collections Zotero saved on the note, as refs; empty for a child note. Never filled from the request. */
  collections: string[]
  /** Tags as Zotero saved them. Never filled from the request. */
  tags: string[]
  /** The source relations as Zotero recorded them, echoed back as `zotero://...` refs. Never filled from the request. */
  sourceRefs: string[]
  /** The library version the write advanced the library to. */
  libraryVersion: number
  serverId?: string
}

/**
 * A note write that must be treated as committed for retry safety, although
 * Zotero's response could not prove the complete saved state. This is
 * deliberately not an ordinary retryable error: retrying can create a
 * duplicate note. Reconcile by the returned key/ref when one is available.
 */
export interface ZoteroCreateNoteCommittedUnverified {
  kind: 'committed-unverified'
  /** The caller must not retry; for `commit-unknown` this is conservative. */
  committed: true
  retryable: false
  reason: 'saved-state-unverified' | 'commit-unknown'
  ref?: string
  key?: string
  version?: number
  /** Present when the response supplied a trustworthy library version. */
  libraryVersion?: number
  serverId: string
}

export interface ZoteroTagUpdateRequest {
  /** The item to tag. */
  item: ZoteroObjectRef
  /** Tags to add. Existing tags and their colored/automatic types are preserved. */
  tags: string[]
}

export interface ZoteroTagUpdateResult {
  kind: 'applied'
  ref: string
  /** The item's version after the update. */
  version: number
  /** The full tag list now on the item. */
  tags: string[]
  /** The tags this call added. */
  added: string[]
  /** True when every requested tag was already present and nothing was written. */
  unchanged: boolean
  /** The library version the write advanced the library to; absent when unchanged. */
  libraryVersion?: number
  serverId?: string
}

export interface ZoteroCollectionAddRequest {
  /** The item to add. */
  item: ZoteroObjectRef
  /** The collection to add it to, as a ref or a name. */
  collection: string
}

export interface ZoteroCollectionAddResult {
  kind: 'applied'
  ref: string
  /** The item's version after the update. */
  version: number
  /** The item's collections after the add, as refs. */
  collections: string[]
  /** True when the item was newly added; false when it was already a member. */
  added: boolean
  /** The library version the write advanced the library to; absent when already a member. */
  libraryVersion?: number
  serverId?: string
}

/**
 * The outcome when the user answers the plan-review card without approving.
 * Nothing was written, nothing was contacted beyond the approval channel,
 * and the tool returns this instead of an error — declining is a normal
 * outcome, not a failure.
 */
export interface ZoteroWriteDeclined {
  kind: 'declined'
}

export type ZoteroCreateNoteCommittedOutcome =
  ZoteroCreateNoteResult | ZoteroCreateNoteCommittedUnverified

export type ZoteroCreateNoteOutcome = ZoteroCreateNoteCommittedOutcome | ZoteroWriteDeclined
export type ZoteroTagUpdateOutcome = ZoteroTagUpdateResult | ZoteroWriteDeclined
export type ZoteroCollectionAddOutcome = ZoteroCollectionAddResult | ZoteroWriteDeclined

/**
 * The storage side of the `ctx.zotero` seam. Providers declare which
 * capabilities they safely support; the service gates every domain call on
 * that declaration first and on the corresponding method's presence second —
 * a provider that does not serve a domain simply omits the capability and
 * leaves the method undefined, so no stub is required. The Agent never sees
 * which provider satisfied a request. `available()` is deliberately absent:
 * request-driven providers fail with typed domain errors, and only `status()`
 * performs a health check.
 */
export interface ZoteroProvider {
  id: string
  capabilities: ReadonlySet<ZoteroCapability>
  /**
   * Probe connectivity and report the instance identity facts.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the status record; failures are reported in `diagnosis`, never
   *   thrown — except an explicit caller abort, which propagates so a cancel
   *   is never mistaken for a connectivity problem.
   */
  status(signal?: AbortSignal): Promise<ZoteroStatus>
  /**
   * Discover candidates in the requested scope.
   * @param request - scope, mode, filters, sort, and pagination.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the resolved scope plus the compact hit records.
   */
  search?(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>
  /**
   * Read one item's detail, including requested child kinds.
   * @param request - the item ref and the child kinds to include.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the normalized item detail.
   */
  getItem?(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>
  /**
   * Explore one item's or attachment's child-object graph.
   * @param request - the item/attachment ref and the child kinds to return.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the bounded child collections with their totals.
   */
  children?(request: ZoteroChildrenRequest, signal?: AbortSignal): Promise<ZoteroChildrenResult>
  /**
   * Diff the library against a local transaction version.
   * @param request - the baseline version and the resource kinds to diff.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns changed/deleted keys plus the library's current version.
   */
  changes?(request: ZoteroChangesRequest, signal?: AbortSignal): Promise<ZoteroChangesResult>
  /**
   * Resolve an item or attachment ref to a usable location.
   * @param ref - the item or attachment ref to resolve.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the verified file path or linked URL.
   */
  getAttachmentLocation?(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation>
  /**
   * Gather ranked evidence passages for one item.
   * @param request - the item ref, ranking query, sources, and passage cap.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the bounded ranked evidence with a truncation flag.
   */
  retrieve?(request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>
  /**
   * Export citations or formatted output for the requested items.
   * @param request - the item refs, format, and optional style/locale.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns per-ref citations or the joined export text.
   */
  export?(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult>
  browse?(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>
  /**
   * Create a research note (standalone or under a parent item) with tags,
   * collections, and source relations.
   * @param request - the markdown body, optional parent, collections, tags, and sources.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the created note's verified saved state, or an explicit
   *   committed-unverified outcome when the response cannot prove the saved
   *   state or the post-dispatch commit outcome.
   */
  createNote?(
    request: ZoteroCreateNoteRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateNoteCommittedOutcome>
  /**
   * Add tags to an item (read-merge-write; existing tags are preserved).
   * @param request - the item ref and the tags to add.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the merged tag list, the additions, and the resulting versions.
   */
  updateTags?(request: ZoteroTagUpdateRequest, signal?: AbortSignal): Promise<ZoteroTagUpdateResult>
  /**
   * Add an item to a collection (read-merge-write).
   * @param request - the item ref and the collection ref or name.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the resulting collection list and whether the membership is new.
   */
  addToCollection?(
    request: ZoteroCollectionAddRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCollectionAddResult>
}

/**
 * A directly callable provider method name. Capability `metadata` gates both
 * `getItem` and `children`; `retrieve` and `changes` consume full-text data
 * internally, so call sites name their method explicitly. Derived from the interface so a new
 * domain method cannot drift from this union.
 */
export type ZoteroProviderMethod = Exclude<keyof ZoteroProvider, 'id' | 'capabilities' | 'status'>
