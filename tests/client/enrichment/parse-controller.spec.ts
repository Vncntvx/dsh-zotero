/** Module behaviours for admission, observation lifetime and the retry protocol. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { typedRemoteResult } from '../../../src/client/enrichment/parse-controller.ts'
import { deferred } from '../../helpers/sync.ts'
import {
  PARSE_JOB,
  PARSE_OPERATION,
  PARSE_SELECTION,
  PARSE_SESSION,
  parseCapabilities,
  parseHarness,
  parseJob,
  parseReceipt,
  parseRemote,
} from './support/parse-ports.ts'
import type { ZoteroStartDocumentParseResultView } from '../../../src/contract.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

const harnesses: ReturnType<typeof parseHarness>[] = []
function harness(options: Parameters<typeof parseHarness>[0] = {}) {
  const world = parseHarness(options)
  harnesses.push(world)
  return world
}
afterEach(() => {
  for (const world of harnesses.splice(0)) world.dispose()
})

describe('document parse admission', () => {
  it('opens and inspects an attachment without starting parsing', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(remote.documentArtifact).toHaveBeenCalledWith(
      { sessionId: PARSE_SESSION, target: PARSE_SELECTION.target },
      expect.any(AbortSignal),
    )
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
    expect(world.controller.getSnapshot().artifact).toEqual({ kind: 'missing' })
  })

  it('starts exactly once with a UUID after an explicit submit', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await Promise.all([world.controller.submit(), world.controller.submit()])
    expect(remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(remote.startDocumentParse).toHaveBeenCalledWith({
      sessionId: PARSE_SESSION,
      target: PARSE_SELECTION.target,
      action: 'parse',
      operationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    })
    expect(world.jobs.observe).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
  })

  it('still reads artifacts without submitting when the session cannot start a parse', async () => {
    const remote = parseRemote()
    const world = harness({ remote, capabilities: { startAllowed: false } })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    expect(world.controller.getSnapshot().gate).toBe('permission')
    expect(remote.documentArtifact).toHaveBeenCalledTimes(1)
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
  })

  it('keeps RemoteError code, details and identity through pure unwrapping', () => {
    const error = new RemoteError('gateway/service-unavailable', 'component absent', {
      endpoint: 'zotero/documentArtifact',
    })
    expect(() => typedRemoteResult({ ok: false, error })).toThrow(error)
    const details = { endpoint: 'zotero/documentArtifact' }
    expect(error.details).toEqual(details)
  })
})

describe('document parse observation lifetime', () => {
  it('releases observers when closing without killing the accepted job', async () => {
    const world = harness()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    world.controller.close()
    expect(world.stopRows).toHaveBeenCalledTimes(1)
    expect(world.stopObservation).toHaveBeenCalledTimes(1)
    expect(world.jobs.kill).not.toHaveBeenCalled()
    expect(world.state.listenerCount()).toBe(0)
  })

  it('preserves a job admitted after closing and observes it when reopened', async () => {
    const start = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
    const remote = parseRemote({ startDocumentParse: () => start.promise })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    const submitting = world.controller.submit()
    world.controller.close()
    start.resolve({
      ok: true,
      value: {
        operationId: PARSE_OPERATION,
        generation: 'generation-1',
        jobId: PARSE_JOB,
        status: 'started',
      },
    })
    await submitting
    expect(world.jobs.observe).not.toHaveBeenCalled()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(world.jobs.observe).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
    expect(world.jobs.kill).not.toHaveBeenCalled()
  })

  it.each(['close', 'switch', 'dispose'] as const)(
    'publishes late admission with its original selection after %s',
    async (change) => {
      const start = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
      const onOperation = vi.fn()
      const world = harness({
        remote: parseRemote({ startDocumentParse: () => start.promise }),
        onOperation,
      })
      world.controller.open(PARSE_SELECTION)
      await world.settled()
      const submitting = world.controller.submit()
      if (change === 'close') world.controller.close()
      else if (change === 'dispose') world.controller.dispose()
      else world.controller.setTarget({ kind: 'url', url: 'https://papers.example.org/next.pdf' })
      const operation = {
        operationId: PARSE_OPERATION,
        jobId: PARSE_JOB,
        generation: 'generation-1',
      }
      start.resolve({ ok: true, value: { ...operation, status: 'started' } })
      await submitting
      expect(onOperation).toHaveBeenCalledExactlyOnceWith(operation, PARSE_SELECTION)
      expect(world.jobs.observe).not.toHaveBeenCalled()
      expect(world.jobs.kill).not.toHaveBeenCalled()
      if (change === 'switch') expect(world.controller.getSnapshot().operation).toBeUndefined()
    },
  )

  it('explicitly cancels through the jobs service and waits for real terminal state', async () => {
    const world = harness()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    world.state.publish({ rows: { [PARSE_SESSION]: [parseJob()] }, observed: {} })
    await world.controller.cancel()
    expect(world.jobs.kill).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
    expect(world.controller.getSnapshot().cancelRequested).toBe(true)
    expect(world.controller.getSnapshot().job?.status).toBe('running')
  })

  it('reads the bounded receipt when the roster reports a terminal job', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    remote.documentParseReceipt.mockResolvedValue({
      ok: true,
      value: { kind: 'completed', receipt: parseReceipt() },
    })
    world.state.publish({
      rows: {
        [PARSE_SESSION]: [parseJob({ status: 'completed', progress: undefined, finishedAt: 2 })],
      },
      observed: {},
    })
    await world.settled()
    expect(world.controller.getSnapshot().receipt).toEqual({
      kind: 'completed',
      receipt: parseReceipt(),
    })
    expect(remote.documentParseReceipt).toHaveBeenCalledTimes(2)
  })

  it('reconnects to the existing operation without restarting it', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, jobId: PARSE_JOB },
    })
    await world.settled()
    world.capability.publish(parseCapabilities({ connected: false }))
    expect(world.stopObservation).toHaveBeenCalledTimes(1)
    world.capability.publish(parseCapabilities({ connected: true }))
    await world.settled()
    expect(world.jobs.observe).toHaveBeenCalledTimes(2)
    expect(remote.documentParseReceipt).toHaveBeenCalledTimes(2)
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
  })

  it('accepts connect cleanup and effect replay without losing future observations', async () => {
    const world = harness()
    const stop = world.controller.connect()
    stop()
    world.controller.connect()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    expect(world.jobs.observe).toHaveBeenCalledTimes(1)
    world.dispose()
    world.dispose()
    expect(world.capability.listenerCount()).toBe(0)
    expect(world.jobs.kill).not.toHaveBeenCalled()
  })
})

describe('document parse retry protocol', () => {
  it('persists the intent before RPC and recovers ambiguous admission with receipt only after remount', async () => {
    const onOperationIntent = vi.fn()
    const onOperation = vi.fn()
    const remote = parseRemote({
      startDocumentParse: async (request) => {
        expect(onOperationIntent).toHaveBeenCalledExactlyOnceWith(
          { operationId: request.operationId },
          PARSE_SELECTION,
        )
        throw new Error('Connection lost after send')
      },
    })
    const first = harness({ remote, onOperationIntent, onOperation })
    first.controller.open(PARSE_SELECTION)
    await first.settled()
    await first.controller.submit()
    const operation = first.controller.getSnapshot().operation!
    expect(onOperation).not.toHaveBeenCalled()
    first.dispose()
    const second = harness({ remote })
    second.controller.open({ ...PARSE_SELECTION, operation })
    await second.settled()
    expect(remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(remote.documentParseReceipt).toHaveBeenCalledWith(
      { sessionId: PARSE_SESSION, operationId: operation.operationId },
      expect.any(AbortSignal),
    )
    expect(second.jobs.observe).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
  })
  it('does not retry or start again when initial admission failed without a terminal receipt', async () => {
    const remote = parseRemote({
      startDocumentParse: async () => {
        throw new Error('Connection lost after send')
      },
    })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    await world.controller.submit('retry')
    await world.controller.submit('parse')
    expect(remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(world.controller.getSnapshot().failure?.message).toBe('Connection lost after send')
  })
  it('reuses the failed operation ID for explicit retry and keeps its generation', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, jobId: PARSE_JOB, generation: 'generation-1' },
    })
    remote.documentParseReceipt.mockResolvedValue({
      ok: true,
      value: { kind: 'failed', code: 'ZOTERO_ENRICHMENT_PARSE_FAILED', message: 'Parsing failed' },
    })
    await world.controller.refresh()
    await world.controller.submit('retry')
    expect(remote.startDocumentParse).toHaveBeenCalledWith({
      sessionId: PARSE_SESSION,
      target: PARSE_SELECTION.target,
      action: 'retry',
      operationId: PARSE_OPERATION,
    })
    expect(world.controller.getSnapshot().operation?.generation).toBe('generation-1')
  })

  it('creates a new operation UUID for reparse after an existing artifact', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, jobId: PARSE_JOB },
    })
    remote.documentParseReceipt.mockResolvedValue({
      ok: true,
      value: { kind: 'completed', receipt: parseReceipt() },
    })
    await world.controller.refresh()
    await world.controller.submit('reparse')
    expect(remote.startDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reparse',
        operationId: expect.not.stringMatching(PARSE_OPERATION),
      }),
    )
  })
})
