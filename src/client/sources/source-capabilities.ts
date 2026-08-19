/**
 * The PDF capability of one source: which attachment answers the open-PDF
 * action, and whether the openable target is Zotero's own reader (a
 * `zotero://open-pdf` deep link on a file attachment) or the web location
 * of a linked URL PDF. The capability is the single source of truth behind
 * the PDF badge, the "with PDF" filter, and the open-PDF action — one rule,
 * three consumers. Only facts Zotero proved qualify: a ref whose type is
 * unknown is never promised to be a PDF, and a web-linked URL attachment is
 * never handed to the protocol handler (it silently ignores non-file
 * attachments).
 * @module dsh-zotero/client/sources/source-capabilities
 */

import { pdfUrlOf } from '../actions/open-zotero.ts'
import type { SourceItem } from './model.ts'

/** The content type that makes an attachment a PDF for the open action. */
const PDF_CONTENT_TYPE = 'application/pdf'

/** The PDF capability of one source, or null when nothing answers the open-PDF action. */
export type PdfCapability =
  | {
      readonly kind: 'file'
      /** The attachment ref the open-pdf deep link drives. */
      readonly ref: string
      /** The `zotero://open-pdf` deep link. */
      readonly url: string
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
}

/** Whether a resolved web location is a plain HTTP(S) target the browser can open. */
function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

/**
 * The PDF capability of one source, or null when nothing answers the
 * open-PDF action. Candidates are tried in precedence order — the resolved
 * attachment location, Zotero's own attachment selection, then the
 * attachment a retrieve read — each needing an `application/pdf` fact; a
 * resolved web-linked URL attachment never qualifies for Zotero's reader
 * (the protocol handler silently ignores non-file attachments), but when it
 * is the only PDF fact its web location answers the action instead. A ref
 * whose type is unknown never yields a capability: an older session's
 * untyped hint is not promised to be a PDF. The final gate for file targets
 * is deep-link buildability — a ref `pdfUrlOf` cannot parse is no
 * capability at all.
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
    const url = pdfUrlOf(candidate.ref)
    if (url !== null) return { ref: candidate.ref, url, kind: 'file' }
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
