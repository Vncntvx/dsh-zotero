/**
 * The core-owned, read-only artifact seam. Enrichment may fill this slot;
 * ordinary readers cannot acquire document bytes or submit parsing work.
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
      readonly pageCount?: number
    }
  | { readonly kind: 'miss'; readonly reason: 'absent' | 'expired' }
  | { readonly kind: 'fault'; readonly error: Error }

/**
 * A lookup may stat an attachment or revalidate an indexed URL with one
 * token-free HEAD. It never downloads a document or creates/resumes a task.
 */
export interface FulltextEnhancer {
  lookup(input: FulltextEnhancerInput, signal?: AbortSignal): Promise<FulltextLookupResult>
}

/** Absent MIME types are candidates; byte validation belongs to active parsing. */
export function isPdfContentType(contentType: string | undefined): boolean {
  if (contentType === undefined || contentType.trim() === '') return true
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return base === 'application/pdf'
}
