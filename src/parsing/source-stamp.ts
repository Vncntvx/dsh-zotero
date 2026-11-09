/**
 * The source-index identity and stamp comparison used by the parsed-artifact
 * cache.
 *
 * The content cache is keyed by a fingerprint of the exact bytes, so it can
 * only be consulted after the bytes exist. The source index closes that gap:
 * it records which content artifact belonged to one `identity + mode` pair and
 * what the source looked like when it was fetched. A hit therefore needs no
 * PDF read and no MinerU call.
 *
 * `stampMatches` is deliberately conservative about validators: a URL's
 * `ETag`/`Last-Modified`/`Content-Length` is compared when both sides carry the
 * same one. When neither side offers a validator (a HEAD that failed, or a
 * server that sends none), the URL itself is the identity and the cached
 * artifact is served; forcing a download on an unvalidatable source would
 * defeat the cache without making it any fresher.
 * @module dsh-zotero/parsing/source-stamp
 */

import { createHash } from 'node:crypto'
import type { FulltextSourceStamp } from '../local/fulltext-enhancer.js'
import type { ParsingMode } from '../parsing-preferences.js'

/** The per-source index key: identity and mode, never user-visible text. */
export function sourceKeyOf(identity: string, mode: ParsingMode): string {
  return createHash('sha256')
    .update(JSON.stringify([identity, mode]))
    .digest('hex')
}

/**
 * Whether a stored stamp still describes the current source.
 * @param stored - the stamp written with the cached artifact.
 * @param current - the stamp probed now.
 * @returns true when the artifact may be served without fetching the source.
 */
export function stampMatches(stored: FulltextSourceStamp, current: FulltextSourceStamp): boolean {
  if (stored.kind !== current.kind) return false
  if (stored.kind === 'file' && current.kind === 'file') {
    return stored.size === current.size && stored.mtimeMs === current.mtimeMs
  }
  if (stored.kind === 'bytes' && current.kind === 'bytes') {
    return stored.fingerprint === current.fingerprint
  }
  if (stored.kind === 'url' && current.kind === 'url') {
    if (stored.url !== current.url) return false
    if (stored.etag !== undefined && current.etag !== undefined) {
      return stored.etag === current.etag
    }
    if (stored.lastModified !== undefined && current.lastModified !== undefined) {
      return stored.lastModified === current.lastModified
    }
    if (stored.contentLength !== undefined && current.contentLength !== undefined) {
      return stored.contentLength === current.contentLength
    }
    // No common validator: the URL is the identity.
    return true
  }
  return false
}
