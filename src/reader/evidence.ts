/** Evidence anchors used to move between Reader, Agent output, and source data. */
import type { ReaderDocumentRef } from './identity.js'
import type { ZoteroArtifactLocationView } from '../contract.js'

export type EvidenceSourceType =
  | 'document'
  | 'selection'
  | 'annotation'
  | 'page'
  | 'search'
  | 'bm25'
  | 'semantic'
  | 'hybrid'
  | 'mineru'
  | 'screenshot'
  | 'note'
export type EvidencePrecision = 'region' | 'text' | 'page' | 'section' | 'document'

export interface PdfRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PdfPageRegion {
  readonly pageIndex: number
  readonly rects: readonly PdfRect[]
}

/** A verified attachment may carry geometry or a passage to locate after opening it. */
export type PdfEvidenceQuote = Pick<EvidenceAnchor, 'sourceType' | 'contentFingerprint'> & {
  readonly quote: string
}
export type PdfArtifactRegion = Pick<ZoteroArtifactLocationView, 'pageIndex' | 'box'>
export interface PdfArtifactEvidence {
  readonly artifactRegion: PdfArtifactRegion
  readonly contentFingerprint: string
}
export type PdfEvidenceTarget = PdfPageRegion | PdfEvidenceQuote | PdfArtifactEvidence

/** Identity carried by PDF quotes in the Composer, without any document bytes. */
export interface PdfQuoteSource {
  readonly attachmentRef: string
  readonly itemRef?: string
  readonly instanceId?: string
  readonly libraryRef: string
  readonly fingerprint: string
  readonly title: string
}

/** One page of a text selection with the coordinates and ordering data Zotero needs. */
export interface PdfAnnotationSelectionPage extends PdfPageRegion {
  readonly text: string
  readonly pageLabel: string
  readonly textOffset: number
  readonly top: number
}

export interface TextRange {
  readonly start: number
  readonly end: number
}

export interface EvidenceAnchor {
  readonly documentRef: ReaderDocumentRef
  readonly pageIndex?: number
  readonly pageLabel?: string
  readonly sectionPath?: readonly string[]
  readonly quote?: string
  readonly prefix?: string
  readonly suffix?: string
  readonly rects?: readonly PdfRect[]
  readonly textRange?: TextRange
  readonly sourceType: EvidenceSourceType
  readonly contentFingerprint?: string
  readonly precision: EvidencePrecision
}

export function anchorPrecisionOf(
  anchor: Pick<EvidenceAnchor, 'rects' | 'textRange' | 'pageIndex' | 'sectionPath'>,
): EvidencePrecision {
  if (anchor.rects !== undefined && anchor.rects.length > 0) return 'region'
  if (anchor.textRange !== undefined) return 'text'
  if (anchor.pageIndex !== undefined) return 'page'
  if (anchor.sectionPath !== undefined && anchor.sectionPath.length > 0) return 'section'
  return 'document'
}

export function normalizeAnchor(anchor: EvidenceAnchor): EvidenceAnchor {
  const rects = anchor.rects?.filter((rect) => rect.width > 0 && rect.height > 0)
  const textRange =
    anchor.textRange === undefined || anchor.textRange.end < anchor.textRange.start
      ? undefined
      : anchor.textRange
  const normalized = {
    ...anchor,
    ...(rects === undefined || rects.length === 0 ? { rects: undefined } : { rects }),
    ...(textRange === undefined ? { textRange: undefined } : { textRange }),
  }
  return { ...normalized, precision: anchorPrecisionOf(normalized) }
}
