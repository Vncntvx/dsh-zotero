/**
 * The core-owned seam an optional document-parsing component can fill.
 *
 * **Dependency direction.** This module defines only pure types and helpers
 * and must not import anything from `src/parsing/**` (not even type-only). The
 * parsing component imports these types and registers an enhancer into the
 * core service; the core reads full text through the slot when present and
 * runs its unchanged loopback path when absent. Keeping the type here is what
 * lets the core stay unaware of parsing's transport, host table, credentials,
 * and artifact store.
 *
 * **One value states one fact.** An enhancer outcome distinguishes three
 * results, so the caller never has to guess: `ok` carries the parsed text,
 * `fallback` names why the caller should use local extraction instead, and
 * `fatal` is an authorization/configuration failure that must not be swallowed
 * into a silent success or a degraded answer.
 *
 * **lookup before enhance.** `lookup` is the cache-only arm: it may stat a
 * local attachment, digest caller-supplied bytes, or issue a HEAD against a
 * URL to revalidate a stored artifact, but it never downloads the document and
 * never asks MinerU to parse. `enhance` is the full parse. Splitting them lets
 * the scholarly reader ask whether an artifact already exists *before* it
 * downloads a PDF, without making the core read path pay for a separate probe.
 * @module dsh-zotero/local/fulltext-enhancer
 */

/**
 * The minimum amount of parsed Markdown trusted as a useful full-text result.
 * Shorter output is reported as a fallback so the caller can still try its
 * local extraction; it is also the scholarly reader's local-PDF threshold.
 */
export const FULLTEXT_ENHANCER_MIN_TEXT_CHARS = 500

/** Where the bytes of one document come from. */
export type FulltextEnhancerSource =
  | { readonly kind: 'local'; readonly attachmentRef: string }
  | { readonly kind: 'url'; readonly url: string }

/**
 * Everything needed to decide whether a stored artifact still describes the
 * current source without fetching the document.
 *
 * - `file`: a local attachment's size and modification time, read with `stat`.
 * - `url`: the URL plus whatever HTTP validators the source or a HEAD returned.
 * - `bytes`: the caller already supplied the bytes, so the content fingerprint
 *   is the whole stamp.
 */
export type FulltextSourceStamp =
  | { readonly kind: 'file'; readonly size: number; readonly mtimeMs: number }
  | {
      readonly kind: 'url'
      readonly url: string
      readonly etag?: string
      readonly lastModified?: string
      readonly contentLength?: number
    }
  | { readonly kind: 'bytes'; readonly fingerprint: string }

/** What the enhancer is asked to produce high-quality text for. */
export interface FulltextEnhancerInput {
  /** Stable identity of the document (attachment ref or public URL). The parsing
   * component folds this together with its mode and a content fingerprint to
   * form the artifact cache key, so the caller never needs to know either. */
  readonly key: string
  readonly source: FulltextEnhancerSource
  /** MIME type when known; only PDF candidates are eligible. */
  readonly contentType?: string
  /** Bytes the caller already fetched (scholarly PDF arm); avoids a re-download. */
  readonly bytes?: Uint8Array
  /** A stamp the caller already probed (the scholarly `lookup` result), so
   * `enhance` need not probe the source again. */
  readonly sourceStamp?: FulltextSourceStamp
}

/** The one result of an enhancer attempt. */
export type FulltextEnhancerOutcome =
  | {
      readonly kind: 'ok'
      readonly text: string
      readonly pageCount?: number
      /** Provenance label (e.g. `MinerU (pro)`); only the scholarly free-text
       * reader surfaces it. The core reader ignores it and keeps its schema. */
      readonly source?: string
    }
  | { readonly kind: 'fallback'; readonly reason: string }
  | { readonly kind: 'fatal'; readonly error: Error }

/**
 * The cache-only lookup result. `outcome` is present when the lookup itself
 * produced a final answer (`ok`, `fallback`, or `fatal`); it is absent on a
 * plain miss. `stamp` is always reported when the source could be probed, so
 * the caller can hand it to `enhance` and avoid a duplicate HEAD/stat.
 */
export interface FulltextLookupResult {
  readonly outcome?: FulltextEnhancerOutcome
  readonly stamp?: FulltextSourceStamp
}

/**
 * The optional document parser the core and the scholarly reader share.
 *
 * `lookup` never downloads a document or calls MinerU. `enhance` may do both.
 * Neither method throws for a recoverable failure; they report `fallback` or
 * `fatal` instead. A caller abort is the one exception: it propagates.
 */
export interface FulltextEnhancer {
  lookup(input: FulltextEnhancerInput, signal?: AbortSignal): Promise<FulltextLookupResult>
  enhance(input: FulltextEnhancerInput, signal?: AbortSignal): Promise<FulltextEnhancerOutcome>
}

/**
 * Whether a content type names a PDF candidate. An absent or empty type is
 * treated as unknown and offered to the parser, whose byte-level PDF signature
 * check is authoritative. A MIME parameter (`application/pdf; ...`) still
 * counts as a PDF.
 */
export function isPdfContentType(contentType: string | undefined): boolean {
  if (contentType === undefined || contentType.trim() === '') return true
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return base === 'application/pdf'
}

/**
 * Whether one parsed Markdown body is long enough to trust as full text. The
 * threshold is deliberately shared with the scholarly reader's local PDF arm;
 * a shorter enhancer result is a fallback, never a silent "success".
 */
export function hasEnoughParsedText(text: string): boolean {
  return text.trim().length >= FULLTEXT_ENHANCER_MIN_TEXT_CHARS
}
