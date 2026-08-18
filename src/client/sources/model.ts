/**
 * The session source model: the domain vocabulary of the Sources panel. One
 * `SourceItem` aggregates everything the session proved about one library
 * item — only settled, successful, structurally valid tool calls produce
 * facts. Running, failed, and stopped calls count into `operations` and are
 * never rendered as achievements. The model carries no harness execution
 * objects (no tool-call blocks); call-level diagnostics stay with the
 * built-in Trajectory view.
 * @module dsh-zotero/client/sources/model
 */

/** Provable outcome facts; every field is produced by successful calls only. */
export interface SourceFacts {
  /** A successful zotero_get read the item's detail. */
  readonly inspected: boolean
  /** Distinct evidence passages gathered by successful zotero_retrieve calls. */
  readonly evidenceCount: number
  /** A successful zotero_attachment resolved a usable location. */
  readonly attachmentResolved: boolean
  /** Successful zotero_export artifacts whose ref list included the item. */
  readonly exportCount: number
}

/** Non-successful call counts; never rendered as achievements. */
export interface OperationFacts {
  readonly running: number
  readonly failed: number
  readonly stopped: number
}

/**
 * The item's identity verdict against the connected instance: `verified`
 * when every qualified ref matches the current Server ID, `mismatch` when a
 * qualified ref belongs to a different instance, `unknown` when nothing
 * carries a qualifier or the current instance is unknown (offline).
 */
export type ItemProvenance = 'verified' | 'unknown' | 'mismatch'

/** The normalized search scope, free of raw tool arguments. */
export type SourceScope =
  | { readonly kind: 'library' }
  | { readonly kind: 'collection'; readonly ref?: string; readonly name?: string }
  | { readonly kind: 'savedSearch'; readonly ref?: string; readonly name?: string }

/** One logical search (pagination continuations fold into one entry). */
export interface SearchProvenance {
  readonly callId: string
  readonly query?: string
}

/** One deduplicated evidence passage with the calls that returned it. */
export interface EvidencePassage {
  readonly source: string
  readonly sourceRef: string
  readonly text: string
  readonly previewTruncated: boolean
  /** Zotero-owned page label (annotations only); never invented. */
  readonly pageLabel?: string
  /** Call ids of the successful retrieves that returned this passage. */
  readonly callIds: readonly string[]
}

/** Zotero's attachment selection hint (search/get facts); no resolved location. */
export interface AttachmentHint {
  readonly ref?: string
  readonly contentType?: string
}

/** A resolved attachment location from a successful zotero_attachment call. */
export interface SourceAttachment {
  readonly ref?: string
  readonly kind: 'file' | 'url'
  readonly contentType: string
  readonly title: string
  readonly location: string
}

/** The export facts of one successful artifact. */
export interface ExportArtifact {
  readonly callId: string
  readonly format: string
  readonly style?: string
  readonly locale?: string
  /** The exported refs (bounded by the presentation projection). */
  readonly refs: readonly string[]
  /** Exported refs beyond the bounded list. */
  readonly refsOmitted: number
  readonly text: string
}

/** Full-text indexing coverage as reported by Zotero. */
export interface SourceCoverage {
  readonly indexedPages?: number
  readonly totalPages?: number
  readonly indexedChars?: number
  readonly totalChars?: number
  readonly complete: boolean
}

/** One source's availability facts from a successful retrieve. */
export interface SourceAvailabilityEntry {
  readonly requested: boolean
  readonly returnedPassages: number
  readonly unavailable: boolean
}

/** Facts of the most recent successful retrieve on one item. */
export interface SourceRetrievalFacts {
  readonly attachmentRef?: string
  readonly coverage?: SourceCoverage
  /** The global passage/character budget omitted more evidence. */
  readonly truncated: boolean
  readonly sourceAvailability: Readonly<Record<string, SourceAvailabilityEntry>>
}

/** One library item with everything the session proved about it. */
export interface SourceItem {
  /** Normalized identity (query stripped, lowercased). */
  readonly key: string
  /** First-seen full ref, the display and copy form. */
  readonly ref: string
  readonly provenance: ItemProvenance
  readonly title?: string
  readonly creators?: string
  readonly year?: number
  readonly venue?: string
  readonly facts: SourceFacts
  readonly operations: OperationFacts
  readonly searches: readonly SearchProvenance[]
  readonly evidence: readonly EvidencePassage[]
  /** Zotero's attachment selection (search/get facts); never a resolved location. */
  readonly bestAttachment?: AttachmentHint
  /** The resolved location from a successful zotero_attachment call. */
  readonly attachment?: SourceAttachment
  /** Facts of the most recent successful retrieve on this item. */
  readonly retrievalFacts?: SourceRetrievalFacts
  readonly exports: readonly ExportArtifact[]
  /** Ordering: transcript position of the first touch. */
  readonly firstSeenAt: number
  /** Ordering: transcript position of the last touch. */
  readonly lastTouchedAt: number
}

/** The aggregated session sources plus session-wide facts. */
export interface SourceWorkspace {
  /** The stable union of all successful search hits and directly referenced items. */
  readonly sources: readonly SourceItem[]
  /** Every successful export artifact, in transcript order. */
  readonly exports: readonly ExportArtifact[]
  /** Non-successful export calls only; never rendered as results. */
  readonly exportOperations: OperationFacts
  /** Search rows the bounded presentation projections did not itemize. */
  readonly omittedRows: number
}
