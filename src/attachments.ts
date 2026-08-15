/**
 * Attachment records and deterministic attachment selection.
 *
 * Zotero's own best-attachment choice (`links.attachment` on item
 * responses) is preferred wherever it exists; `selectAttachment` is the
 * documented fallback that ranks child rows the same way Zotero's
 * `getBestAttachment` does — PDF over other kinds, imported files first,
 * then earliest addition date, then key order.
 * @module dsh-zotero/attachments
 */

import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey } from './json.js'

/**
 * A normalized attachment child row, before ref provenance is attached.
 * Ref-free on purpose: callers own the `?server=` qualifier.
 */
export interface ZoteroAttachmentCandidate {
  readonly key: string
  readonly title: string
  readonly contentType: string
  readonly linkMode?: string
  /** `data.url`; meaningful for `linked_url` attachments. */
  readonly url?: string
}

/** Extract a Zotero object key from an API `links.attachment.href`. */
export function extractAttachmentKey(href: string | undefined): string | undefined {
  if (href === undefined) return undefined
  return /\/items\/([A-Z0-9]{8})(?:[/?#]|$)/.exec(href)?.[1]
}

/**
 * Read Zotero's own best-attachment link from an item response.
 * @returns the attachment key and content type, or undefined when the item
 * has no attachment link (or its href carries no valid Zotero key).
 */
export function bestAttachmentFromLinks(
  json: unknown,
): { key: string; contentType: string } | undefined {
  const attachment = asRecord(asRecord(asRecord(json)?.links)?.attachment)
  const key = extractAttachmentKey(asString(attachment?.href))
  if (key === undefined) return undefined
  return { key, contentType: asString(attachment?.attachmentType) ?? '' }
}

/**
 * Normalize one attachment item JSON object.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeAttachmentRecord(json: unknown): ZoteroAttachmentCandidate {
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(
      'Zotero returned an attachment without a valid object key.',
      ZOTERO_UNEXPECTED,
    )
  }
  const data = asRecord(record?.data)
  const linkMode = asString(data?.linkMode)
  const url = asString(data?.url)
  return {
    key,
    title: asString(data?.title) ?? '',
    contentType: asString(data?.contentType) ?? '',
    ...(linkMode !== undefined ? { linkMode } : {}),
    ...(url !== undefined ? { url } : {}),
  }
}

/**
 * Select one attachment of the requested kind from raw child rows, ranked
 * deterministically: imported files first, then earliest `dateAdded`, then
 * key order. Rows without an attachment content type are skipped; a
 * malformed attachment row fails loud like every other broken invariant.
 * @param rows - raw child item JSON objects (notes and annotations are skipped).
 * @param kind - `pdf` selects `application/pdf`; anything else is matched as a literal content type.
 * @returns the winning record, or undefined when no row matches the kind.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` on an attachment row without a valid key.
 */
export function selectAttachment(
  rows: readonly unknown[],
  kind: string,
): ZoteroAttachmentCandidate | undefined {
  const wantedContentType = kind === 'pdf' ? 'application/pdf' : kind
  const scored: { candidate: ZoteroAttachmentCandidate; dateAdded: string }[] = []
  for (const row of rows) {
    const record = asRecord(row)
    const data = asRecord(record?.data)
    if (asString(data?.contentType) === undefined) continue
    const candidate = normalizeAttachmentRecord(row)
    if (candidate.contentType !== wantedContentType) continue
    scored.push({ candidate, dateAdded: asString(data?.dateAdded) ?? '' })
  }
  scored.sort((a, b) => {
    const rankA = a.candidate.linkMode === 'imported_file' ? 0 : 1
    const rankB = b.candidate.linkMode === 'imported_file' ? 0 : 1
    if (rankA !== rankB) return rankA - rankB
    const byDate = a.dateAdded.localeCompare(b.dateAdded)
    if (byDate !== 0) return byDate
    return a.candidate.key.localeCompare(b.candidate.key)
  })
  return scored[0]?.candidate
}
