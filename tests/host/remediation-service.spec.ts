/**
 * The remediation service against a persistence stub whose verdicts come from
 * the harness's own storage contract: a stub session "opens" only when
 * `validateStoredEvents` accepts its records, and a rewrite is refused only when
 * that same validator still refuses the result.
 *
 * The stub replaces the JSONL backend because that package is not part of this
 * plugin's dependency set; it replaces *judgement* with nothing, so a passing
 * case here means the harness rule held, not that our own code agreed with
 * itself.
 * @module tests/host/remediation-service
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync, unlinkSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  validateStoredEvents,
  type SessionLocation,
} from '@deepseek-ai/dsh-session-persistence'
import { ZoteroRemediationService } from '../../src/remediation/service.js'
import { RETIRED_SESSION_EVENT_TYPES } from '../../src/remediation/session-events.js'

/**
 * Rebuild one of the maintenance capability's refusals.
 *
 * The classes themselves are declared by the pinned package's types but absent
 * from its shipped JavaScript, which is why the service matches their `name`
 * rather than importing them; the stub reproduces exactly that surface.
 */
function maintenanceRefusal(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

interface StubSession {
  readonly id: string
  /** Header-only format classification the snapshot reports. */
  formatStatus?: 'current' | 'migration-required'
  /** Every record including the header, as stored text. */
  records: string[]
  /** Thrown by `open` instead of running the contract check. */
  openError?: unknown
  /** Thrown by `openArtifactMaintenance` before any rewrite. */
  maintenanceError?: unknown
  /** Optional location reported by list or snapshot. */
  location?: SessionLocation
}

/**
 * One stored session the stub can serve.
 *
 * Filler events are `zotero/status` records on purpose: the contract checks
 * shapes only for surface event types, so a stub event needs no message body to
 * reach the vocabulary rule this capability is about.
 */
function session(
  id: string,
  events: readonly Record<string, unknown>[],
  options: Partial<StubSession> = {},
): StubSession {
  const header = JSON.stringify({
    id,
    version: 4,
    createdAt: 1,
    isSeeded: false,
    delegationDepth: 0,
  })
  const records = events.map((event, seq) =>
    JSON.stringify({ seq, time: 1 + seq, data: {}, ...event }),
  )
  return { id, records: [header, ...records], ...options }
}

/** Run the harness's own validation over a stub session's records. */
function assertReadable(target: StubSession): void {
  const header = JSON.parse(target.records[0] as string) as SessionHeader
  const events = target.records.slice(1).map((record) => JSON.parse(record) as SessionEvent)
  validateStoredEvents(header, events)
}

class StubPersistence extends Service {
  readonly sessions = new Map<string, StubSession>()
  listError: unknown
  maintenanceOpened: string[] = []
  closed = 0

  openArtifactMaintenance: ((id: string) => Promise<never>) | undefined = async (id: string) => {
    const stored = this.sessions.get(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(SessionId(id))
    this.maintenanceOpened.push(id)
    if (stored.maintenanceError !== undefined) throw stored.maintenanceError
    return {
      path: `/stub/${id}`,
      compression: 'zstd',
      rewriteRecords: async () => {
        throw new Error('rewriteRecords is not used by the plugin')
      },
      markEventTypesIgnorable: async (types: readonly string[]) => {
        const wanted = new Set(types)
        let changedRecords = 0
        const next = stored.records.map((record, index) => {
          if (index === 0) return record
          const parsed = JSON.parse(record) as { type: string; ignorable?: boolean }
          if (!wanted.has(parsed.type) || parsed.ignorable === true) return record
          changedRecords += 1
          return JSON.stringify({ ...parsed, ignorable: true })
        })
        if (changedRecords > 0) {
          try {
            assertReadable({ ...stored, records: next })
          } catch {
            // The backend refuses a rewrite its own contract still rejects and
            // leaves the artifact untouched.
            throw maintenanceRefusal('SessionArtifactRewriteRefusedError')
          }
          stored.records = next
        }
        return {
          changedRecords,
          totalRecords: next.length,
          droppedTailBytes: 0,
          bytesBefore: 0,
          bytesAfter: 0,
          ...(changedRecords === 0 ? {} : { backupPath: `/stub/${id}.keep` }),
        }
      },
      close: async () => {
        this.closed += 1
      },
    } as never
  }

  constructor(parent: Context) {
    super(parent, 'sessionPersistence')
  }

  async list(): Promise<readonly never[]> {
    if (this.listError !== undefined) throw this.listError
    return [...this.sessions.values()].map(
      (stored) =>
        ({
          header: JSON.parse(stored.records[0] as string),
          formatStatus: stored.formatStatus ?? 'current',
          revision: 'revision',
          ...(stored.location ? { location: stored.location } : {}),
        }) as never,
    )
  }

  async open(id: string): Promise<never> {
    const stored = this.sessions.get(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(SessionId(id))
    if (stored.openError !== undefined) {
      const err = stored.openError
      if (err instanceof SessionFormatUnsupportedError && err.location?.path) {
        const content = readFileSync(err.location.path, 'utf8')
        const records = content.trim().split('\n')
        try {
          assertReadable({ id, records })
          stored.openError = undefined
          return { id, close: async () => {} } as never
        } catch {
          throw err
        }
      }
      throw err
    }
    if (stored.location?.path) {
      const content = readFileSync(stored.location.path, 'utf8')
      const records = content.trim().split('\n')
      try {
        assertReadable({ id, records })
      } catch (err) {
        if (err instanceof SessionFormatUnsupportedError) {
          throw new SessionFormatUnsupportedError(err.message, stored.location)
        }
        throw err
      }
      return { id, close: async () => {} } as never
    }
    assertReadable(stored)
    return { id, close: async () => {} } as never
  }
}

/** Compose the stub on a bare context and hand back the service under test. */
async function compose(): Promise<{ service: ZoteroRemediationService; stub: StubPersistence }> {
  const ctx = new Context()
  await ctx.plugin(StubPersistence)
  const stub = ctx.get('sessionPersistence') as unknown as StubPersistence
  return { service: new ZoteroRemediationService(ctx), stub }
}

describe('ZoteroRemediationService.inspect', () => {
  it('reports no capability when the persistence seam is absent', async () => {
    const service = new ZoteroRemediationService(new Context())

    const report = await service.inspect()

    expect(report.capability).toBe('unavailable')
    expect(report.issues).toEqual([])
    expect(report.scannedSessions).toBe(0)
  })

  it('reports a repairable vocabulary refusal for a log the contract rejects', async () => {
    const { service, stub } = await compose()
    stub.sessions.set('broken', session('broken', [{ type: 'zotero/status' }]))

    const report = await service.inspect()

    expect(report.capability).toBe('available')
    expect(report.scannedSessions).toBe(1)
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      id: 'session-log:broken',
      category: 'session-log',
      severity: 'critical',
      reason: 'unknown-event-vocabulary',
      sessionId: 'broken',
      eventTypes: [...RETIRED_SESSION_EVENT_TYPES],
    })
  })

  it('reports a format-version refusal as not repairable', async () => {
    const { service, stub } = await compose()
    stub.sessions.set(
      'newer',
      session('newer', [], {
        formatStatus: 'migration-required',
        openError: new SessionFormatUnsupportedError('written by a newer format'),
      }),
    )

    const report = await service.inspect()

    expect(report.issues[0]).toMatchObject({
      reason: 'format-version-unsupported',
      severity: 'critical',
      eventTypes: [],
    })
  })

  it('reports corruption separately from a format refusal', async () => {
    const { service, stub } = await compose()
    stub.sessions.set(
      'corrupt',
      session('corrupt', [], {
        openError: new SessionPersistenceCorruptionError('records failed validation', {
          cause: new Error('seq 3 is missing'),
        }),
      }),
    )

    const report = await service.inspect()

    expect(report.issues[0]).toMatchObject({ reason: 'artifact-corrupt', severity: 'critical' })
  })

  it('reports an unclassified read failure as a warning, never as healthy', async () => {
    const { service, stub } = await compose()
    stub.sessions.set('locked', session('locked', [], { openError: new Error('EACCES') }))

    const report = await service.inspect()

    expect(report.issues[0]).toMatchObject({ reason: 'open-failed', severity: 'warning' })
  })

  it('propagates a listing failure instead of reporting zero sessions', async () => {
    const { service, stub } = await compose()
    stub.listError = new Error('store unavailable')

    await expect(service.inspect()).rejects.toThrow('store unavailable')
  })
})

describe('ZoteroRemediationService.execute', () => {
  let service: ZoteroRemediationService
  let stub: StubPersistence

  beforeEach(async () => {
    ;({ service, stub } = await compose())
    stub.sessions.set('broken', session('broken', [{ type: 'zotero/status' }]))
  })

  it('repairs through the maintenance capability and reports what it measured', async () => {
    const result = await service.execute({ issueIds: ['session-log:broken'] })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      issueId: 'session-log:broken',
      outcome: 'repaired',
      changedRecords: 1,
      totalRecords: 2,
      droppedTailBytes: 0,
      backupPath: '/stub/broken.keep',
    })
    expect(stub.maintenanceOpened).toEqual(['broken'])
    expect(stub.closed).toBe(1)
    expect(() => assertReadable(stub.sessions.get('broken') as StubSession)).not.toThrow()
  })

  it('reports unchanged when the rewrite changed nothing', async () => {
    stub.sessions.set(
      'mystery',
      session('mystery', [], {
        openError: new SessionFormatUnsupportedError('unknown event type'),
      }),
    )

    const result = await service.execute({ issueIds: ['session-log:mystery'] })

    expect(result.items[0]).toMatchObject({ outcome: 'unchanged', changedRecords: 0 })
    expect(stub.closed).toBe(1)
  })

  it('reports unchanged when the log is already readable', async () => {
    stub.sessions.set('fine', session('fine', [{ type: 'zotero/status', ignorable: true }]))

    const result = await service.execute({ issueIds: ['session-log:fine'] })

    expect(result.items[0]).toEqual({ issueId: 'session-log:fine', outcome: 'unchanged' })
    expect(stub.maintenanceOpened).toEqual([])
  })

  it('refuses a log whose other unknown types would survive the rewrite', async () => {
    stub.sessions.set(
      'mixed',
      session('mixed', [{ type: 'zotero/status' }, { type: 'other/plugin' }]),
    )

    const result = await service.execute({ issueIds: ['session-log:mixed'] })

    expect(result.items[0]).toMatchObject({ outcome: 'refused' })
  })

  it('reports busy when a live writer holds the write exclusion', async () => {
    stub.sessions.set(
      'open-elsewhere',
      session('open-elsewhere', [{ type: 'zotero/status' }], {
        maintenanceError: new SessionAlreadyOwnedError(SessionId('open-elsewhere')),
      }),
    )

    const result = await service.execute({ issueIds: ['session-log:open-elsewhere'] })

    expect(result.items[0]).toMatchObject({ outcome: 'busy' })
    expect(stub.closed).toBe(0)
  })

  it('reports unsupported when the backend exposes no maintenance', async () => {
    stub.sessions.set(
      'memory',
      session('memory', [{ type: 'zotero/status' }], {
        maintenanceError: maintenanceRefusal('SessionArtifactMaintenanceUnsupportedError'),
      }),
    )

    const result = await service.execute({ issueIds: ['session-log:memory'] })

    expect(result.items[0]).toMatchObject({ outcome: 'unsupported' })
  })

  it('reports failed when the log still cannot be read after the rewrite', async () => {
    stub.sessions.set(
      'still-bad',
      session('still-bad', [{ type: 'zotero/status' }], {
        openError: new SessionFormatUnsupportedError('unknown event type'),
      }),
    )

    const result = await service.execute({ issueIds: ['session-log:still-bad'] })

    expect(result.items[0]).toMatchObject({
      outcome: 'failed',
      changedRecords: 1,
      backupPath: '/stub/still-bad.keep',
    })
  })

  it('never opens maintenance for a log that does not qualify', async () => {
    stub.sessions.set(
      'newer',
      session('newer', [], {
        formatStatus: 'migration-required',
        openError: new SessionFormatUnsupportedError('written by a newer format'),
      }),
    )

    const result = await service.execute({ issueIds: ['session-log:newer'] })

    expect(result.items[0]).toMatchObject({ outcome: 'refused' })
    expect(stub.maintenanceOpened).toEqual([])
  })

  it('returns one item per requested id, in request order', async () => {
    const result = await service.execute({
      issueIds: ['session-log:broken', 'not-an-issue', 'session-log:absent'],
    })

    expect(result.items.map((item) => item.issueId)).toEqual([
      'session-log:broken',
      'not-an-issue',
      'session-log:absent',
    ])
    expect(result.items.map((item) => item.outcome)).toEqual(['repaired', 'failed', 'failed'])
  })

  it('reports unsupported for every id when the seam is absent', async () => {
    const bare = new ZoteroRemediationService(new Context())

    const result = await bare.execute({ issueIds: ['session-log:a', 'session-log:b'] })

    expect(result.items).toEqual([
      { issueId: 'session-log:a', outcome: 'unsupported' },
      { issueId: 'session-log:b', outcome: 'unsupported' },
    ])
  })

  it('falls back to direct artifact repair when openArtifactMaintenance is not exported', async () => {
    stub.openArtifactMaintenance = undefined
    const tempFile = join(tmpdir(), `remediation-fallback-test-${Date.now()}.jsonl`)
    const brokenSession = session('fallback', [{ type: 'zotero/status' }])
    writeFileSync(tempFile, `${brokenSession.records.join('\n')}\n`, 'utf8')
    stub.sessions.set('fallback', {
      ...brokenSession,
      location: { kind: 'jsonl', path: tempFile },
    })

    try {
      const result = await service.execute({ issueIds: ['session-log:fallback'] })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        issueId: 'session-log:fallback',
        outcome: 'repaired',
        changedRecords: 1,
        totalRecords: 2,
      })
      expect(result.items[0]?.backupPath).toBeDefined()

      const updated = readFileSync(tempFile, 'utf8')
      expect(updated).toContain('"ignorable":true')
      await expect(stub.open('fallback')).resolves.toBeDefined()
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // ignore missing file during cleanup
      }
      const dir = tmpdir()
      for (const file of readdirSync(dir)) {
        if (file.startsWith('remediation-fallback-test-')) {
          try {
            unlinkSync(join(dir, file))
          } catch {
            // ignore cleanup failure
          }
        }
      }
    }
  })

  it('learns the artifact location from open format error when snapshot has no location', async () => {
    stub.openArtifactMaintenance = undefined
    const tempFile = join(tmpdir(), `remediation-errloc-test-${Date.now()}.jsonl`)
    const brokenSession = session('from-err', [{ type: 'zotero/status' }])
    writeFileSync(tempFile, `${brokenSession.records.join('\n')}\n`, 'utf8')
    stub.sessions.set('from-err', {
      ...brokenSession,
      openError: new SessionFormatUnsupportedError('unknown event type', {
        kind: 'jsonl',
        path: tempFile,
      }),
    })

    try {
      const result = await service.execute({ issueIds: ['session-log:from-err'] })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        issueId: 'session-log:from-err',
        outcome: 'repaired',
        changedRecords: 1,
      })
      const updated = readFileSync(tempFile, 'utf8')
      expect(updated).toContain('"ignorable":true')
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // ignore missing file during cleanup
      }
      const dir = tmpdir()
      for (const file of readdirSync(dir)) {
        if (file.startsWith('remediation-errloc-test-')) {
          try {
            unlinkSync(join(dir, file))
          } catch {
            // ignore cleanup failure
          }
        }
      }
    }
  })
})
