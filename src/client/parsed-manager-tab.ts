/**
 * The parsed-document manager page: one session-scoped right-sidebar tab that
 * lists every committed artifact and owns open / reparse / discard actions.
 * @module dsh-zotero/client/parsed-manager-tab
 */

/** The tab kind the manager page registers under. */
export const PARSED_MANAGER_TAB_KIND = 'zotero-parsed-manager'

/** The address glob the manager tab matches. */
export const PARSED_MANAGER_TAB_PATTERN = 'dsh-resource://zotero-parsed-manager/**'

const PREFIX = 'dsh-resource://zotero-parsed-manager/'

export interface ParsedManagerTabTarget {
  readonly sessionId: string
}

/** One manager tab per session; reopening reveals the existing tab. */
export function parsedManagerTabAddress(target: ParsedManagerTabTarget): string {
  return `${PREFIX}${encodeURIComponent(target.sessionId)}`
}

/** Read an address back, or undefined when it is not a manager tab. */
export function parseParsedManagerTabAddress(address: string): ParsedManagerTabTarget | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const rest = address.slice(PREFIX.length)
  const separator = rest.indexOf('?')
  const path = separator === -1 ? rest : rest.slice(0, separator)
  if (path === '' || path.includes('/')) return undefined
  try {
    return { sessionId: decodeURIComponent(path) }
  } catch {
    return undefined
  }
}
