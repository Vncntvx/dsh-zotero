/**
 * View types for session-log remediation.
 *
 * Every field is a fact the host observed or the persistence backend reported;
 * none is a rendered sentence. The client turns `reason` and `outcome` into
 * copy through the dictionary, so an English string never reaches a Chinese
 * surface and an enum value is never shown raw.
 * @module dsh-zotero/remediation/contract
 */

/** The subsystem domain a remediation issue belongs to. */
export type ZoteroRemediationCategory = 'session-log'

/** How much the issue blocks the user. */
export type ZoteroRemediationSeverity = 'critical' | 'warning'

/**
 * Why a stored log needs maintenance. Each value is decided from a typed
 * failure: never from error text.
 */
export type ZoteroRemediationReason =
  /** The log carries an unknown event type the writer left unmarked; repairable. */
  | 'unknown-event-vocabulary'
  /** The header's format version is newer than this build reads; upgrade only. */
  | 'format-version-unsupported'
  /** The artifact failed validation after a successful backend read. */
  | 'artifact-corrupt'
  /** The backend refused the read for another reason. */
  | 'open-failed'

/** Whether this deployment exposes the persistence maintenance capability. */
export type ZoteroRemediationCapability = 'available' | 'unavailable'

/** What one repair attempt did. */
export type ZoteroRemediationOutcome =
  /** Records were rewritten and the log now opens. */
  | 'repaired'
  /** Nothing needed changing, or the log was already healthy. */
  | 'unchanged'
  /** The backend refused the rewrite; nothing was written. */
  | 'refused'
  /** A live writer holds the session's write exclusion; retry after closing it. */
  | 'busy'
  /** This persistence backend exposes no artifact maintenance. */
  | 'unsupported'
  /** The attempt failed; the pre-rewrite copy is named when one was kept. */
  | 'failed'

/** One stored log this build cannot read, with the reason it cannot. */
export interface ZoteroRemediationIssue {
  /** `session-log:<sessionId>`, the only identifier a repair request carries. */
  readonly id: string
  readonly category: ZoteroRemediationCategory
  readonly severity: ZoteroRemediationSeverity
  readonly reason: ZoteroRemediationReason
  readonly sessionId: string
  /** Event types a repair would mark; empty unless `reason` is repairable. */
  readonly eventTypes: readonly string[]
}

/** One inspection pass over every stored session. */
export interface ZoteroRemediationReport {
  readonly capability: ZoteroRemediationCapability
  readonly scannedSessions: number
  readonly issues: readonly ZoteroRemediationIssue[]
  readonly timestamp: number
}

/** The sessions a repair request targets. At least one, never "everything". */
export interface ZoteroRemediationRequest {
  readonly issueIds: readonly string[]
}

/** What one repair attempt measured. */
export interface ZoteroRemediationItemResult {
  readonly issueId: string
  readonly outcome: ZoteroRemediationOutcome
  /** Records whose bytes changed; `0` wrote nothing. */
  readonly changedRecords?: number
  /** Records the rewrite examined, header included. */
  readonly totalRecords?: number
  /** Artifact bytes discarded as an unreadable tail. */
  readonly droppedTailBytes?: number
  /** Backend-chosen path of the retained pre-rewrite copy. */
  readonly backupPath?: string
}

/** One repair run: exactly one item per requested id. */
export interface ZoteroRemediationResult {
  readonly items: readonly ZoteroRemediationItemResult[]
  readonly timestamp: number
}
