/**
 * Canonical Zotero deep links and identity parsing, built purely from session
 * facts (refs the session's tool calls produced). Deep links are canonical
 * URLs copied to the clipboard for external reference or quick search, while
 * PDF reading is performed natively in the sidebar.
 *
 * Ref identity parsing lives under `src/sources/` so the host's filter-count
 * aggregates share the one implementation; this module re-exports it for its
 * own callers.
 * @module dsh-zotero/client/actions/open-zotero
 */

export {
  clearRefIdentityCacheForTesting,
  parseRefIdentity,
  type ParsedRefIdentity,
} from '../../sources/source-capabilities.js'

import { parseRefIdentity, type ParsedRefIdentity } from '../../sources/source-capabilities.js'

/**
 * Path segment within Zotero protocol URLs: `library/items/<key>` for user
 * libraries and `groups/<id>/items/<key>` for group libraries.
 */
function itemTargetOf(identity: ParsedRefIdentity): string {
  return identity.libraryType === 'group'
    ? `groups/${identity.libraryId}/items/${identity.key}`
    : `library/items/${identity.key}`
}

/**
 * The `zotero://select` deep link for one item ref.
 * Formats personal libraries as `library/items/<key>` and group libraries as `groups/<id>/items/<key>`.
 * @returns the deep link, or null when the ref carries no parseable key.
 */
export function selectUrlOf(ref: string): string | null {
  const identity = parseRefIdentity(ref)
  return identity === null ? null : `zotero://select/${itemTargetOf(identity)}`
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
  const identity = parseRefIdentity(ref)
  if (identity === null) return null
  const target = itemTargetOf(identity)
  const params: string[] = []
  if (options.page !== undefined && options.page !== '')
    params.push(`page=${encodeURIComponent(options.page)}`)
  if (options.annotation !== undefined && options.annotation !== '')
    params.push(`annotation=${encodeURIComponent(options.annotation)}`)
  return `zotero://open-pdf/${target}${params.length === 0 ? '' : `?${params.join('&')}`}`
}
