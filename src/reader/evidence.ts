/** Evidence anchors used to move between Reader, Agent output, and source data. */
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
export type EvidencePrecision = 'region' | 'text' | 'page' | 'document'

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
export type PdfEvidenceQuote = {
  readonly sourceType: EvidenceSourceType
  readonly contentFingerprint?: string
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
