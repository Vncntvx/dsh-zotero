// @vitest-environment jsdom
/**
 * Model operations are bound to one `{model, normalizedDir, generation}` target:
 * switching the target invalidates the old observation so a late reply for the
 * old directory can never publish over the new one, and a status refresh never
 * clears a transient verify/cancel phase.
 * @module tests/client/enrichment/model-generation-invalidation
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroSemanticModelStatusResultView,
  ZoteroSemanticModelVerifyRequestView,
} from '../../../src/contract.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
  COMPONENT_ABSENT_CODE,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import { deferred } from '../../helpers/sync.js'
import { fakeScope } from '../helpers/fake-scope.ts'

const controllers: EnrichmentFormController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function credentialPort(): EnrichmentCredentialPort {
  return {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
  }
}

function statusResult(overrides: Partial<ZoteroSemanticModelStatusResultView> = {}) {
  return {
    model: 'balanced',
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    ...overrides,
  }
}

function modelPortOf(overrides: Partial<EnrichmentModelPort> = {}): EnrichmentModelPort {
  return {
    semanticModelStatus: vi.fn(async () => ({ ok: true as const, value: statusResult() })),
    downloadSemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '' },
    })),
    cancelSemanticModelDownload: vi.fn(async () => ({
      ok: true as const,
      value: { cancelled: false },
    })),
    verifySemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: statusResult({ ready: true, percent: 100 }),
    })),
    ...overrides,
  }
}

function controllerOf(port: EnrichmentModelPort) {
  const scope = fakeScope()
  const controller = new EnrichmentFormController(scope, credentialPort(), port)
  controllers.push(controller)
  return { scope, controller, face: controller.inject() }
}

const stateOf = (face: ReturnType<typeof controllerOf>['face']) =>
  face.hooks.enrichmentCard.getSnapshot()

describe('model operation generation binding', () => {
  it('drops a late status reply for the old directory after switching to a new one', async () => {
    const oldReply = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf({
      semanticModelStatus: vi
        .fn()
        .mockImplementationOnce(() => oldReply.promise)
        .mockImplementation(async () => ({ ok: true as const, value: statusResult() })),
    })
    const { face } = controllerOf(port)
    // Start a status read for the default (empty) directory and leave it in flight.
    const older = face.checkModelStatus()
    // Editing the directory bumps the generation and immediately resets state.
    face.edit('semanticModelDir', '/models/b')
    expect(stateOf(face).semanticModelState.path).toBe('')
    // The old reply finally arrives with a stale path: it must not publish.
    oldReply.resolve({ ok: true, value: statusResult({ ready: true, path: '/models/a' }) })
    await older
    // Let the coalesced refresh for the new target settle.
    await vi.waitFor(() => expect(port.semanticModelStatus).toHaveBeenCalledTimes(2))
    expect(stateOf(face).semanticModelState.path).not.toBe('/models/a')
    expect(stateOf(face).semanticModelState.ready).toBe(false)
  })

  it('does not let a stale verify reply overwrite status after a discard', async () => {
    const verifyReply = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf({
      verifySemanticModel: vi.fn(() => verifyReply.promise),
    })
    const { face } = controllerOf(port)
    const verifying = face.verifyModel()
    expect(stateOf(face).semanticModelPhase).toBe('checking')
    // Discard bumps the generation and drops the transient phase immediately.
    face.discard()
    expect(stateOf(face).semanticModelPhase).toBe('idle')
    verifyReply.resolve({ ok: true, value: statusResult({ ready: true, path: '/verified' }) })
    await verifying
    expect(stateOf(face).semanticModelState.path).not.toBe('/verified')
    expect(stateOf(face).semanticModelState.ready).toBe(false)
  })

  it('reconciles an external committed-settings update without a stale reply winning', async () => {
    const firstReply = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf({
      semanticModelStatus: vi
        .fn()
        .mockImplementationOnce(() => firstReply.promise)
        .mockImplementation(async () => ({ ok: true as const, value: statusResult() })),
    })
    const { scope, face } = controllerOf(port)
    const older = face.checkModelStatus()
    // The host publishes a different committed model: the form invalidates.
    scope.publish({ value: { semanticModel: 'bilingual', semanticModelDir: '/new' } })
    firstReply.resolve({
      ok: false,
      error: new RemoteError(COMPONENT_ABSENT_CODE, 'row off', {
        endpoint: 'zotero/semanticModelStatus',
      }),
    })
    await older
    await vi.waitFor(() => expect(port.semanticModelStatus).toHaveBeenCalledTimes(2))
    // A stale service-unavailable reply must not mark the new target unavailable.
    expect(stateOf(face).semanticModelUnavailable).toBe(false)
  })

  it('keeps the checking phase visible so a status refresh cannot clear it', async () => {
    const verifyReply = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf({
      verifySemanticModel: vi.fn(() => verifyReply.promise),
    })
    const { face } = controllerOf(port)
    const verifying = face.verifyModel()
    expect(stateOf(face).semanticModelPhase).toBe('checking')
    // A concurrent status refresh for the same target returns first.
    await face.checkModelStatus()
    // The transient verify phase survives the status refresh.
    expect(stateOf(face).semanticModelPhase).toBe('checking')
    verifyReply.resolve({ ok: true, value: statusResult({ ready: true }) })
    await verifying
    expect(stateOf(face).semanticModelPhase).toBe('idle')
  })

  it('binds an explicit cancel to the target clicked, not a later edited one', async () => {
    const cancelReply = deferred<RemoteResult<{ cancelled: boolean }>>()
    const port = modelPortOf({
      cancelSemanticModelDownload: vi.fn(() => cancelReply.promise),
    })
    const { face } = controllerOf(port)
    const cancelling = face.cancelModelDownload()
    expect(stateOf(face).semanticModelPhase).toBe('cancelling')
    // Switching the UI cancels observation only; the clicked target stays bound.
    face.edit('semanticModelDir', '/other')
    cancelReply.resolve({ ok: true, value: { cancelled: true } })
    await cancelling
    expect(port.cancelSemanticModelDownload).toHaveBeenCalledWith(
      { model: 'balanced', modelDir: '' },
      expect.any(AbortSignal),
    )
    expect(stateOf(face).semanticModelPhase).toBe('idle')
  })

  it('passes a signal to every model operation and aborts it on generation bump', async () => {
    const statusReply = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf({
      semanticModelStatus: vi.fn(() => statusReply.promise),
    })
    const { face } = controllerOf(port)
    const pending = face.checkModelStatus()
    const signal = (port.semanticModelStatus as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    face.edit('semanticModel', 'bilingual')
    expect(signal.aborted).toBe(true)
    statusReply.resolve({ ok: true, value: statusResult() })
    await pending
  })

  it('a verify request carries the trimmed normalized directory', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', '  /models/space  ')
    await face.verifyModel()
    const request = (port.verifySemanticModel as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ZoteroSemanticModelVerifyRequestView
    expect(request.modelDir).toBe('/models/space')
  })
})
