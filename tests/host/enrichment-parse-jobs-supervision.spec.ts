/**
 * Parsing job supervision: admission needs live host services and a live
 * Agent, retry joins the generation it already owns, stale generations are
 * reconciled, and teardown covers owned terminal work and the retained map.
 * @module tests/host/enrichment-parse-jobs-supervision
 */
import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ZoteroError,
  ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
  ZOTERO_ENRICHMENT_TASK_FAILED,
} from '../../src/errors.js'
import { PARSE_CANCELLED_MESSAGE, type ParseJobExecution } from '../../src/enrichment/parse-jobs.js'
import { deferred } from '../helpers/sync.js'
import {
  parseJobsFixture,
  parsedResult,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.js'

let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})

const owner = SessionId('parse-owner')
const other = SessionId('parse-other')

async function settle(host: ParseJobsFixture, jobId: string, sessionId = owner) {
  return await host.ctx.jobs.wait(JobId(jobId), 5000, sessionId)
}

describe('parsing admission prerequisites', () => {
  it('reports unavailable when the invocation context has access but no job services', async () => {
    fixture = await parseJobsFixture()
    const bare = new Context()
    await bare.plugin(RemoteAccessService)
    try {
      await expect(
        fixture.helper.startDocumentParse(parseRequest(), parseSignal(), bare),
      ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE })
    } finally {
      await bare.fiber.dispose()
    }
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(owner)).toEqual([])
  })

  it('reports unavailable for a session with no live Agent', async () => {
    fixture = await parseJobsFixture()

    await expect(
      fixture.helper.startDocumentParse(parseRequest('parse-ghost'), parseSignal()),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(SessionId('parse-ghost'))).toEqual([])
  })
})

describe('parsing generation ownership', () => {
  it('retries a cancelled operation by joining the live generation it shares', async () => {
    const entered = deferred<ParseJobExecution>()
    const release = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        entered.resolve(execution)
        await release.promise
        return parsedResult(execution)
      },
    })
    const first = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    const execution = await entered.promise
    const secondRequest = parseRequest('parse-other')
    const second = await fixture.helper.startDocumentParse(secondRequest, parseSignal())
    expect(second.generation).toBe(first.generation)
    fixture.ctx.jobs.kill(JobId(second.jobId), other)
    expect((await settle(fixture, second.jobId, other)).status).toBe('killed')

    const retry = await fixture.helper.startDocumentParse(
      { ...secondRequest, action: 'retry' },
      parseSignal(),
    )
    expect(retry.generation).toBe(first.generation)
    expect(retry.jobId).not.toBe(second.jobId)
    release.resolve()
    expect(execution.signal.aborted).toBe(false)
    expect((await settle(fixture, first.jobId)).status).toBe('completed')
    expect((await settle(fixture, retry.jobId, other)).status).toBe('completed')
  })

  it('cancels a waiter whose session Agent disappears during target resolution', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    fixture = await parseJobsFixture()
    fixture.resolveAttachment.mockImplementation(async (ref) => {
      entered.resolve()
      await release.promise
      return {
        ref,
        title: 'Selected PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: '/private/zotero/attachment.pdf',
      }
    })
    const request = parseRequest(undefined, { target: fixture.attachment })
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await entered.promise
    await fixture.owners[0]!.unregister()
    release.resolve()

    expect((await settle(fixture, started.jobId)).status).toBe('killed')
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(
      await fixture.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'cancelled', message: PARSE_CANCELLED_MESSAGE })
  })

  it('reconciles a job that joins a generation its admission read had superseded', async () => {
    const pendingGate = deferred<void>()
    const pendingEntered = deferred<void>()
    const firstEntered = deferred<void>()
    const releaseFirst = deferred<void>()
    let calls = 0
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        calls += 1
        if (calls === 1) {
          firstEntered.resolve()
          await releaseFirst.promise
        }
        return parsedResult(execution)
      },
    })
    const original = fixture.persistence.put.bind(fixture.persistence)
    let gated = false
    vi.spyOn(fixture.persistence, 'put').mockImplementation(async (config, record) => {
      if (!gated && record.state.kind === 'pending') {
        gated = true
        pendingEntered.resolve()
        await pendingGate.promise
      }
      await original(config, record)
    })
    const first = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    await pendingEntered.promise
    const reparse = await fixture.helper.startDocumentParse(
      parseRequest(undefined, { action: 'reparse' }),
      parseSignal(),
    )
    expect(reparse.generation).not.toBe(first.generation)
    pendingGate.resolve()
    await firstEntered.promise

    const joined = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    expect(joined.generation).toBe(reparse.generation)
    expect(joined.jobId).not.toBe(first.jobId)

    releaseFirst.resolve()
    expect((await settle(fixture, first.jobId)).status).toBe('completed')
    expect((await settle(fixture, reparse.jobId)).status).toBe('completed')
    expect((await settle(fixture, joined.jobId)).status).toBe('completed')
    expect(calls).toBe(2)
  })

  it('keeps admitting and completing operations past the retained map bound', async () => {
    const release = deferred<void>()
    let calls = 0
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        calls += 1
        if (calls === 1) await release.promise
        return parsedResult(execution)
      },
    })
    const firstRequest = parseRequest(undefined, {
      target: { kind: 'url', url: 'https://papers.example.org/document-0.pdf' },
    })
    const first = await fixture.helper.startDocumentParse(firstRequest, parseSignal())
    const accepted: string[] = [first.jobId]
    for (let index = 1; index < 257; index += 1) {
      const request = parseRequest(undefined, {
        target: { kind: 'url', url: `https://papers.example.org/document-${index}.pdf` },
      })
      const started = await fixture.helper.startDocumentParse(request, parseSignal())
      expect((await settle(fixture, started.jobId)).status).toBe('completed')
      accepted.push(started.jobId)
    }

    release.resolve()
    expect((await settle(fixture, first.jobId)).status).toBe('completed')
    expect(calls).toBe(257)
    expect(new Set(accepted)).toHaveLength(257)
    const replay = await fixture.helper.startDocumentParse(firstRequest, parseSignal())
    expect(replay.jobId).toBe(accepted[0])
    expect(replay.status).toBe('completed')
    expect(calls).toBe(257)
  }, 180_000)
})

describe('parsing disposal ownership', () => {
  it('dispose waits for an owned operation whose failure receipt is already final', async () => {
    const entered = deferred<void>()
    const gate = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async () => {
        throw new ZoteroError('provider failed', ZOTERO_ENRICHMENT_TASK_FAILED)
      },
    })
    const original = fixture.persistence.put.bind(fixture.persistence)
    vi.spyOn(fixture.persistence, 'put').mockImplementation(async (config, record) => {
      if (record.state.kind === 'failed') {
        entered.resolve()
        await gate.promise
      }
      await original(config, record)
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await entered.promise
    let disposed = false
    const disposal = fixture.helper.dispose().then(() => {
      disposed = true
    })
    expect(disposed).toBe(false)
    gate.resolve()
    await disposal
    expect(disposed).toBe(true)
    expect((await settle(fixture, started.jobId)).status).toBe('failed')
    expect(
      await fixture
        .remount()
        .documentParseReceipt(
          { sessionId: request.sessionId, operationId: request.operationId },
          parseSignal(),
        ),
    ).toMatchObject({ kind: 'failed', code: ZOTERO_ENRICHMENT_TASK_FAILED })
  })
})
