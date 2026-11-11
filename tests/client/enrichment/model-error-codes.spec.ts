// @vitest-environment jsdom
/**
 * The full RemoteResult/RemoteError is preserved: only the exact
 * `gateway/service-unavailable` code marks the component absent, while
 * permission, carrier, offline, directory, hash and lock-contention failures
 * keep their real code/details and stay recoverable (no auto-disable).
 * @module tests/client/enrichment/model-error-codes
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
  COMPONENT_ABSENT_CODE,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import type { ZoteroSemanticModelStatusResultView } from '../../../src/contract.ts'
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

function statusResult(
  overrides: Partial<ZoteroSemanticModelStatusResultView> = {},
): ZoteroSemanticModelStatusResultView {
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
      value: statusResult(),
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

describe('real model error codes', () => {
  it('surfaces a domain permission failure with its code and details, recoverably', async () => {
    const port = modelPortOf({
      semanticModelStatus: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('zotero/domain', 'Permission revoked by the gateway', {
          code: 'ZOTERO_CAPABILITY_UNAVAILABLE',
        }),
      })),
    })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    const state = stateOf(face)
    expect(state.semanticModelUnavailable).toBe(false)
    expect(state.semanticModelFailure?.code).toBe('zotero/domain')
    expect(state.semanticModelFailure?.message).toBe('Permission revoked by the gateway')
    expect(state.semanticModelFailure?.details).toEqual({
      code: 'ZOTERO_CAPABILITY_UNAVAILABLE',
    })
    // Recovery stays possible: a download is still dispatchable.
    await face.downloadModel()
    expect(port.downloadSemanticModel).toHaveBeenCalled()
  })

  it('keeps a carrier/offline failure recoverable and never marks the component absent', async () => {
    const port = modelPortOf({
      verifySemanticModel: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'network unreachable', {}),
      })),
    })
    const { face } = controllerOf(port)
    await face.verifyModel()
    const state = stateOf(face)
    expect(state.semanticModelUnavailable).toBe(false)
    expect(state.semanticModelFailure?.code).toBe('gateway/internal')
    expect(state.semanticModelState.error).toBe('network unreachable')
    expect(state.semanticModelPhase).toBe('idle')
  })

  it('shows a directory/hash/lock domain code on the download failure', async () => {
    const port = modelPortOf({
      downloadSemanticModel: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError(
          'zotero/domain',
          'the model directory is locked by another process',
          {
            code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
          },
        ),
      })),
    })
    const { face } = controllerOf(port)
    await face.downloadModel()
    const state = stateOf(face)
    expect(state.semanticModelState.downloading).toBe(false)
    expect(state.semanticModelFailure?.details).toEqual({
      code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
    })
    expect(state.semanticModelUnavailable).toBe(false)
  })

  it('marks the component absent only for the exact gateway/service-unavailable code', async () => {
    const port = modelPortOf({
      semanticModelStatus: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError(COMPONENT_ABSENT_CODE, 'the enrichment row is not composed', {
          endpoint: 'zotero/semanticModelStatus',
        }),
      })),
    })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    expect(stateOf(face).semanticModelUnavailable).toBe(true)
    expect(stateOf(face).semanticModelFailure).toBeUndefined()
    // A download against an absent component is a no-op, not a fake success.
    await face.downloadModel()
    expect(port.downloadSemanticModel).not.toHaveBeenCalled()
  })

  it('clears the absent flag after a successful status once the component returns', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError(COMPONENT_ABSENT_CODE, 'row off', {
          endpoint: 'zotero/semanticModelStatus',
        }),
      })
      .mockResolvedValue({ ok: true, value: statusResult({ ready: true, percent: 100 }) })
    const port = modelPortOf({ semanticModelStatus: status })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    expect(stateOf(face).semanticModelUnavailable).toBe(true)
    await face.checkModelStatus()
    expect(stateOf(face).semanticModelUnavailable).toBe(false)
    expect(stateOf(face).semanticModelState.ready).toBe(true)
  })

  it('classifies a late thrown carrier error with its real message', async () => {
    const port = modelPortOf({
      semanticModelStatus: vi.fn(async () => {
        throw new Error('bridge reset')
      }),
    })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    const state = stateOf(face)
    expect(state.semanticModelUnavailable).toBe(false)
    expect(state.semanticModelFailure?.code).toBe('client/model-operation-failed')
    expect(state.semanticModelFailure?.message).toBe('bridge reset')
  })
})
