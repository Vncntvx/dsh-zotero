/**
 * Item identity and provenance rules of the session source model. Identity
 * is the normalized ref; provenance is the verdict of the item's qualified
 * refs against the currently connected Zotero instance. Same-key refs always
 * fold into one source record — a ref qualified for another instance marks
 * the record `mismatch` instead of splitting it.
 * @module dsh-zotero/client/sources/provenance
 */

import type { ItemProvenance } from './model.ts'

/** The item identity: the ref without its query, lowercased. */
export function normalizeRefKey(ref: string): string {
  return ref.split('?', 1)[0]!.toLowerCase()
}

/** The `?server=` qualifier of a zotero:// ref, when it carries one. */
export function serverIdOf(ref: string): string | undefined {
  const query = ref.split('?', 2)[1]
  if (query === undefined) return undefined
  const match = /(?:^|&)server=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(query)
  return match?.[1]
}

/**
 * The provenance verdict of one item's qualified refs against the connected
 * instance. No qualifiers, or an unknown current instance, can never verify
 * anything — `unknown`. Any qualifier that differs from the current instance
 * fails the whole record closed — `mismatch`.
 * @param serverIds - the distinct qualified Server IDs the item's refs carry.
 * @param currentServerId - the connected instance's Server ID, when known.
 * @returns the verdict.
 */
export function provenanceOf(
  serverIds: ReadonlySet<string>,
  currentServerId: string | undefined,
): ItemProvenance {
  if (currentServerId === undefined || serverIds.size === 0) return 'unknown'
  for (const id of serverIds) {
    if (id !== currentServerId) return 'mismatch'
  }
  return 'verified'
}
