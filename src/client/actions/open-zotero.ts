/**
 * Canonical Zotero deep links and identity parsing, built purely from session
 * facts (refs the session's tool calls produced). Deep links are canonical
 * URLs copied to the clipboard for external reference or quick search, while
 * PDF reading is performed natively in the sidebar.
 * @module dsh-zotero/client/actions/open-zotero
 */

import { REF_IN_TEXT_PATTERN, type RefKind } from '../../ref-grammar.ts'

/** Structured identity parsed from a canonical Zotero ref. */
export interface ParsedRefIdentity {
  readonly libraryType: 'user' | 'group'
  readonly libraryId: string
  readonly kind: RefKind
  readonly key: string
}

const REF_IDENTITY_CACHE_LIMIT = 500
const refIdentityCache = new Map<string, ParsedRefIdentity | null>()

/**
 * Clear the reference identity cache. Exported for test isolation.
 */
export function clearRefIdentityCacheForTesting(): void {
  refIdentityCache.clear()
}

/**
 * Parse the library identity (type, id, kind, key) from one ref.
 * Supports both personal (`user/0`) and group (`group/<id>`) libraries.
 * Results are cached in a bounded Map to eliminate redundant regex evaluation.
 */
export function parseRefIdentity(ref: string): ParsedRefIdentity | null {
  const cached = refIdentityCache.get(ref)
  if (cached !== undefined) return cached

  const match = REF_IN_TEXT_PATTERN.exec(ref)
  let result: ParsedRefIdentity | null = null
  if (match?.groups) {
    const { libraryType, libraryId, kind, key } = match.groups
    if (libraryType && libraryId && kind && key) {
      result = {
        libraryType: libraryType as 'user' | 'group',
        libraryId,
        kind: kind as RefKind,
        key,
      }
    }
  }

  if (refIdentityCache.size >= REF_IDENTITY_CACHE_LIMIT) {
    const firstKey = refIdentityCache.keys().next().value
    if (firstKey !== undefined) refIdentityCache.delete(firstKey)
  }
  refIdentityCache.set(ref, result)
  return result
}

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
