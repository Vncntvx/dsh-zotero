/** The document parse controller's guard arms: disposal, target dedupe, and the refusal/receipt paths. */
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentParseController } from '../../../src/client/enrichment/parse-controller.ts'
import type { ZoteroDocumentParseReceiptResultView } from '../../../src/contract.ts'
import { deferred } from '../../helpers/sync.ts'
import {
  observable,
  PARSE_JOB,
  PARSE_OPERATION,
  PARSE_SELECTION,
  PARSE_SESSION,
  parseCapabilities,
  parseHarness,
  parseReceipt,
  parseRemote,
} from './support/parse-ports.ts'
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

describe('document parse controller guards', () => {
  it('ignores every entry point after disposal', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.dispose()
    const stop = world.controller.connect()
    expect(stop).toBeTypeOf('function')
    stop()
    world.controller.open(PARSE_SELECTION)
    world.controller.setTarget({ kind: 'url', url: 'https://papers.example.org/a.pdf' })
    world.controller.close()
    await world.controller.submit()
    expect(world.controller.getSnapshot()).toMatchObject({ open: false })
    expect(world.controller.getSnapshot().target).toEqual({ kind: 'url', url: '' })
    expect(remote.documentArtifact).not.toHaveBeenCalled()
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
  })

  it('publishes a capabilities change that landed before connect', () => {
    const world = harness()
    world.capability.publish(parseCapabilities({ mode: 'pro', revision: 'service-2' }))
    const stop = world.controller.connect()
    try {
      expect(world.controller.getSnapshot().capabilities).toMatchObject({
        mode: 'pro',
        revision: 'service-2',
      })
    } finally {
      stop()
    }
  })

  it('ignores a target that is already selected', async () => {
    const world = harness()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    const before = world.controller.getSnapshot()
    world.controller.setTarget({ ...PARSE_SELECTION.target })
    expect(world.controller.getSnapshot()).toBe(before)
  })

  it('re-reads the receipt when the same target is reopened under another operation', async () => {
    const remote = parseRemote({
      documentParseReceipt: async () => ({
        ok: true,
        value: { kind: 'pending', jobId: PARSE_JOB, generation: 'generation-1' },
      }),
    })
    const world = harness({ remote })
    const first = { operationId: PARSE_OPERATION, generation: 'generation-1', jobId: PARSE_JOB }
    world.controller.open({ ...PARSE_SELECTION, operation: first })
    await world.settled()
    const secondId = '7d6b1a8e-2a2f-4e64-9f0e-9d5a8f3c2b11'
    world.controller.open({ ...PARSE_SELECTION, operation: { ...first, operationId: secondId } })
    await world.settled()
    expect(remote.documentParseReceipt).toHaveBeenLastCalledWith(
      { sessionId: PARSE_SESSION, operationId: secondId },
      expect.any(AbortSignal),
    )
    expect(world.controller.getSnapshot().operation?.operationId).toBe(secondId)
  })

  it('refuses retry once the receipt is completed', async () => {
    const remote = parseRemote({
      documentParseReceipt: async () => ({
        ok: true,
        value: { kind: 'completed', receipt: parseReceipt() },
      }),
    })
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, generation: 'generation-1', jobId: PARSE_JOB },
    })
    await world.settled()
    await world.controller.submit('retry')
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
    await world.controller.submit('reparse')
    expect(remote.startDocumentParse).toHaveBeenCalledTimes(1)
  })

  it('applies only the newest receipt read', async () => {
    const first = deferred<RemoteResult<ZoteroDocumentParseReceiptResultView>>()
    const second = deferred<RemoteResult<ZoteroDocumentParseReceiptResultView>>()
    const remote = parseRemote()
    remote.documentParseReceipt
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, generation: 'generation-1', jobId: PARSE_JOB },
    })
    await Promise.resolve()
    const refresh = world.controller.refresh()
    await Promise.resolve()
    first.resolve({
      ok: true,
      value: { kind: 'failed', code: 'STALE', message: 'from the first read' },
    })
    await first.promise
    expect(world.controller.getSnapshot().receipt).toBeUndefined()
    second.resolve({
      ok: true,
      value: { kind: 'pending', jobId: PARSE_JOB, generation: 'generation-1' },
    })
    await refresh
    expect(world.controller.getSnapshot().receipt).toMatchObject({ kind: 'pending' })
  })

  it('reads without a jobs service and refuses cancellation that needs one', async () => {
    const remote = parseRemote()
    const controller = new DocumentParseController(
      remote,
      undefined,
      observable(parseCapabilities()),
    )
    try {
      controller.open(PARSE_SELECTION)
      await Promise.resolve()
      await Promise.resolve()
      expect(controller.getSnapshot().gate).toBe('not-available')
      expect(remote.documentArtifact).toHaveBeenCalledTimes(1)
      await controller.submit()
      await controller.cancel()
      expect(remote.startDocumentParse).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })

  it('surfaces a receipt read failure while the dialog is still open', async () => {
    const remote = parseRemote()
    remote.documentParseReceipt.mockRejectedValueOnce(new Error('receipt unavailable'))
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, generation: 'generation-1', jobId: PARSE_JOB },
    })
    await world.settled()
    expect(world.controller.getSnapshot().failure).toMatchObject({
      code: 'client/document-parse-failed',
      message: 'receipt unavailable',
    })
    expect(world.controller.getSnapshot().checking).toBe(false)
  })

  it('reports a cancellation the jobs service refused', async () => {
    const world = harness()
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    await world.controller.submit()
    world.jobs.kill.mockRejectedValueOnce(new Error('kill fence'))
    await world.controller.cancel()
    expect(world.controller.getSnapshot().failure).toMatchObject({ message: 'kill fence' })
    expect(world.controller.getSnapshot().cancelling).toBe(false)
    expect(world.controller.getSnapshot().cancelRequested).toBe(false)
  })

  it('reports a non-Error RPC failure by its string form', async () => {
    const remote = parseRemote()
    remote.documentArtifact.mockImplementationOnce(async () => {
      throw 'gateway blew up'
    })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(world.controller.getSnapshot().failure).toEqual({
      code: 'client/document-parse-failed',
      message: 'gateway blew up',
    })
  })
})
