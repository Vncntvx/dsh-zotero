/** Shared generations retain independent real jobs and wait through actual cleanup. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PARSE_CANCELLED_MESSAGE } from '../../src/enrichment/parse-jobs.js'
import type { ParseJobExecution } from '../../src/enrichment/parse-jobs.js'
import {
  ZoteroError,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_PROVIDER_UNAVAILABLE,
} from '../../src/errors.js'
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

describe('explicit parsing shared-job lifetime', () => {
  it('cancels one session waiter without aborting the other job sharing its generation', async () => {
    const entered = deferred<ParseJobExecution>()
    const result = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        entered.resolve(request)
        await result.promise
        return parsedResult(request)
      },
    })
    const first = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    const execution = await entered.promise
    const second = await fixture.helper.startDocumentParse(parseRequest(other), parseSignal())
    expect(second.generation).toBe(first.generation)
    expect(second.jobId).not.toBe(first.jobId)
    expect(fixture.ctx.jobs.kill(JobId(first.jobId), owner)).toBe('requested')
    expect(fixture.ctx.jobs.kill(JobId(first.jobId), owner)).toBe('requested')
    expect((await settle(fixture, first.jobId)).status).toBe('killed')
    expect(execution.signal.aborted).toBe(false)
    result.resolve()
    expect((await settle(fixture, second.jobId, other)).status).toBe('completed')
  })

  it('aborts the last waiter synchronously but settles the job only after deferred cleanup', async () => {
    const entered = deferred<ParseJobExecution>()
    const aborted = deferred<void>()
    const cleanup = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        entered.resolve(request)
        await new Promise<void>((resolve) =>
          request.signal.addEventListener(
            'abort',
            () => {
              aborted.resolve()
              resolve()
            },
            { once: true },
          ),
        )
        await cleanup.promise
        request.signal.throwIfAborted()
        return parsedResult(request)
      },
    })
    const started = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    const execution = await entered.promise
    fixture.ctx.jobs.kill(JobId(started.jobId), owner)
    expect(execution.signal.aborted).toBe(true)
    await aborted.promise
    expect(fixture.ctx.jobs.get(JobId(started.jobId), owner).status).toBe('stopping')
    cleanup.resolve()
    expect((await settle(fixture, started.jobId)).status).toBe('killed')
  })

  it('keeps a late successful publication completed when cancellation races the source pointer commit', async () => {
    const entered = deferred<void>()
    const commit = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        entered.resolve()
        await commit.promise
        return parsedResult(request)
      },
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await entered.promise
    fixture.ctx.jobs.kill(JobId(started.jobId), owner)
    expect(fixture.ctx.jobs.get(JobId(started.jobId), owner).status).toBe('stopping')
    commit.resolve()
    expect((await settle(fixture, started.jobId)).status).toBe('completed')
    expect(
      await fixture.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'completed' })
  })

  it('releases an observer without cancelling the job or creating a second submission', async () => {
    const result = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        await result.promise
        return parsedResult(request)
      },
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    const detach = fixture.ctx.jobs.events.subscribe({ owner }, () => {})
    detach()
    const replay = await fixture.helper.startDocumentParse(request, parseSignal())
    expect(replay.jobId).toBe(started.jobId)
    expect(fixture.ctx.jobs.get(JobId(started.jobId), owner).status).toBe('running')
    result.resolve()
    expect((await settle(fixture, started.jobId)).status).toBe('completed')
  })

  it('lets owner scope teardown cancel its job and wait for source cleanup', async () => {
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const cleanup = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        const { signal } = request
        entered.resolve()
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted.resolve()
              resolve()
            },
            { once: true },
          ),
        )
        await cleanup.promise
        signal.throwIfAborted()
        return parsedResult(request)
      },
    })
    const request = parseRequest()
    await fixture.helper.startDocumentParse(request, parseSignal())
    await entered.promise
    let disposed = false
    const teardown = fixture.owners[0]!.dispose().then(() => {
      disposed = true
    })
    await aborted.promise
    expect(disposed).toBe(false)
    cleanup.resolve()
    await teardown
    expect(
      await fixture.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'cancelled', message: PARSE_CANCELLED_MESSAGE })
  })

  it('serializes reparse generations while preserving one job per explicit operation', async () => {
    const firstEntered = deferred<ParseJobExecution>()
    const firstResult = deferred<void>()
    const secondEntered = deferred<ParseJobExecution>()
    let calls = 0
    fixture = await parseJobsFixture({
      execute: async (request) => {
        calls += 1
        if (calls === 1) {
          firstEntered.resolve(request)
          await firstResult.promise
        } else secondEntered.resolve(request)
        return parsedResult(request)
      },
    })
    const first = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    await firstEntered.promise
    const second = await fixture.helper.startDocumentParse(
      parseRequest(undefined, { action: 'reparse' }),
      parseSignal(),
    )
    expect(second.generation).not.toBe(first.generation)
    expect(calls).toBe(1)
    firstResult.resolve()
    const next = await secondEntered.promise
    expect(next.generation).toBe(second.generation)
    expect((await settle(fixture, first.jobId)).status).toBe('completed')
    expect((await settle(fixture, second.jobId)).status).toBe('completed')
  })

  it('only explicit retry restarts a failed operation and keeps its generation despite semantic settings changes', async () => {
    let calls = 0
    fixture = await parseJobsFixture({
      execute: async (request) => {
        calls += 1
        if (calls === 1) throw new ZoteroError('provider failed', ZOTERO_ENRICHMENT_TASK_FAILED)
        return parsedResult(request)
      },
    })
    const request = parseRequest()
    const first = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await settle(fixture, first.jobId)).status).toBe('failed')
    const replay = await fixture.helper.startDocumentParse(request, parseSignal())
    expect(replay.jobId).toBe(first.jobId)
    expect(calls).toBe(1)
    fixture.config.value = {
      ...fixture.config.value,
      enableSemanticSearch: true,
      semanticModel: 'balanced',
    }
    const retry = await fixture.helper.startDocumentParse(
      { ...request, action: 'retry' },
      parseSignal(),
    )
    expect(retry.jobId).not.toBe(first.jobId)
    expect(retry.generation).toBe(first.generation)
    expect((await settle(fixture, retry.jobId)).status).toBe('completed')
    expect(calls).toBe(2)
  })

  it('component disposal closes admission and waits for jobs blocked in receipt persistence', async () => {
    fixture = await parseJobsFixture()
    const entered = deferred<void>()
    const persist = deferred<void>()
    const original = fixture.persistence.put.bind(fixture.persistence)
    vi.spyOn(fixture.persistence, 'put').mockImplementation(async (config, record) => {
      if (record.state.kind === 'pending') {
        entered.resolve()
        await persist.promise
      }
      await original(config, record)
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await entered.promise
    let disposed = false
    const teardown = fixture.helper.dispose().then(() => {
      disposed = true
    })
    expect(fixture.ctx.jobs.get(JobId(started.jobId), owner).status).toBe('stopping')
    expect(disposed).toBe(false)
    await expect(
      fixture.helper.startDocumentParse(parseRequest(), parseSignal()),
    ).rejects.toMatchObject({ code: ZOTERO_PROVIDER_UNAVAILABLE })
    persist.resolve()
    await teardown
    expect(fixture.execute).not.toHaveBeenCalled()
    expect((await settle(fixture, started.jobId)).status).toBe('killed')
  })
})
