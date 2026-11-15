/**
 * The core-owned, read-only artifact seam. Enrichment fills this slot with
 * committed parsed artifacts for ordinary readers.
 * @module dsh-zotero/local/fulltext-enhancer
 */

/** Minimum useful text size for the scholarly reader's local PDF extractor. */
export const FULLTEXT_ENHANCER_MIN_TEXT_CHARS = 500

export type FulltextEnhancerSource =
  | { readonly kind: 'local'; readonly attachmentRef: string }
  | { readonly kind: 'url'; readonly url: string }

export interface FulltextEnhancerInput {
  readonly key: string
  readonly source: FulltextEnhancerSource
  readonly contentType?: string
}

/** Provenance of the exact artifact used by this read. */
export interface FulltextArtifactProvenance {
  readonly parser: 'mineru'
  readonly mode: 'free' | 'pro'
  readonly artifactId: string
  readonly fingerprint: string
  readonly sourceId: string
  readonly generation: string
}

export type FulltextLookupResult =
  | {
      readonly kind: 'hit'
      readonly text: string
      readonly format: 'markdown'
      readonly source: string
      readonly provenance: FulltextArtifactProvenance
      /**
       * The stored source this artifact belongs to. An artifactId read needs
       * these facts because the handle itself says nothing about the source.
       */
      readonly sourceKind?: 'attachment' | 'url'
      /** Safe display label: a canonical attachment ref or a URL origin. */
      readonly sourceLabel?: string
      /** The Zotero attachment behind this artifact, when the source is local. */
      readonly attachmentRef?: string
      readonly pageCount?: number
    }
  | { readonly kind: 'miss'; readonly reason: 'absent' | 'expired' }
  | { readonly kind: 'fault'; readonly error: Error }

/**
 * Looks up a committed artifact after checking an attachment with `stat` or
 * revalidating an indexed URL with one token-free `HEAD`.
 */
export interface FulltextEnhancer {
  lookup(input: FulltextEnhancerInput, signal?: AbortSignal): Promise<FulltextLookupResult>
  /** Reads one stored artifact by opaque id. */
  lookupArtifact?(artifactId: string, signal?: AbortSignal): Promise<FulltextLookupResult>
}

/**
 * Whether a source is a PDF `candidate`: an absent MIME type counts, because
 * byte validation belongs to active parsing.
 *
 * It is not the same question as `media-types.isPdfContentType`, which asks
 * whether a *known* MIME type is exactly PDF. The two used to share a name, and
 * a caller that imported the wrong one silently changed the answer for a missing
 * or parameterized content type.
 */
export function isPdfCandidateContentType(contentType: string | undefined): boolean {
  if (contentType === undefined || contentType.trim() === '') return true
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return base === 'application/pdf'
}
