/**
 * Item identity and instance match rules of the session source model. Identity
 * is the normalized ref; evidenceMatch is the verdict of the item's qualified
 * refs against the currently connected Zotero instance. Same-key refs always
 * fold into one source record, and a ref qualified for another instance marks
 * the record `mismatch` instead of splitting it.
 * @module dsh-zotero/client/sources/evidence-match
 */

import type { EvidenceMatchStatus, SourceWorkspace } from './model.js'
import { SERVER_ID_SOURCE } from '../ref-grammar.js'

/** The item identity: the ref without its query, lowercased. */
export function normalizeRefKey(ref: string): string {
  // split with a limit always yields a non-empty array; indexing is safe.
  return ref.split('?', 1)[0]!.toLowerCase()
}

/** The `?server=` qualifier of a zotero:// ref, when it carries one. */
const SERVER_PARAM_PATTERN = new RegExp(`(?:^|&)server=(${SERVER_ID_SOURCE})(?:&|$)`)

export function serverIdOf(ref: string): string | undefined {
  const query = ref.split('?', 2)[1]
  if (query === undefined) return undefined
  return SERVER_PARAM_PATTERN.exec(query)?.[1]
}

/**
 * The instance match verdict of one item's qualified refs against the connected
 * instance. No qualifiers, or an unknown current instance, can never verify
 * anything, so the verdict is `unknown`. Any qualifier that differs from the
 * current instance fails the whole record closed as `mismatch`.
 * @param serverIds - the distinct qualified Server IDs the item's refs carry.
 * @param currentServerId - the connected instance's Server ID, when known.
 * @returns the verdict.
 */
export function evidenceMatchOf(
  serverIds: ReadonlySet<string>,
  currentServerId: string | undefined,
): EvidenceMatchStatus {
  if (currentServerId === undefined || serverIds.size === 0) return 'unknown'
  for (const id of serverIds) {
    if (id !== currentServerId) return 'mismatch'
  }
  return 'verified'
}

/**
 * Recompute the instance verdict with the connected Server ID the browser probe
 * knows and the host fold cannot. The ledger view carries the raw qualified
 * ids; only the client has the live connection fact.
 * @param workspace - a workspace whose sources carry `serverIds`.
 * @param currentServerId - the connected instance's Server ID, when known.
 * @returns the same workspace with every item's `evidenceMatch` re-evaluated.
 */
export function withEvidenceMatch(
  workspace: SourceWorkspace,
  currentServerId: string | undefined,
): SourceWorkspace {
  return {
    ...workspace,
    sources: workspace.sources.map((item) => ({
      ...item,
      evidenceMatch: evidenceMatchOf(new Set(item.serverIds), currentServerId),
    })),
  }
}
