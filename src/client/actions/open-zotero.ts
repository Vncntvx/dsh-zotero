/**
 * Open-in-Zotero deep links, built purely from session facts (refs the
 * session's tool calls produced). The links are anchors the browser hands to
 * the OS protocol handler — Zotero registers `zotero://` on every desktop
 * platform, and the app's protocol handler is source-verified; no official
 * documentation page exists, so the UI words the capability accordingly and
 * always keeps a copy-ref fallback. The verdict follows the item's
 * evidenceMatch: a ref qualified for another instance must never silently open
 * that database, an unverifiable ref may still be tried with a caveat.
 * @module dsh-zotero/client/actions/open-zotero
 */

import { shortKeyOf } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'

/** The action verdict of one source against the connected instance. */
export type OpenVerdict = 'open' | 'blocked' | 'unverified'

/**
 * The `zotero://select` deep link for one item ref (personal library form).
 * @returns the deep link, or null when the ref carries no parseable key.
 */
export function selectUrlOf(ref: string): string | null {
  const key = shortKeyOf(ref)
  return key === null ? null : `zotero://select/library/items/${key}`
}

/**
 * The `zotero://open-pdf` deep link for one attachment ref. `page` is
 * 1-based and `annotation` carries the annotation's own key, both as the
 * app's protocol handler expects them.
 * @returns the deep link, or null when the ref carries no parseable key.
 */
export function pdfUrlOf(
  ref: string,
  options: { readonly page?: string; readonly annotation?: string } = {},
): string | null {
  const key = shortKeyOf(ref)
  if (key === null) return null
  const params: string[] = []
  if (options.page !== undefined && options.page !== '')
    params.push(`page=${encodeURIComponent(options.page)}`)
  if (options.annotation !== undefined && options.annotation !== '')
    params.push(`annotation=${encodeURIComponent(options.annotation)}`)
  return `zotero://open-pdf/library/items/${key}${params.length === 0 ? '' : `?${params.join('&')}`}`
}

/** The item's verdict: verified opens, mismatch blocks, the rest tries with a caveat. */
export function openVerdictOf(item: SourceItem): OpenVerdict {
  switch (item.evidenceMatch) {
    case 'verified':
      return 'open'
    case 'mismatch':
      return 'blocked'
    default:
      return 'unverified'
  }
}

/** The two deep links one Zotero child row can offer. */
export interface ChildRowLinks {
  /** Open the row itself — a note or an annotation — in Zotero. */
  readonly selectUrl: string | null
  /**
   * Open the PDF it lives in, at its page. Only an annotation's parent is a PDF;
   * a note's parent is the item the card is already about, so it gets none.
   */
  readonly pdfUrl: string | null
}

/**
 * The links one child row supports. An annotation is only reachable *through*
 * its PDF, so that is the link worth offering for it; a note or an attachment
 * opens on its own. The `zotero_children` card and the `zotero_get` card's
 * previews both read their rows through here, so the two cannot disagree about
 * what a given row can link to — including which parent is a PDF.
 */
export interface ChildLinkRow {
  readonly ref: string
  /** The row's parent, when the projection reported one. */
  readonly parentRef?: string | null
  /** The page the row sits on, for the PDF deep link. */
  readonly pageLabel?: string | null
  /** `annotation` means the parent is the PDF the annotation lives in. */
  readonly kind?: string
}

export function childRowLinks(row: ChildLinkRow): ChildRowLinks {
  const inPdf = row.kind === 'annotation'
  return {
    selectUrl: selectUrlOf(row.ref),
    pdfUrl:
      inPdf && row.parentRef != null
        ? pdfUrlOf(row.parentRef, { page: row.pageLabel ?? undefined })
        : null,
  }
}
