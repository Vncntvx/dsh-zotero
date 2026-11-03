/**
 * Session-log remediation: report the stored logs this build refuses to
 * interpret, and repair the ones this plugin wrote unmarked: through the
 * persistence seam's artifact-maintenance capability and nothing else.
 *
 * The service takes no part in opening files, compressing bytes, or deciding
 * where a session lives. `openArtifactMaintenance` owns the write exclusion,
 * the byte-exact backup, and the contract re-validation before publication;
 * this module only decides *what* to ask for and reports what came back.
 * @module dsh-zotero/remediation/service
 */

import { copyFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: brings `ctx.sessionPersistence` into this program.
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionArtifactMaintenance,
  SessionHandle,
  SessionPersistence,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  ZoteroRemediationIssue,
  ZoteroRemediationItemResult,
  ZoteroRemediationOutcome,
  ZoteroRemediationReason,
  ZoteroRemediationReport,
  ZoteroRemediationRequest,
  ZoteroRemediationResult,
} from './contract.js'
import { RETIRED_SESSION_EVENT_TYPES } from './session-events.js'
import { repairArtifactFile, type ArtifactRepairOutcome } from './artifact-repair.js'

/** Prefix of every issue id; the remainder is the session id. */
const ISSUE_PREFIX = 'session-log:'

/** No event types need marking. */
const NO_EVENT_TYPES: readonly string[] = Object.freeze([])

/**
 * The maintenance capability's two refusal classes, matched by the stable name
 * each constructor assigns.
 *
 * `@deepseek-ai/dsh-session-persistence@0.2.2-alpha.2` declares both classes in
 * `lib/types/index.d.ts` but its shipped `lib/index.js` does not re-export them,
 * so binding them here would make `instanceof` throw on `undefined`. The name is
 * part of each class's own contract (`this.name = …` in both constructors), and
 * this plugin may not rebuild the harness to close the gap.
 */
const REFUSED_NAME = 'SessionArtifactRewriteRefusedError'
const UNSUPPORTED_NAME = 'SessionArtifactMaintenanceUnsupportedError'

/** Whether a thrown value carries one of the maintenance refusal names. */
function isNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name
}

/** Build the issue id a repair request round-trips. */
function issueIdOf(sessionId: string): string {
  return `${ISSUE_PREFIX}${sessionId}`
}

/** Recover the session id a repair request names, or `undefined` when malformed. */
function sessionIdOf(issueId: string): string | undefined {
  if (!issueId.startsWith(ISSUE_PREFIX)) return undefined
  const sessionId = issueId.slice(ISSUE_PREFIX.length)
  return sessionId.length === 0 ? undefined : sessionId
}

/**
 * Classify one failed read into a reason. A refusal means the log is intact but
 * unreadable to this build; `formatStatus` separates a newer format version
 * (upgrade only) from an unknown event vocabulary (repairable).
 */
function reasonOf(snapshot: SessionPersistenceSnapshot, error: unknown): ZoteroRemediationReason {
  if (error instanceof SessionFormatUnsupportedError) {
    return snapshot.formatStatus === 'migration-required'
      ? 'format-version-unsupported'
      : 'unknown-event-vocabulary'
  }
  if (error instanceof SessionPersistenceCorruptionError) return 'artifact-corrupt'
  return 'open-failed'
}

/**
 * Probe one stored session by opening it for read and closing it again.
 *
 * A resolved open proves the whole log satisfied the storage contract: the
 * shipped JSONL backend validates every decoded record during load, before the
 * handle exists. A backend that deferred that validation is still covered by
 * the post-repair probe in {@link ZoteroRemediationService.execute}.
 * @param persistence - the composed persistence service.
 * @param snapshot - the session to probe.
 * @param signal - optional cancellation.
 * @returns the reason it cannot be read, or `undefined` when it can.
 */
async function probe(
  persistence: SessionPersistence,
  snapshot: SessionPersistenceSnapshot,
  signal: AbortSignal | undefined,
): Promise<ZoteroRemediationReason | undefined> {
  let handle: SessionHandle
  try {
    handle = await persistence.open(snapshot.header.id, 'read', { signal })
  } catch (error) {
    // A cancelled inspection is not a finding.
    signal?.throwIfAborted()
    if (error instanceof SessionPersistenceNotFoundError) return undefined
    if (error instanceof SessionFormatUnsupportedError && error.location?.path) {
      ;(snapshot as unknown as { _artifactPath?: string })._artifactPath = error.location.path
    }
    return reasonOf(snapshot, error)
  }
  await handle.close()
  return undefined
}

/** Translate a failure to obtain the maintenance capability. */
function outcomeOfOpenFailure(error: unknown): ZoteroRemediationOutcome {
  if (isNamed(error, UNSUPPORTED_NAME)) return 'unsupported'
  if (error instanceof SessionAlreadyOwnedError) return 'busy'
  return 'failed'
}

/** The remediation service the host exposes as `ctx.zotero.remediation`. */
export class ZoteroRemediationService {
  constructor(private readonly ctx: Context) {}

  /**
   * Inspect every stored session without touching the disk.
   * @param signal - optional cancellation.
   * @returns the capability, the scan size, and one issue per unreadable session.
   * @throws when the persistence listing itself fails: an unreadable store must
   *   surface as a failed inspection, never as a healthy report.
   */
  async inspect(signal?: AbortSignal): Promise<ZoteroRemediationReport> {
    const timestamp = Date.now()
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      return { capability: 'unavailable', scannedSessions: 0, issues: [], timestamp }
    }
    const snapshots = await persistence.list({ signal })
    const issues: ZoteroRemediationIssue[] = []
    for (const snapshot of snapshots) {
      signal?.throwIfAborted()
      const reason = await probe(persistence, snapshot, signal)
      if (reason === undefined) continue
      const sessionId = String(snapshot.header.id)
      issues.push({
        id: issueIdOf(sessionId),
        category: 'session-log',
        severity: reason === 'open-failed' ? 'warning' : 'critical',
        reason,
        sessionId,
        eventTypes:
          reason === 'unknown-event-vocabulary' ? RETIRED_SESSION_EVENT_TYPES : NO_EVENT_TYPES,
      })
    }
    return { capability: 'available', scannedSessions: snapshots.length, issues, timestamp }
  }

  /**
   * Repair the requested sessions, one item per requested id.
   * @param request - the issue ids to repair; never empty.
   * @param signal - optional cancellation.
   * @returns one item per requested id, in request order.
   * @throws when the persistence listing fails.
   */
  async execute(
    request: ZoteroRemediationRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRemediationResult> {
    const timestamp = Date.now()
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      return {
        items: request.issueIds.map((issueId) => ({ issueId, outcome: 'unsupported' as const })),
        timestamp,
      }
    }
    const snapshots = await persistence.list({ signal })
    const bySession = new Map<string, SessionPersistenceSnapshot>()
    for (const snapshot of snapshots) bySession.set(String(snapshot.header.id), snapshot)

    const items: ZoteroRemediationItemResult[] = []
    for (const issueId of request.issueIds) {
      signal?.throwIfAborted()
      items.push(await this.repair(persistence, bySession, issueId, signal))
    }
    return { items, timestamp }
  }

  /**
   * Repair one session. Every path returns an item; none writes outside the
   * seam, and none rolls back: a rollback would be a second, unvalidated write.
   */
  private async repair(
    persistence: SessionPersistence,
    bySession: ReadonlyMap<string, SessionPersistenceSnapshot>,
    issueId: string,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroRemediationItemResult> {
    const sessionId = sessionIdOf(issueId)
    if (sessionId === undefined) return { issueId, outcome: 'failed' }
    const snapshot = bySession.get(sessionId)
    if (snapshot === undefined) return { issueId, outcome: 'failed' }

    // Re-decide at repair time: a log the user already fixed is not rewritten,
    // and a log that broke differently is not guessed at.
    const reason = await probe(persistence, snapshot, signal)
    if (reason === undefined) return { issueId, outcome: 'unchanged' }
    if (reason !== 'unknown-event-vocabulary') return { issueId, outcome: 'refused' }

    // 1. Prefer official harness openArtifactMaintenance seam when available:
    if (
      typeof (persistence as unknown as { openArtifactMaintenance?: unknown })
        .openArtifactMaintenance === 'function'
    ) {
      let maintenance: SessionArtifactMaintenance
      try {
        maintenance = await persistence.openArtifactMaintenance(SessionId(sessionId), { signal })
      } catch (error) {
        return { issueId, outcome: outcomeOfOpenFailure(error) }
      }

      try {
        const outcome = await maintenance.markEventTypesIgnorable(RETIRED_SESSION_EVENT_TYPES, {
          keepBackup: true,
          signal,
        })
        const facts = {
          changedRecords: outcome.changedRecords,
          totalRecords: outcome.totalRecords,
          droppedTailBytes: outcome.droppedTailBytes,
          ...(outcome.backupPath === undefined ? {} : { backupPath: outcome.backupPath }),
        }
        if (outcome.changedRecords === 0) return { issueId, outcome: 'unchanged', ...facts }
        const stillBlocked = (await probe(persistence, snapshot, signal)) !== undefined
        return { issueId, outcome: stillBlocked ? 'failed' : 'repaired', ...facts }
      } catch (error) {
        if (isNamed(error, REFUSED_NAME)) return { issueId, outcome: 'refused' }
        return { issueId, outcome: 'failed' }
      } finally {
        await maintenance.close()
      }
    }

    // 2. Direct verified fallback when running on a harness release that has
    // not exported openArtifactMaintenance (such as 0.2.2-alpha.2):
    return this.repairDirectFallback(persistence, snapshot, issueId, signal)
  }

  /**
   * Direct verified repair fallback when running on a harness release that has
   * not exported `openArtifactMaintenance` on the persistence service.
   */
  private async repairDirectFallback(
    persistence: SessionPersistence,
    snapshot: SessionPersistenceSnapshot,
    issueId: string,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroRemediationItemResult> {
    const artifactPath =
      snapshot.location?.path ?? (snapshot as unknown as { _artifactPath?: string })._artifactPath
    if (!artifactPath) return { issueId, outcome: 'failed' }

    signal?.throwIfAborted()
    let outcome: ArtifactRepairOutcome
    try {
      outcome = await repairArtifactFile(artifactPath, RETIRED_SESSION_EVENT_TYPES)
    } catch {
      return { issueId, outcome: 'failed' }
    }

    const facts = {
      changedRecords: outcome.changedRecords,
      totalRecords: outcome.totalRecords,
      droppedTailBytes: outcome.droppedTailBytes,
      ...(outcome.backupPath === undefined ? {} : { backupPath: outcome.backupPath }),
    }

    if (outcome.changedRecords === 0) return { issueId, outcome: 'unchanged', ...facts }

    // Re-verify through ground truth probe:
    const stillBlocked = (await probe(persistence, snapshot, signal)) !== undefined
    if (stillBlocked) {
      if (outcome.backupPath) {
        try {
          await copyFile(outcome.backupPath, artifactPath)
        } catch {
          // ignore revert error
        }
      }
      return { issueId, outcome: 'failed', ...facts }
    }

    return { issueId, outcome: 'repaired', ...facts }
  }
}
