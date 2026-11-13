/**
 * The parsed-document page the library opens in the right sidebar. One
 * address per (session, attachment) keeps the tab identity stable: opening the
 * same parsed PDF again reveals its tab instead of stacking a second one.
 * @module dsh-zotero/client/parsed-tab
 */

/** The tab kind the parsed-document page registers under. */
export const PARSED_TAB_KIND = 'zotero-parsed'

/** The address glob every parsed-document tab matches. */
export const PARSED_TAB_PATTERN = 'dsh-resource://zotero-parsed/**'

const PREFIX = 'dsh-resource://zotero-parsed/'

/** What one parsed-document tab shows. */
export interface ParsedTabTarget {
  readonly sessionId: string
  /** The Zotero attachment ref; it may itself carry a `?server=` suffix. */
  readonly ref: string
  /** The paper title: the tab chip and the download file are named after it. */
  readonly title: string
  /** The Zotero item the attachment belongs to; an explain request cites it. */
  readonly item?: string
}

/**
 * Compose the tab address. The session and the ref are opaque strings and the
 * ref may carry its own query, so both ride percent-encoded path segments and
 * only the title uses a query parameter.
 */
export function parsedTabAddress(target: ParsedTabTarget): string {
  const query = new URLSearchParams({ title: target.title })
  if (target.item !== undefined) query.set('item', target.item)
  return `${PREFIX}${encodeURIComponent(target.sessionId)}/${encodeURIComponent(target.ref)}?${query.toString()}`
}

/**
 * Read an address back.
 * @param address - a tab address as recorded by the right sidebar.
 * @returns the target, or undefined for an address this page does not own.
 */
export function parseParsedTabAddress(address: string): ParsedTabTarget | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const rest = address.slice(PREFIX.length)
  const separator = rest.indexOf('?')
  const path = separator === -1 ? rest : rest.slice(0, separator)
  const query = separator === -1 ? '' : rest.slice(separator + 1)
  const segments = path.split('/')
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return undefined
  try {
    const params = new URLSearchParams(query)
    const item = params.get('item')
    return {
      sessionId: decodeURIComponent(segments[0]!),
      ref: decodeURIComponent(segments[1]!),
      title: params.get('title') ?? '',
      ...(item !== null && item !== '' ? { item } : {}),
    }
  } catch {
    // A malformed escape is not this page's document; the caller shows its
    // unavailable state rather than throwing inside a tab.
    return undefined
  }
}
