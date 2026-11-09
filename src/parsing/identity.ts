/**
 * The identity written into `meta.json`.
 *
 * The artifact cache needs the full identity (a URL can carry a signed token
 * that selects one exact copy), but a provenance file must not persist that
 * token in plaintext. A URL's origin and path identify the document; its query
 * and fragment are dropped. A local ref carries no such secret and is kept
 * verbatim.
 * @module dsh-zotero/parsing/identity
 */

/**
 * Strip a URL's query and fragment, keeping origin and path.
 * @param identity - an attachment ref or a public URL.
 * @returns the redacted provenance string.
 */
export function parsedIdentityOf(identity: string): string {
  try {
    const url = new URL(identity)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.origin}${url.pathname}`
    }
  } catch {
    // Not a URL: a Zotero ref is already safe provenance.
  }
  return identity
}
