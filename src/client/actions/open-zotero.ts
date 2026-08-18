/**
 * Open-in-Zotero deep links, built purely from session facts (refs the
 * session's tool calls produced). The links are anchors the browser hands to
 * the OS protocol handler — Zotero registers `zotero://` on every desktop
 * platform, and the app's protocol handler is source-verified; no official
 * documentation page exists, so the UI words the capability accordingly and
 * always keeps a copy-ref fallback. The verdict follows the item's
 * provenance: a ref qualified for another instance must never silently open
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
  switch (item.provenance) {
    case 'verified':
      return 'open'
    case 'mismatch':
      return 'blocked'
    default:
      return 'unverified'
  }
}
