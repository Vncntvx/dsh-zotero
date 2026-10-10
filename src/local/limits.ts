/**
 * The deployment-varying bounds the `local` provider reads from the resolved
 * config. Every member is a live read (or may be supplied as one), so a
 * settings commit applies on the next call without rebuilding the transport.
 * Declared apart from the provider class so every domain module can type its
 * dependencies without importing the facade.
 * @module dsh-zotero/local/limits
 */

/** Deployment-varying bounds the local provider needs beyond the HTTP client limits. */
export interface LocalApiLimits {
  /** Upper bound for note records the search scan fetches for body matches. */
  readonly maxNoteScanRecords: number
  /** Character budget for `zotero_get` abstract previews. */
  readonly maxDetailChars: number
  /** Character budget for a note item's own body returned by `zotero_get`. */
  readonly maxNoteBodyChars: number
  /** Per-note character budget for `zotero_get` note previews. */
  readonly maxNoteChars: number
  /** Upper bound for note records returned by `zotero_get`. */
  readonly maxNoteRecords: number
  /** Upper bound for annotation records returned by `zotero_get`. */
  readonly maxAnnotationRecords: number
  /** Word count of each full-text passage entering evidence ranking. */
  readonly fulltextChunkWords: number
  /** Total character budget for retrieved evidence passages. */
  readonly maxEvidenceChars: number
  /** Upper bound for the number of evidence passages. */
  readonly maxEvidencePassages: number
  /** Character bound for full text accepted into evidence ranking. */
  readonly maxFulltextChars: number
  /** Provider hard limit for export output; never mid-truncated. */
  readonly maxExportChars: number
  /** CSL style for citation/bibliography formats. */
  readonly defaultStyle: string
  /** CSL locale for citation/bibliography formats. */
  readonly defaultLocale: string
  /** Max items a browse call may return; capped by provider */
  readonly maxBrowseResults: number
  /** Per-resource listing cap for `zotero_changes`; a display bound, not a read bound. */
  readonly maxChangesResults: number
  /**
   * How long a scope listing (collections/searches) is trusted before a
   * re-fetch. Compared at read time, so a settings edit applies to the next
   * lookup: cached entries older than the new TTL simply expire.
   */
  readonly scopeListingTtlMs: number
  /** Parallel parent-attribution queries the search domain may keep in flight (one `itemKey` batch each). */
  readonly searchConcurrency: number
  /** Parallel attachment reads the retrieve ranking may keep in flight; annotation children ride the single `?itemType=annotation` listing instead. */
  readonly graphConcurrency: number
  /** Upper bound for attachments one `zotero_retrieve` call may read; the ones past the bound report `unread` rather than vanishing. */
  readonly retrieveAttachmentCap: number
}
