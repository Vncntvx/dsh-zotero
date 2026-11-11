/**
 * The shared evidence-passage projection shape.
 *
 * Host presentation (`presentation-meta`) and the browser Sources panel
 * (`sources/presenters`) must agree on one item vocabulary; this module is the
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

/**
 * Why a passage was returned. `lexical` means the query's own words occur in
 * it, `semantic` means only the meaning matched, and `hybrid` means both.
 *
 * The vocabulary is load-bearing rather than decorative: a reader who is told
 * a passage matched semantically must not then quote it as wording the paper
 * contains, and a reader told it matched lexically may.
 */
export type EvidenceMatchKind = 'lexical' | 'semantic' | 'hybrid'

/** The match-kind vocabulary as a runtime whitelist, for decoders on both sides. */
const EVIDENCE_MATCH_KINDS: ReadonlySet<string> = new Set<EvidenceMatchKind>([
  'lexical',
  'semantic',
  'hybrid',
])

/** Narrow a decoded match-kind string over the whitelist. */
export function isEvidenceMatchKind(value: string): value is EvidenceMatchKind {
  return EVIDENCE_MATCH_KINDS.has(value)
}

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
   * Why the passage was returned. Absent only when the projection could not
   * read a value the wire defines, which the decoder rejects before this.
   */
  readonly matchKind?: EvidenceMatchKind
  /**
   * Which of the annotation's two text fields carried the query terms. Absent
   * means either the passage's single field did (the ordinary case) or no
   * lexical route hit it at all — a semantic-only match, where naming fields
   * would claim wording the passage may not share with the query.
   */
  readonly matchedFields?: readonly EvidenceField[]
}
