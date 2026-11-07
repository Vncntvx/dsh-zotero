/**
 * The PDF capability of one source: which attachment answers the open-PDF
 * action, and whether the openable target is Zotero's own reader (a
 * `zotero://open-pdf` deep link on a file attachment) or the web location
 * of a linked URL PDF. The capability is the single source of truth behind
 * the PDF badge, the "with PDF" filter, and the open-PDF action: one rule,
 * three consumers. It lives under `src/sources/` so the host's filter-count
 * aggregates judge a source with exactly the predicate the browser renders
 * by — a second copy in the client would let the badge and the count
 * disagree. Only facts Zotero proved qualify. A ref whose type is unknown
 * is never promised to be a PDF, and a web-linked URL attachment is never
 * handed to the protocol handler (it silently ignores non-file attachments).
 * @module dsh-zotero/sources/source-capabilities
 */

import { REF_IN_TEXT_PATTERN, type RefKind } from '../ref-grammar.js'
import { PDF_CONTENT_TYPE } from '../media-types.js'
import type { SourceItem } from './model.js'

/** One identity parse of a Zotero ref embedded in text. */
export interface ParsedRefIdentity {
  readonly libraryType: 'user' | 'group'
  readonly libraryId: string
  readonly kind: RefKind
  readonly key: string
}

/** Bounded memo for identity parses: wire text repeats refs heavily. */
const refIdentityCache = new Map<string, ParsedRefIdentity | null>()
const REF_IDENTITY_CACHE_LIMIT = 500

/**
 * Clear the reference identity cache. Exported for test isolation.
 */
export function clearRefIdentityCacheForTesting(): void {
  refIdentityCache.clear()
}

/**
 * Parse the identity of a Zotero ref embedded in text: library type and id,
 * object kind, and key. Unparseable input yields `null`, memoized like a
 * result — the caller treats both the same way.
 * @param ref - the ref text to parse.
 * @returns the identity, or null when the text is not a supported ref.
 */
export function parseRefIdentity(ref: string): ParsedRefIdentity | null {
  const cached = refIdentityCache.get(ref)
  if (cached !== undefined) return cached

  const match = REF_IN_TEXT_PATTERN.exec(ref)
  let result: ParsedRefIdentity | null = null
  if (match?.groups) {
    const { libraryType, libraryId, kind, key } = match.groups
    result = {
      libraryType: libraryType as 'user' | 'group',
      libraryId: libraryId!,
      kind: kind as RefKind,
      key: key!,
    }
  }

  if (refIdentityCache.size >= REF_IDENTITY_CACHE_LIMIT) {
    const firstKey = refIdentityCache.keys().next().value
    refIdentityCache.delete(firstKey!)
  }
  refIdentityCache.set(ref, result)
  return result
}

/** The PDF capability of one source, or null when nothing answers the open-PDF action. */
export type PdfCapability =
  | {
      readonly kind: 'file'
      /** The attachment ref to resolve into a local file path. */
      readonly ref: string
      /** The local filesystem path when already resolved. */
      readonly filePath?: string
    }
  | {
      readonly kind: 'url'
      /** The web location of the linked URL PDF. */
      readonly url: string
    }

/** One attachment fact of the item: its ref (when any), type (when reported), and resolution kind (when resolved). */
interface AttachmentCandidate {
  readonly ref?: string
  readonly contentType?: string
  /** The resolved attachment's kind; absent for hints Zotero reported without a resolution. */
  readonly kind?: 'file' | 'url'
  readonly filePath?: string
}

/** Whether a resolved web location is a plain HTTP(S) target the browser can open. */
function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

/**
 * The PDF capability of one source, or null when nothing answers the
 * open-PDF action. Candidates are tried in precedence order (the resolved
 * attachment location, Zotero's own attachment selection, then the
 * attachment a retrieve read), each needing an `application/pdf` fact; a
 * resolved web-linked URL attachment never qualifies for Zotero's reader
 * (the protocol handler silently ignores non-file attachments), but when it
 * is the only PDF fact its web location answers the action instead. A ref
 * whose type is unknown never yields a capability: an older session's
 * untyped hint is not promised to be a PDF. The final gate for file targets
 * is ref identity parseability, so an unparseable ref is no capability at all.
 * @param item - the source to probe.
 * @returns the capability, or null.
 */
export function pdfCapabilityOf(item: SourceItem): PdfCapability | null {
  const candidates: AttachmentCandidate[] = []
  if (item.attachment !== undefined) {
    candidates.push({
      ref: item.attachment.ref,
      contentType: item.attachment.contentType,
      kind: item.attachment.kind,
      filePath:
        item.attachment.kind === 'file' && item.attachment.location.length > 0
          ? item.attachment.location
          : undefined,
    })
  }
  if (item.bestAttachment !== undefined) {
    candidates.push({ ref: item.bestAttachment.ref, contentType: item.bestAttachment.contentType })
  }
  if (item.retrievalFacts !== undefined) {
    candidates.push({
      ref: item.retrievalFacts.attachmentRef,
      contentType: item.retrievalFacts.attachmentContentType,
    })
  }
  for (const candidate of candidates) {
    if (candidate.ref === undefined || candidate.contentType !== PDF_CONTENT_TYPE) continue
    if (candidate.kind === 'url') continue
    if (parseRefIdentity(candidate.ref) === null) continue
    return {
      kind: 'file',
      ref: candidate.ref,
      ...(candidate.filePath !== undefined ? { filePath: candidate.filePath } : {}),
    }
  }
  // A resolved web PDF with no file candidate opens at its own location.
  const web = item.attachment
  if (web !== undefined && web.kind === 'url' && web.contentType === PDF_CONTENT_TYPE) {
    if (isHttpUrl(web.location)) return { kind: 'url', url: web.location }
  }
  return null
}

/** The item fact: some attachment of the source is (or is openable as) a PDF. */
export function hasPdf(item: SourceItem): boolean {
  return pdfCapabilityOf(item) !== null
}
