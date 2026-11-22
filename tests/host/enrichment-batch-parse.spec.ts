/** Real session-owned jobs, with a controlled MinerU execution port. */
import { randomUUID } from 'node:crypto'
import { JobError, JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { MineruHttpError } from '../../src/enrichment/transport.ts'
import {
  ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
  ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_JOBS_LIMIT_REACHED,
  ZoteroError,
} from '../../src/errors.ts'
import { attachmentRef } from '../helpers/server/keys.ts'
import { deferred } from '../helpers/sync.ts'
import {
  parseJobsFixture,
  parsedResult,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.ts'

const session = 'parse-owner'
const targets = [
  { ref: attachmentRef('ATTACH01'), title: 'First PDF' },
  { ref: attachmentRef('ATTACH02'), title: 'Second PDF' },
  { ref: attachmentRef('ATTACH03'), title: 'Third PDF' },
]
let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})

it('keeps one PDF in flight, replays the batch admission, and accounts for partial failures', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const executed: string[] = []
  const world = (fixture = await parseJobsFixture({
    execute: async (request) => {
      executed.push(request.input.key)
      if (executed.length === 1) {
        entered.resolve()
        await release.promise
        return { ...parsedResult(request), cached: true }
      }
      if (executed.length === 2) throw new Error('The PDF failed to parse.')
      return parsedResult(request)
    },
  }))
  const operationId = randomUUID()
  const admission = () =>
    world.helper.startBatchParse(
      session,
      operationId,
      'binding',
      () => targets,
      parseSignal(),
      world.ctx,
    )
  try {
    expect(await admission()).toMatchObject({ state: 'running', total: 3 })
    await entered.promise
    expect(await admission()).toMatchObject({ operationId, state: 'running' })
    const changedSelection = vi.fn(() => targets.slice(1))
    for (const id of [operationId, randomUUID()]) {
      await expect(
        world.helper.startBatchParse(
          session,
          id,
          'changed',
          changedSelection,
          parseSignal(),
          world.ctx,
        ),
      ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT })
    }
    expect(changedSelection).not.toHaveBeenCalled()
    expect(executed).toEqual([targets[0]!.ref])
  } finally {
    release.resolve()
  }
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'completed',
      total: 3,
      reused: 1,
      parsed: 1,
      failed: 1,
      skipped: 0,
      failures: [{ target: targets[1], message: 'The PDF failed to parse.' }],
    }),
  )
  expect(executed).toEqual(targets.map(({ ref }) => ref))
})

it('cancels the active PDF and does not admit any later PDF', async () => {
  const entered = deferred<void>()
  const execute = vi.fn<ParseJobsFixture['deps']['execute']>(async (request) => {
    const cancelled = new Promise<never>((_, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
    })
    entered.resolve()
    return await cancelled
  })
  const world = (fixture = await parseJobsFixture({ execute }))
  const operationId = randomUUID()
  await world.helper.startBatchParse(
    session,
    operationId,
    'binding',
    () => targets,
    parseSignal(),
    world.ctx,
  )
  await entered.promise
  expect(world.helper.cancelBatchParse(session, operationId, world.ctx).state).toBe('stopping')
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'cancelled',
      skipped: 3,
      parsed: 0,
      failed: 0,
    }),
  )
  expect(execute).toHaveBeenCalledTimes(1)
})

it.each([401, 403, 429])('stops dispatching PDFs on a wrapped MinerU HTTP %s', async (status) => {
  const cause = new MineruHttpError(status, 'mineru.net', 'Request rejected')
  const execute = vi.fn<ParseJobsFixture['deps']['execute']>(async () => {
    const wrapped = new Error(cause.message, { cause })
    throw new ZoteroError(cause.message, ZOTERO_ENRICHMENT_TASK_FAILED, { cause: wrapped })
  })
  const world = (fixture = await parseJobsFixture({ execute }))
  await world.helper.startBatchParse(
    session,
    randomUUID(),
    'binding',
    () => targets,
    parseSignal(),
    world.ctx,
  )
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'failed',
      skipped: 2,
      failed: 1,
      error: cause.message,
    }),
  )
  expect(execute).toHaveBeenCalledTimes(1)
})

it('continues the batch after a signed upload host rejects one PDF', async () => {
  const execute = vi.fn<ParseJobsFixture['deps']['execute']>(async (request) => {
    if (request.input.key === targets[0]!.ref)
      throw new Error('Upload rejected', { cause: new MineruHttpError(403, 'upload.example.com') })
    return parsedResult(request)
  })
  const world = (fixture = await parseJobsFixture({ execute }))
  await world.helper.startBatchParse(
    session,
    randomUUID(),
    'binding',
    () => targets,
    parseSignal(),
    world.ctx,
  )
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'completed',
      failed: 1,
      parsed: 2,
      skipped: 0,
    }),
  )
})

it('joins a duplicate rebuild and publishes cancelled status for its owner', async () => {
  const world = (fixture = await parseJobsFixture())
  const entered = deferred<void>()
  const rebuild = async (signal: AbortSignal) => {
    const stopped = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    entered.resolve()
    await stopped
  }
  const start = (root: string) =>
    world.helper.startIndexRebuild(session, root, rebuild, parseSignal(), world.ctx)
  const { jobId } = await start('current-root')
  await entered.promise
  await expect(start('current-root')).resolves.toEqual({ jobId })
  await expect(start('other-root')).rejects.toThrow('already running')
  expect(world.helper.indexRebuildStatus(session, 'other-root')).toBeUndefined()
  expect(world.ctx.jobs.kill(JobId(jobId), SessionId(session))).toBe('requested')
  await expect(world.ctx.jobs.wait(JobId(jobId), 5000, SessionId(session))).resolves.toMatchObject({
    status: 'killed',
  })
  expect(world.helper.indexRebuildStatus(session, 'current-root')).toEqual({
    jobId,
    state: 'cancelled',
  })
})

it('stops before admitting the next PDF when the session grant is revoked', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const execute = vi.fn<ParseJobsFixture['deps']['execute']>(async (request) => {
    entered.resolve()
    await release.promise
    return parsedResult(request)
  })
  const world = (fixture = await parseJobsFixture({ execute }))
  world.grant(session, ['zotero/startBatchParse'])
  try {
    await world.helper.startBatchParse(
      session,
      randomUUID(),
      'binding',
      () => targets,
      parseSignal(),
      world.guestContext('startBatchParse'),
    )
    await entered.promise
    world.revoke()
  } finally {
    release.resolve()
  }
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'failed',
      parsed: 1,
      skipped: 2,
      error: 'Document parsing is not authorized for this session.',
    }),
  )
  expect(execute).toHaveBeenCalledTimes(1)
})

it('cancels and forgets the batch when the owning Agent is disposed', async () => {
  const entered = deferred<void>()
  const cancelled = deferred<void>()
  const execute = vi.fn<ParseJobsFixture['deps']['execute']>(async (request) => {
    const task = new Promise<never>((_, reject) => {
      request.signal.addEventListener(
        'abort',
        () => {
          cancelled.resolve()
          reject(request.signal.reason)
        },
        { once: true },
      )
    })
    entered.resolve()
    return await task
  })
  const world = (fixture = await parseJobsFixture({ execute }))
  await world.helper.startBatchParse(
    session,
    randomUUID(),
    'binding',
    () => targets,
    parseSignal(),
    world.ctx,
  )
  await entered.promise
  world.ctx.emit('agent/disposed', { agent: world.owners[0]!.agent })
  await cancelled.promise
  expect(world.helper.batchParseStatus(session, 0, world.ctx)).toBeNull()
  expect(execute).toHaveBeenCalledTimes(1)
})

it('reports registry failures at rebuild admission without invoking the index', async () => {
  const world = (fixture = await parseJobsFixture())
  const rebuild = vi.fn(async () => {})
  const start = vi.spyOn(world.ctx.jobs, 'start')
  start
    .mockImplementationOnce(() => {
      throw new JobError('Job limit reached', 'JOB_LIMIT_REACHED')
    })
    .mockImplementationOnce(() => {
      throw new Error('Registry unavailable')
    })
  const admit = () =>
    world.helper.startIndexRebuild(session, 'current-root', rebuild, parseSignal(), world.ctx)
  await expect(admit()).rejects.toMatchObject({ code: ZOTERO_JOBS_LIMIT_REACHED })
  await expect(admit()).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE })
  expect(rebuild).not.toHaveBeenCalled()
  expect(world.helper.indexRebuildStatus(session, 'current-root')).toBeUndefined()
})

it('reports a batch admission failure for the current PDF and skips the rest', async () => {
  const world = (fixture = await parseJobsFixture({}, { controller: false }))
  await world.helper.startBatchParse(
    session,
    randomUUID(),
    'binding',
    () => targets,
    parseSignal(),
    world.ctx,
  )
  await vi.waitFor(() =>
    expect(world.helper.batchParseStatus(session, 0, world.ctx)).toMatchObject({
      state: 'failed',
      failed: 1,
      skipped: 2,
      failures: [{ target: targets[0], code: ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE }],
    }),
  )
  expect(world.execute).not.toHaveBeenCalled()
})

it('retires a staging index job when the owning Agent is disposed', async () => {
  const world = (fixture = await parseJobsFixture())
  const entered = deferred<void>()
  const { jobId } = await world.helper.startIndexRebuild(
    session,
    'current-root',
    async (signal) => {
      const task = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      entered.resolve()
      await task
    },
    parseSignal(),
    world.ctx,
  )
  await entered.promise
  world.ctx.emit('agent/disposed', { agent: world.owners[0]!.agent })
  await expect(world.ctx.jobs.wait(JobId(jobId), 5000, SessionId(session))).resolves.toMatchObject({
    status: 'killed',
  })
  expect(world.helper.indexRebuildStatus(session, 'current-root')).toBeUndefined()
})
