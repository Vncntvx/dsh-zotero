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
interface SourceFacts {
  /** A successful zotero_get read the item's detail. */
  readonly inspected: boolean
  /** Distinct evidence passages kept after dedup and preview budget. */
  readonly evidenceCount: number
  /** Total evidence passages reported across all successful retrieves. */
  readonly reportedEvidenceCount: number
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

/**
 * One logical search (pagination continuations fold into one entry). The
 * mode, scope, and filter fields are the episode's own arguments — captured
 * at episode creation, never re-parsed from an identity string.
 */
export interface SearchProvenance {
  readonly callId: string
  readonly query?: string
  /** The search's mode argument: metadata-only or full text. */
  readonly mode: 'metadata' | 'everything'
  /** The normalized scope argument (library, collection, or saved search). */
  readonly scope: SourceScope
  /** The item-type filter arguments, normalized (deduplicated, sorted). */
  readonly itemTypes: readonly string[]
  /** The tag filter arguments, normalized (deduplicated, sorted). */
  readonly tags: readonly string[]
}

/** One deduplicated evidence passage with the calls that returned it. */
export interface EvidencePassage {
  readonly source: string
  readonly sourceRef: string
  readonly text: string
  readonly previewTruncated: boolean
  /** Zotero-owned page label (annotations only); never invented. */
  readonly pageLabel?: string
  /** The annotation passage's parent attachment ref; lets the jump target the annotation's own PDF. */
  readonly attachmentRef?: string
  /** Call ids of the successful retrieves that returned this passage. */
  readonly callIds: readonly string[]
}

/** Zotero's attachment selection hint (search/get facts); no resolved location. */
interface AttachmentHint {
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

/** One exported document inside a translator-format artifact. */
export interface ExportDocumentItem {
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

/** The export facts of one successful artifact. */
export interface ExportArtifact {
  readonly callId: string
  readonly format: string
  readonly style?: string
  readonly locale?: string
  /** The exported refs in the caller's order: the complete argument list when it parses, else the bounded projection preview. */
  readonly refs: readonly string[]
  /** Exported refs beyond the bounded list; zero when the refs are the complete argument list. */
  readonly refsOmitted: number
  /** The settled result's event time (Unix epoch ms); absent for legacy projections. */
  readonly settledAt?: number
  /**
   * The per-document itemization of a translator-format export (ref, key,
   * title — never the entry text, which stays in the merged body); absent
   * for citation/bibliography artifacts and legacy projections.
   */
  readonly items?: readonly ExportDocumentItem[]
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

/**
 * Aggregated facts of the successful retrieves on one item: per-source
 * availability holds the latest state each source reported, coverage and
 * the attachment ref (with its paired content type) come from the latest
 * retrieve that carried them, `truncated` sticks once any retrieve
 * truncated. Passages themselves are accumulated and deduplicated separately
 * in `evidence`.
 */
export interface SourceRetrievalFacts {
  readonly attachmentRef?: string
  /** The content type of `attachmentRef`; absent when Zotero reported none. */
  readonly attachmentContentType?: string
  readonly coverage?: SourceCoverage
  /** The global passage/character budget omitted more evidence. */
  readonly truncated: boolean
  readonly sourceAvailability: Readonly<Record<string, SourceAvailabilityEntry>>
}

/**
 * The retrieves on one item, summarized for the Evidence head. Run count is
 * the number of successful, ref-valid, presentation-meta-recognizable
 * retrieve calls; `latestRetrievedAt` is the settled result's event time
 * (Unix epoch ms), not a transcript position.
 */
interface RetrievalSummary {
  readonly runCount: number
  /** Only internal diagnostics; never rendered. */
  readonly latestCallId: string
  /** The settled result's event time (Unix epoch ms). */
  readonly latestRetrievedAt: number
  /** Deduplicated passages kept after the preview budget. */
  readonly keptPassageCount: number
  /** Total passages reported across all successful retrieves. */
  readonly reportedPassageCount: number
  readonly truncated: boolean
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
  /** Aggregated retrieval facts of the successful zotero_retrieve calls. */
  readonly retrievalFacts?: SourceRetrievalFacts
  /** The successful retrieves on this item, summarized for the Evidence head. */
  readonly retrievalSummary?: RetrievalSummary
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
