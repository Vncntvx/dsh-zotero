/** Canonical private source identities and safe artifact provenance displays. */
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import { formatRef, parseSupportedRef } from '../refs.js'

/** URLs keep their selecting query, lose fragments, and use URL's canonical href. */
export function canonicalSourceIdentityOf(identity: string): string {
  if (identity.startsWith('zotero://')) {
    return formatRef(parseSupportedRef(identity, ['attachment']))
  }
  let url: URL
  try {
    url = new URL(identity)
  } catch (error) {
    throw new ZoteroError('Invalid document source identity.', ZOTERO_INVALID_ARGUMENT, {
      cause: error,
    })
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new ZoteroError('Invalid document source identity.', ZOTERO_INVALID_ARGUMENT)
  }
  url.hash = ''
  return url.href
}

/** Attachment refs are safe; a URL display retains only its origin. */
export function parsedIdentityOf(identity: string): string {
  const canonical = canonicalSourceIdentityOf(identity)
  return canonical.startsWith('zotero://') ? canonical : `${new URL(canonical).origin}/…`
}
