/**
 * The shared evidence-passage projection shape.
 *
 * Host presentation (`presentation-meta`) and the browser Sources panel
 * (`client/presenters`) must agree on one item vocabulary; this module is the
 * single definition and is CLIENT_SAFE (no refs, no errors, no codecs).
 * @module dsh-zotero/evidence-item
 */

/** Evidence sources `zotero_retrieve` can rank against the query. */
export type EvidenceSource = 'annotation' | 'note' | 'fulltext' | 'abstract'

/** The source vocabulary as a runtime whitelist, for decoders on both sides. */
const EVIDENCE_SOURCES: ReadonlySet<string> = new Set<EvidenceSource>([
  'annotation',
  'note',
  'fulltext',
  'abstract',
])

/** Narrow a decoded source string over the whitelist. */
export function isEvidenceSource(source: string): source is EvidenceSource {
  return EVIDENCE_SOURCES.has(source)
}

/**
 * A ranked field of an evidence passage. Only an annotation has two: the
 * highlight a reader selected (`text`) and the comment they wrote on it
 * (`comment`).
 */
export type EvidenceField = 'text' | 'comment'

/** One ranked evidence passage with its provenance and source kind. */
export interface EvidenceItem {
  readonly source: EvidenceSource
  readonly sourceRef: string
  readonly preview: string
  readonly previewTruncated: boolean
  /** Zotero-owned page label (annotations only); never invented. */
  readonly pageLabel?: string
  /** The annotation passage's parent attachment ref (its own PDF's deep-link key). */
  readonly attachmentRef?: string
  /**
   * Which of the annotation's two text fields carried the query terms. Absent
   * means the passage's single field did, which is the ordinary case; a match
   * found only in the annotator's own comment is a different claim about the
   * paper and must not be read as one.
   */
  readonly matchedFields?: readonly EvidenceField[]
}
