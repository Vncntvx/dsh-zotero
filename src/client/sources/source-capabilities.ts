/**
 * The PDF capability of one source: which attachment ref answers the
 * open-PDF deep link, and how firmly the ref is known to be a PDF. The
 * capability is the single source of truth behind the PDF badge, the
 * "with PDF" filter, and the open-PDF action — one rule, three consumers.
 * @module dsh-zotero/client/sources/source-capabilities
 */

import { pdfUrlOf } from '../actions/open-zotero.ts'
import type { SourceItem } from './model.ts'

/** The content type that makes an attachment a PDF for the deep link. */
const PDF_CONTENT_TYPE = 'application/pdf'

/** One openable PDF target of a source with the strength of its type fact. */
export interface PdfCapability {
  readonly ref: string
  readonly url: string
  /** `confirmed` when a fact declares application/pdf; `inferred` when the ref's type is unknown. */
  readonly confidence: 'confirmed' | 'inferred'
}

/** One attachment fact of the item: its ref (when any) and content type (when reported). */
interface AttachmentCandidate {
  readonly ref?: string
  readonly contentType?: string
}

/**
 * The PDF capability of one source, or null when nothing answers the
 * open-PDF deep link. Confirmed candidates are tried in precedence order —
 * the resolved attachment location, Zotero's own attachment selection, then
 * the attachment a retrieve read — each needing an `application/pdf` fact.
 * When nothing confirms, a ref whose type is unknown still yields an
 * `inferred` capability (older sessions carried no types); a known non-PDF
 * never yields one. The final gate is deep-link buildability — a ref
 * `pdfUrlOf` cannot parse is no capability at all.
 * @param item - the source to probe.
 * @returns the capability, or null.
 */
export function pdfCapabilityOf(item: SourceItem): PdfCapability | null {
  const candidates: AttachmentCandidate[] = []
  if (item.attachment !== undefined) {
    candidates.push({ ref: item.attachment.ref, contentType: item.attachment.contentType })
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
    const url = pdfUrlOf(candidate.ref)
    if (url !== null) return { ref: candidate.ref, url, confidence: 'confirmed' }
  }
  for (const candidate of candidates) {
    if (candidate.ref === undefined || candidate.contentType !== undefined) continue
    const url = pdfUrlOf(candidate.ref)
    if (url !== null) return { ref: candidate.ref, url, confidence: 'inferred' }
  }
  return null
}

/** The item fact: some attachment of the source is (or is inferred to be) a PDF. */
export function hasPdf(item: SourceItem): boolean {
  return pdfCapabilityOf(item) !== null
}
