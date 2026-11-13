/** A panel-started parse settles as already delivered, so no agent turn is woken. */
import { JobId, type JobEvent } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PARSE_NOTICE_WAIT_MS } from '../../src/enrichment/parse-jobs.js'
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
  vi.useRealTimers()
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})
const owner = SessionId('parse-owner')
type Settled = Extract<JobEvent, { type: 'settled' }>

function nextSettlement(host: ParseJobsFixture): {
  settled: Promise<Settled>
  unsubscribe: () => void
} {
  const settled = deferred<Settled>()
  const unsubscribe = host.ctx.jobs.events.subscribe({ owner }, (event) => {
    if (event.type === 'settled') settled.resolve(event)
  })
  return { settled: settled.promise, unsubscribe }
}

describe('explicit parsing completion notice', () => {
  it('reports a completed settlement as already delivered and keeps the settled record', async () => {
    fixture = await parseJobsFixture()
    const { settled, unsubscribe } = nextSettlement(fixture)
    const started = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    const event = await settled
    unsubscribe()
    expect(event.job.id).toBe(started.jobId)
    // The harness completion reporter skips an awaited settlement; this is what
    // keeps a panel parse from waking the agent with an unusable receipt.
    expect(event.awaited).toBe(true)
    // The panel reads the terminal row to fetch the receipt, so the waiter must
    // not remove the record.
    expect(fixture.ctx.jobs.list(owner).map((job) => job.id)).toContain(started.jobId)
  })

  it('reports a failed settlement as already delivered', async () => {
    fixture = await parseJobsFixture({
      execute: async () => {
        throw new Error('parse failed')
      },
    })
    const { settled, unsubscribe } = nextSettlement(fixture)
    await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    const event = await settled
    unsubscribe()
    expect(event.job.status).toBe('failed')
    expect(event.awaited).toBe(true)
  })

  it('reports a killed settlement as already delivered', async () => {
    const entered = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        entered.resolve()
        await new Promise<void>((_, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          }),
        )
        return parsedResult(request)
      },
    })
    const { settled, unsubscribe } = nextSettlement(fixture)
    const started = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    await entered.promise
    expect(fixture.ctx.jobs.kill(JobId(started.jobId), owner)).toBe('requested')
    const event = await settled
    unsubscribe()
    expect(event.job.status).toBe('killed')
    expect(event.awaited).toBe(true)
  })

  it('keeps a live waiter across a wait window while the job is still queued', async () => {
    vi.useFakeTimers()
    const entered = deferred<void>()
    const release = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (request) => {
        entered.resolve()
        await release.promise
        return parsedResult(request)
      },
    })
    const { settled, unsubscribe } = nextSettlement(fixture)
    const started = await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    await entered.promise
    // Outlive the first waiter; the successor armed at half its lifetime is live.
    await vi.advanceTimersByTimeAsync(PARSE_NOTICE_WAIT_MS + 1)
    release.resolve()
    const event = await settled
    unsubscribe()
    expect(event.job.id).toBe(started.jobId)
    expect(event.awaited).toBe(true)
  })

  it('stops arming waiters once the job has settled', async () => {
    vi.useFakeTimers()
    fixture = await parseJobsFixture()
    const waits = vi.spyOn(fixture.ctx.jobs, 'wait')
    const { settled, unsubscribe } = nextSettlement(fixture)
    await fixture.helper.startDocumentParse(parseRequest(), parseSignal())
    await settled
    // Released waiters clear the cadence in their own continuations.
    await Promise.resolve()
    unsubscribe()
    const calls = waits.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(PARSE_NOTICE_WAIT_MS * 3)
    expect(waits.mock.calls.length).toBe(calls)
  })
})
