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

/** A capability a provider may safely support. `write` is declared but never implemented in V1. */
export type ZoteroCapability =
  | 'search'
  | 'metadata'
  | 'collections'
  | 'tags'
  | 'notes'
  | 'annotations'
  | 'fulltext'
  | 'attachments'
  | 'citation'
  | 'write'

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

export const ZOTERO_SORT_FIELDS = ['dateModified', 'dateAdded', 'date', 'title', 'creator'] as const

export type ZoteroSortField = (typeof ZOTERO_SORT_FIELDS)[number]

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
  bestAttachmentRef?: string
  bestAttachmentType?: string
  attachmentSize?: number
}

export interface ZoteroSearchResult {
  readonly scope: ZoteroResolvedScope
  items: ZoteroSearchItem[]
  readonly total: number
  readonly offset: number
  readonly returned: number
  nextOffset?: number
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
}

export interface ZoteroAnnotationRecord {
  readonly ref: string
  readonly type: string
  readonly text: string
  readonly comment?: string
  readonly color?: string
  /** Zotero-owned page label; never a plugin-invented locator. */
  readonly pageLabel?: string
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
  readonly comment?: string
  readonly pageLabel?: string
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
  readonly coverage?: ZoteroCoverage
  readonly evidence: readonly ZoteroEvidence[]
  readonly truncated: boolean
}

export type ZoteroAttachmentLocation =
  | { readonly ref: string; readonly title: string; readonly contentType: string; readonly kind: 'file'; readonly path: string }
  | { readonly ref: string; readonly title: string; readonly contentType: string; readonly kind: 'url'; readonly url: string }

/** Export/citation output formats. `citation`/`bibliography` use Zotero's CSL engine. */
export type ZoteroExportFormat = 'citation' | 'bibliography' | 'bibtex' | 'biblatex' | 'ris' | 'csljson'

export interface ZoteroExportRequest {
  readonly refs: readonly ZoteroObjectRef[]
  readonly format: ZoteroExportFormat
  readonly style?: string
  readonly locale?: string
}

/**
 * Citation exports keep Zotero's per-item HTML strings paired with their
 * refs, ordered as requested. The other formats are opaque formatted text
 * (the bibliography's ordering belongs to the CSL style, not the caller).
 */
export type ZoteroExportResult =
  | { readonly format: 'citation'; readonly style?: string; readonly locale?: string; readonly citations: readonly { readonly ref: string; readonly text: string }[] }
  | { readonly format: Exclude<ZoteroExportFormat, 'citation'>; readonly style?: string; readonly locale?: string; readonly text: string }

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
 * typed domain errors, and only `status()` performs a health check. The
 * retrieval-side domain methods (`retrieve`/`export`) join this interface in
 * the phases that implement them.
 */
export interface ZoteroProvider {
  readonly id: string
  readonly capabilities: ReadonlySet<ZoteroCapability>
  status(signal?: AbortSignal): Promise<ZoteroStatus>
  search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>
  getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>
  getAttachmentLocation(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation>
}
