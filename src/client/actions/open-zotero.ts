/**
 * Canonical Zotero deep links and identity parsing, built purely from session
 * facts (refs the session's tool calls produced). Deep links are canonical
 * URLs copied to the clipboard for external reference or quick search, while
 * PDF reading is performed natively in the sidebar.
 * @module dsh-zotero/client/actions/open-zotero
 */

import { REF_IN_TEXT_PATTERN, type RefKind } from '../../ref-grammar.ts'
import { getProtocolDispatcher } from './protocol-dispatcher.ts'

/** Structured identity parsed from a canonical Zotero ref. */
interface ParsedRefIdentity {
  readonly libraryType: 'user' | 'group'
  readonly libraryId: string
  readonly kind: RefKind
  readonly key: string
}

const REF_IDENTITY_CACHE_LIMIT = 500
const refIdentityCache = new Map<string, ParsedRefIdentity | null>()

const GENERAL_REF_PATTERN =
  /^zotero:\/\/(?<libraryType>user|group)\/(?<libraryId>\d+)\/(?<kind>item|attachment|annotation|collection|search)\/(?<key>[A-Za-z0-9_-]+)/

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

  const match = REF_IN_TEXT_PATTERN.exec(ref) ?? GENERAL_REF_PATTERN.exec(ref)
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

/**
 * Safely trigger the system protocol handler for a zotero:// deep link.
 * Prioritizes the host remote RPC dispatcher (allowing native launching in Electron desktop);
 * falls back to a detached DOM anchor element click in pure web browsers.
 * @param url - canonical zotero:// URL.
 * @returns true if dispatched, false if refused or invalid.
 */
export function launchZoteroProtocol(url: string): boolean {
  if (!url.startsWith('zotero://')) return false

  const dispatcher = getProtocolDispatcher()
  if (dispatcher !== undefined) {
    void dispatcher(url)
      .then((handled) => {
        if (!handled) {
          dispatchDomProtocol(url)
        }
      })
      .catch(() => {
        dispatchDomProtocol(url)
      })
    return true
  }

  return dispatchDomProtocol(url)
}

/**
 * Asynchronously trigger the system protocol handler for a zotero:// deep link.
 * Awaits the host remote RPC when available.
 */
export async function launchZoteroProtocolAsync(url: string): Promise<boolean> {
  if (!url.startsWith('zotero://')) return false

  const dispatcher = getProtocolDispatcher()
  if (dispatcher !== undefined) {
    try {
      return await dispatcher(url)
    } catch {
      return false
    }
  }

  return dispatchDomProtocol(url)
}

function dispatchDomProtocol(url: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!url.startsWith('zotero://')) return false
  try {
    const link = document.createElement('a')
    link.href = url
    link.rel = 'noopener noreferrer'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return true
  } catch {
    return false
  }
}
