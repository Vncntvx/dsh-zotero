/**
 * Item identity and instance match rules of the session source model. Identity
 * is the normalized ref; evidenceMatch is the verdict of the item's qualified
 * refs against the currently connected Zotero instance. Same-key refs always
 * fold into one source record, and a ref qualified for another instance marks
 * the record `mismatch` instead of splitting it.
 * @module dsh-zotero/client/sources/evidence-match
 */
import type { EvidenceMatchStatus, SourceWorkspace } from './model.js';
/** The item identity: the ref without its query, lowercased. */
export declare function normalizeRefKey(ref: string): string;
export declare function serverIdOf(ref: string): string | undefined;
/**
 * The instance match verdict of one item's qualified refs against the connected
 * instance. No qualifiers, or an unknown current instance, can never verify
 * anything, so the verdict is `unknown`. Any qualifier that differs from the
 * current instance fails the whole record closed as `mismatch`.
 * @param serverIds - the distinct qualified Server IDs the item's refs carry.
 * @param currentServerId - the connected instance's Server ID, when known.
 * @returns the verdict.
 */
export declare function evidenceMatchOf(serverIds: ReadonlySet<string>, currentServerId: string | undefined): EvidenceMatchStatus;
/**
 * Recompute the instance verdict with the connected Server ID the browser probe
 * knows and the host fold cannot. The ledger view carries the raw qualified
 * ids; only the client has the live connection fact.
 * @param workspace - a workspace whose sources carry `serverIds`.
 * @param currentServerId - the connected instance's Server ID, when known.
 * @returns the same workspace with every item's `evidenceMatch` re-evaluated.
 */
export declare function withEvidenceMatch(workspace: SourceWorkspace, currentServerId: string | undefined): SourceWorkspace;
//# sourceMappingURL=evidence-match.d.ts.map