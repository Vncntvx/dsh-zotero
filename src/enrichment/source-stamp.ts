/**
 * The source-index identity and stamp comparison used by the parsed-artifact
 * cache.
 *
 * The content cache is keyed by a fingerprint of the exact bytes, so it can
 * only be consulted after the bytes exist. The source index closes that gap:
 * it records which latest committed artifact belonged to one canonical source
 * and what the source looked like when it was fetched. A hit needs no PDF read
 * and no MinerU call; the selected parsing mode does not change this index.
 *
 * URL hits require a common freshness validator. A URL or a matching byte
 * length alone cannot prove that its content has not changed.
 * @module dsh-zotero/enrichment/source-stamp
 */

import { createHash } from 'node:crypto'
import type { FulltextSourceStamp } from './types.js'
import { canonicalSourceIdentityOf } from './identity.js'

/** SHA-256 of the canonical primary or verified alias, independent of mode. */
export function sourceKeyOf(identity: string): string {
  return createHash('sha256').update(canonicalSourceIdentityOf(identity)).digest('hex')
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
    for (const field of ['etag', 'lastModified', 'contentLength'] as const) {
      if (
        stored[field] !== undefined &&
        current[field] !== undefined &&
        stored[field] !== current[field]
      )
        return false
    }
    if (stored.etag !== undefined && current.etag !== undefined) return true
    return (
      stored.lastModified !== undefined &&
      current.lastModified !== undefined &&
      stored.contentLength !== undefined &&
      current.contentLength !== undefined
    )
  }
  return false
}
