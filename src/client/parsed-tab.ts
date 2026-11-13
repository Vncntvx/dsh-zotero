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
 * ref may carry its own query, so both ride percent-encoded path segments.
 * Presentation values travel separately in the tab's navigation parameters.
 */
export function parsedTabAddress(target: ParsedTabTarget): string {
  return `${PREFIX}${encodeURIComponent(target.sessionId)}/${encodeURIComponent(target.ref)}`
}

/**
 * Read an address back.
 * @param address - a tab address as recorded by the right sidebar.
 * @returns the target, or undefined for an address this page does not own.
 */
export function parseParsedTabAddress(
  address: string,
  presentation?: unknown,
): ParsedTabTarget | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const rest = address.slice(PREFIX.length)
  const separator = rest.indexOf('?')
  const path = separator === -1 ? rest : rest.slice(0, separator)
  const segments = path.split('/')
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return undefined
  try {
    const values =
      presentation !== null && typeof presentation === 'object'
        ? (presentation as Record<string, unknown>)
        : {}
    return {
      sessionId: decodeURIComponent(segments[0]!),
      ref: decodeURIComponent(segments[1]!),
      title: typeof values.title === 'string' ? values.title : '',
      ...(typeof values.item === 'string' && values.item !== '' ? { item: values.item } : {}),
    }
  } catch {
    // A malformed escape is not this page's document; the caller shows its
    // unavailable state rather than throwing inside a tab.
    return undefined
  }
}
