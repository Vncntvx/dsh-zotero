/**
 * Zotero domain vocabulary for the dsh-zotero plugin.
 *
 * Model-facing tools exchange {@link ZoteroObjectRef}s serialized as
 * `zotero://user/0/item/<KEY>` strings, optionally carrying the serving
 * instance's identity as a provenance qualifier
 * (`?server=<Zotero-Server-ID>`). Everything in this module is a plain
 * lossless-JSON-safe DTO; tool `execute` bodies return these values directly
 * as canonical tool results.
 * @module dsh-zotero/types
 */

/** A capability a provider may safely support. */
export type ZoteroCapability = 'search' | 'metadata' | 'attachments' | 'fulltext' | 'citation'

/** The library a Zotero object lives in. The Local API serves the logged-in user's library. */
export interface ZoteroLibraryRef {
  readonly type: 'user' | 'group'
  readonly id: number
}

/** The object kinds the reference grammar distinguishes. */
export type ZoteroKind = 'item' | 'attachment' | 'annotation' | 'collection' | 'search'

/**
 * A parsed Zotero object reference. `serverId`, when present, records which
 * Zotero instance (database) produced the ref; using the ref against a
 * different instance must fail closed instead of resolving same-key objects.
 */
export interface ZoteroObjectRef {
  readonly library: ZoteroLibraryRef
  readonly kind: ZoteroKind
  readonly key: string
  readonly serverId?: string
}

/** Live connectivity facts for one provider, rendered by `/zotero status`. */
export interface ZoteroStatus {
  readonly providerId: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  readonly diagnosis: string
}

/** Where `zotero_search` looks for items. */
export type ZoteroSearchScope =
  | { readonly kind: 'library' }
  | { readonly kind: 'collection'; readonly refOrName: string }
  | { readonly kind: 'savedSearch'; readonly refOrName: string }

/** Resolved scope echoed back to the Agent so pagination reuses a stable ref. */
export type ZoteroResolvedScope =
  | { readonly kind: 'library' }
  | { readonly kind: 'collection'; readonly ref: string; readonly name: string }
  | { readonly kind: 'savedSearch'; readonly ref: string; readonly name: string }

/**
 * Sort field names accepted by `zotero_search`. Mirrors the runtime
 * `ZOTERO_SORT_FIELDS` array in `constants.ts`; keep the two in sync.
 */
export type ZoteroSortField = 'dateModified' | 'dateAdded' | 'date' | 'title' | 'creator'

export type ZoteroSortDirection = 'asc' | 'desc'

/** Search mode: `metadata` matches title/creator/year; `everything` adds indexed full text. */
export type ZoteroSearchMode = 'metadata' | 'everything'

export interface ZoteroSearchRequest {
  readonly query?: string
  readonly mode: ZoteroSearchMode
  readonly scope: ZoteroSearchScope
  readonly itemTypes?: readonly string[]
  readonly tags?: readonly string[]
  readonly sort: ZoteroSortField
  readonly direction: ZoteroSortDirection
  readonly offset: number
  readonly limit: number
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

export interface ZoteroSearchResult {
  readonly scope: ZoteroResolvedScope
  items: ZoteroSearchItem[]
  /** The paged API total — the count `offset` pagination walks; note-body matches are not part of it. */
  readonly total: number
  readonly offset: number
  readonly returned: number
  nextOffset?: number
  /**
   * Client-side note-body matches merged into this first page (offset 0 only,
   * library/collection scopes). They fill the page up to `limit` but are not
   * counted in `total`, so pagination stays API-driven; omitted when none.
   */
  noteMatches?: number
}

/** Child content kinds `zotero_get` can include beyond plain metadata. */
export type ZoteroInclude = 'notes' | 'annotations' | 'attachments'

export interface ZoteroGetRequest {
  readonly ref: ZoteroObjectRef
  readonly include: ReadonlySet<ZoteroInclude>
}

export interface ZoteroNoteRecord {
  readonly ref: string
  readonly text: string
  readonly truncated: boolean
  /** The note's parent item, when Zotero reports one; provenance-qualified like `ref`. */
  readonly parentRef?: string
}

export interface ZoteroAnnotationRecord {
  readonly ref: string
  readonly type: string
  readonly text: string
  readonly comment?: string
  readonly color?: string
  /** Zotero-owned page label; never a plugin-invented locator. */
  readonly pageLabel?: string
  /** The annotation's parent attachment, when Zotero reports one; provenance-qualified like `ref`. */
  readonly parentRef?: string
}

export interface ZoteroAttachmentRecord {
  readonly ref: string
  readonly title: string
  readonly contentType: string
  readonly linkMode?: string
}

export interface ZoteroCollectionRecord {
  readonly ref: string
  readonly name?: string
}

/** One included child kind: Zotero's total count plus the bounded records returned. */
export interface ZoteroChildCollection<T> {
  readonly total: number
  readonly returned: number
  readonly items: T[]
}

export interface ZoteroItemDetail {
  readonly ref: string
  readonly itemType: string
  readonly title: string
  readonly creators: string[]
  readonly date?: string
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly url?: string
  readonly abstract?: string
  readonly abstractTruncated: boolean
  /** The item's own note body, when the item is a note; bounded, `truncated` signals the cut. */
  readonly noteBody?: { readonly text: string; readonly truncated: boolean }
  readonly tags: string[]
  readonly collections: ZoteroCollectionRecord[]
  readonly children: { readonly total: number }
  readonly bestAttachment?: ZoteroAttachmentRecord
  readonly notes?: ZoteroChildCollection<ZoteroNoteRecord>
  readonly annotations?: ZoteroChildCollection<ZoteroAnnotationRecord>
  readonly attachments?: ZoteroChildCollection<ZoteroAttachmentRecord>
  /** Local object version (Zotero 10+); may differ from Web API versions. */
  readonly version?: number
  /** Identity of the Zotero instance that served this record. */
  readonly serverId?: string
}

/** Evidence sources `zotero_retrieve` can rank against the query. */
export type ZoteroEvidenceSource = 'annotation' | 'note' | 'fulltext' | 'abstract'

export interface ZoteroRetrieveRequest {
  readonly ref: ZoteroObjectRef
  readonly query: string
  readonly sources: readonly ZoteroEvidenceSource[]
  readonly passages: number
}

/** One bounded evidence passage. Fulltext passages never carry page locators. */
export interface ZoteroEvidence {
  readonly source: ZoteroEvidenceSource
  readonly sourceRef: string
  readonly text: string
  /** Position within a multi-chunk source (note/fulltext), so the Agent can locate the span. */
  readonly chunkIndex?: number
  /** Total chunks of the source this passage belongs to. */
  readonly chunkCount?: number
  readonly comment?: string
  readonly pageLabel?: string
  /** The annotation passage's parent attachment ref; absent for other sources. */
  readonly attachmentRef?: string
}

/** Full-text indexing coverage as reported by Zotero; `complete` is derived. */
export interface ZoteroCoverage {
  readonly indexedPages?: number
  readonly totalPages?: number
  readonly indexedChars?: number
  readonly totalChars?: number
  readonly complete: boolean
}

export interface ZoteroRetrieveResult {
  readonly ref: string
  readonly attachmentRef?: string
  /** The content type of the attachment `attachmentRef` points at; absent when Zotero reported none. */
  readonly attachmentContentType?: string
  readonly coverage?: ZoteroCoverage
  readonly evidence: ZoteroEvidence[]
  readonly truncated: boolean
  /** Requested sources the item could not provide; retrieval degrades instead of failing. */
  readonly sourcesSkipped: ZoteroEvidenceSource[]
}

export type ZoteroAttachmentLocation =
  | {
      readonly ref: string
      readonly title: string
      readonly contentType: string
      readonly kind: 'file'
      readonly path: string
    }
  | {
      readonly ref: string
      readonly title: string
      readonly contentType: string
      readonly kind: 'url'
      readonly url: string
    }

/** Export/citation output formats. `citation`/`bibliography` use Zotero's CSL engine. */
export type ZoteroExportFormat =
  'citation' | 'bibliography' | 'bibtex' | 'biblatex' | 'ris' | 'csljson'

export interface ZoteroExportRequest {
  readonly refs: readonly ZoteroObjectRef[]
  readonly format: ZoteroExportFormat
  readonly style?: string
  readonly locale?: string
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
  readonly ref: string
  /**
   * The batch body's real key: the BibTeX/BibLaTeX citation key or the CSL
   * JSON id; absent when the format has none (RIS) or the entry could not
   * be located.
   */
  readonly key?: string
  /** The item's title for display, when the entry carried one. */
  readonly title?: string
  /** The located entry's index within the parsed CSL JSON array. */
  readonly entryIndex?: number
  /** The located entry's start offset within the trimmed batch body. */
  readonly start?: number
  /** The located entry's end offset (exclusive) within the trimmed batch body. */
  readonly end?: number
}

/**
 * Citation exports keep Zotero's per-item HTML strings paired with their
 * refs, ordered as requested. The bibliography's ordering belongs to the CSL
 * style, not the caller. The translator formats keep the merged body opaque
 * (same ordering caveat) but itemize each exported document with its ref.
 */
export type ZoteroExportResult =
  | {
      readonly format: 'citation'
      readonly style?: string
      readonly locale?: string
      readonly citations: { readonly ref: string; readonly text: string }[]
    }
  | {
      readonly format: 'bibliography'
      readonly style?: string
      readonly locale?: string
      readonly text: string
    }
  | {
      readonly format: 'bibtex' | 'biblatex' | 'ris' | 'csljson'
      readonly style?: string
      readonly locale?: string
      readonly text: string
      readonly items: ZoteroExportItem[]
    }

/** Raw fulltext payload from `GET /items/<attachmentKey>/fulltext`. */
export interface ZoteroFulltextPayload {
  readonly content: string
  readonly indexedPages?: number
  readonly totalPages?: number
  readonly indexedChars?: number
  readonly totalChars?: number
}

/**
 * The storage side of the `ctx.zotero` seam. Providers declare which
 * capabilities they safely support; the service gates every domain call on
 * that declaration. The Agent never sees which provider satisfied a request.
 * `available()` is deliberately absent: request-driven providers fail with
 * typed domain errors, and only `status()` performs a health check.
 */
export interface ZoteroProvider {
  readonly id: string
  readonly capabilities: ReadonlySet<ZoteroCapability>
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
  search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>
  /**
   * Read one item's detail, including requested child kinds.
   * @param request - the item ref and the child kinds to include.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the normalized item detail.
   */
  getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>
  /**
   * Resolve an item or attachment ref to a usable location.
   * @param ref - the item or attachment ref to resolve.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the verified file path or linked URL.
   */
  getAttachmentLocation(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation>
  /**
   * Gather ranked evidence passages for one item.
   * @param request - the item ref, ranking query, sources, and passage cap.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns the bounded ranked evidence with a truncation flag.
   */
  retrieve(request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>
  /**
   * Export citations or formatted output for the requested items.
   * @param request - the item refs, format, and optional style/locale.
   * @param signal - caller cancellation; forwarded to the transport.
   * @returns per-ref citations or the joined export text.
   */
  export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult>
}
