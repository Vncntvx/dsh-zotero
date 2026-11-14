/**
 * Resolve a stored artifact id back into a concrete parsing/reading target.
 *
 * The browser only ever holds an opaque SHA-256 artifact id. Complete URL
 * sources are reconstructed on the host from the source index or the artifact's
 * own meta, so a signed URL never travels through a wire result. An orphan
 * directory (the artifact committed before its index pointer) is resolvable
 * from meta alone.
 * @module dsh-zotero/enrichment/artifact-target
 */

import type { ZoteroParseTargetView } from '../contract.js'
import { ZOTERO_ARTIFACT_ID_PATTERN } from '../contract.js'
import { ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND, ZoteroError } from '../errors.js'
import { refFieldsOf } from '../ref-grammar.js'
import { canonicalSourceIdentityOf } from './identity.js'
import { parseTargetOf, type ParseTarget } from './parse-target.js'
import type { ParsedArtifactStore, SourceIndexRecord } from './artifact-store.js'

/** The artifact id itself is the cache key: a SHA-256 hex string. */
const ARTIFACT_ID = ZOTERO_ARTIFACT_ID_PATTERN

export interface ArtifactTarget {
  readonly target: ParseTarget
  readonly generation: string
  readonly aliases: readonly string[]
  readonly indexed: boolean
  /** The source-index record backing the artifact; undefined for an orphan directory. */
  readonly record?: SourceIndexRecord
}

/**
 * Rebuild the concrete target for a committed or orphaned artifact.
 * @param artifactId - the cache key naming the artifact directory.
 * @param store - a read-only store bound to the configured output directory.
 * @returns the resolved target plus the generation, the source-index record
 * and its alias keys, from one index read.
 */
export async function resolveArtifactTarget(
  artifactId: string,
  store: ParsedArtifactStore,
): Promise<ArtifactTarget> {
  if (!ARTIFACT_ID.test(artifactId)) {
    throw new ZoteroError('Invalid parsed artifact id.', ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND)
  }
  const stored = await store.metaFor(artifactId)
  if (stored === undefined) {
    throw new ZoteroError(
      'The parsed artifact no longer exists.',
      ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
    )
  }
  const { meta } = stored
  const entries = Object.entries((await store.snapshot()).sources).filter(
    ([, entry]) => entry.cacheKey === artifactId,
  )
  const record = entries[0]?.[1]
  let identity: string
  if (meta.identity.startsWith('zotero://')) {
    if (refFieldsOf(meta.identity)?.kind !== 'attachment') {
      throw new ZoteroError(
        'The parsed artifact has an invalid attachment identity.',
        ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
      )
    }
    identity = canonicalSourceIdentityOf(meta.identity)
  } else if (meta.sourceUrl !== undefined) {
    identity = canonicalSourceIdentityOf(meta.sourceUrl)
  } else if (record?.stamp.kind === 'url') {
    identity = canonicalSourceIdentityOf(record.stamp.url)
  } else {
    throw new ZoteroError(
      'The parsed URL artifact has no recoverable source.',
      ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
    )
  }
  const target = parseTargetOf(
    identity.startsWith('zotero://')
      ? { kind: 'attachment', ref: identity }
      : { kind: 'url', url: identity },
  )
  // Stored identity is already a safe display: a canonical attachment ref or
  // an origin-only URL. The full URL never reaches a display field.
  return {
    target: { ...target, targetLabel: meta.identity },
    generation: meta.generation,
    aliases: entries.map(([key]) => key),
    indexed: record !== undefined,
    ...(record !== undefined ? { record } : {}),
  }
}

/**
 * Expand an opaque artifact target into the concrete source target before any
 * parsing or reading code sees it. Other target shapes pass through unchanged.
 */
export async function expandRequestTarget(
  target: ZoteroParseTargetView,
  store: ParsedArtifactStore,
): Promise<{ readonly target: ZoteroParseTargetView; readonly record?: SourceIndexRecord }> {
  if (target.kind !== 'artifact') return { target }
  const resolved = await resolveArtifactTarget(target.artifactId, store)
  return {
    target: resolved.target.target,
    ...(resolved.record !== undefined ? { record: resolved.record } : {}),
  }
}
