/**
 * The parsed-document page the library opens in the right sidebar. A tab's
 * identity is its address path: (session, attachment) for Zotero sources and
 * (session, artifact id) for URL sources, so reopening the same document
 * reveals its tab instead of stacking a second one. The title and item ride
 * the address query and the navigation parameters as presentation values only
 * — refresh matching compares the parsed path, never the exact string — and
 * an explicit navigation parameter wins over the query after a restore.
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
  /** The Zotero attachment ref; empty for an artifact-addressed URL source. */
  readonly ref: string
  /** An opaque stored artifact id; present for URL-sourced parsed documents. */
  readonly artifactId?: string
  /** The paper title: the tab chip and the download file are named after it. */
  readonly title: string
  /** The Zotero item the attachment belongs to; an explain request cites it. */
  readonly item?: string
}

/**
 * Compose the tab address. The session and the ref are opaque strings and the
 * ref may carry its own query, so both ride percent-encoded path segments.
 * Presentation values travel in the address query and in the tab's navigation
 * parameters; an explicit navigation parameter wins.
 */
export function parsedTabAddress(target: ParsedTabTarget): string {
  const base = `${PREFIX}${encodeURIComponent(target.sessionId)}/${encodeURIComponent(target.ref)}`
  const params = new URLSearchParams()
  if (target.title) params.set('title', target.title)
  if (target.item) params.set('item', target.item)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * One address per stored artifact: URL sources have no Zotero ref, so the
 * artifact id rides the address and the host resolves the concrete source.
 */
export function parsedArtifactTabAddress(target: {
  readonly sessionId: string
  readonly artifactId: string
}): string {
  return `${PREFIX}artifact/${encodeURIComponent(target.sessionId)}/${encodeURIComponent(target.artifactId)}`
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
  const query = separator === -1 ? '' : rest.slice(separator + 1)
  const segments = path.split('/')
  const values =
    presentation !== null && typeof presentation === 'object'
      ? (presentation as Record<string, unknown>)
      : {}
  const title =
    typeof values.title === 'string' && values.title !== ''
      ? values.title
      : paramsOf(query).get('title') || ''
  const item =
    typeof values.item === 'string' && values.item !== ''
      ? values.item
      : paramsOf(query).get('item') || undefined
  try {
    if (segments.length === 3 && segments[0] === 'artifact') {
      if (segments[1] === '' || segments[2] === '') return undefined
      return {
        sessionId: decodeURIComponent(segments[1]!),
        ref: '',
        artifactId: decodeURIComponent(segments[2]!),
        title,
        ...(item ? { item } : {}),
      }
    }
    if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return undefined
    return {
      sessionId: decodeURIComponent(segments[0]!),
      ref: decodeURIComponent(segments[1]!),
      title,
      ...(item ? { item } : {}),
    }
  } catch {
    // A malformed escape is not this page's document; the caller shows its
    // unavailable state rather than throwing inside a tab.
    return undefined
  }
}

/** Parse the address query separately so a malformed escape stays a miss. */
function paramsOf(query: string): URLSearchParams {
  try {
    return new URLSearchParams(query)
  } catch {
    return new URLSearchParams()
  }
}
