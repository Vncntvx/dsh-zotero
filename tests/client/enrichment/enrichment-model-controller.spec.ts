// @vitest-environment jsdom
/**
 * The enrichment controller's model half: status is queried on demand, the
 * unavailable fact is rendered rather than faked, downloads carry the staged
 * fields (and `force` only when asked), and a stale status response never
 * overwrites a newer one.
 * @module tests/client/enrichment/enrichment-model-controller
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroSemanticModelStatusResultView } from '../../../src/contract.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
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

/** A full model port with spies; override single arms per test. */
function modelPortOf(overrides: Partial<EnrichmentModelPort> = {}): EnrichmentModelPort {
  const status: ZoteroSemanticModelStatusResultView = {
    model: 'balanced',
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
  return {
    semanticModelStatus: vi.fn(async () => ({ ok: true as const, value: { ...status } })),
    downloadSemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '' },
    })),
    cancelSemanticModelDownload: vi.fn(async () => ({
      ok: true as const,
      value: { cancelled: false },
    })),
    deleteSemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: {
        success: true,
        model: 'balanced',
        path: '',
        removed: true,
        removedFiles: 1,
        removedBytes: 1,
      },
    })),
    verifySemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: { ...status, ready: true, percent: 100 },
    })),
    ...overrides,
  }
}

function controllerOf(model: EnrichmentModelPort) {
  const scope = fakeScope()
  const controller = new EnrichmentFormController(scope, credentialPort(), model)
  controllers.push(controller)
  return { scope, controller, face: controller.inject() }
}

describe('EnrichmentFormController model operations', () => {
  it('does not send a status RPC on a draft keystroke', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModel', 'bilingual')
    face.edit('semanticModelDir', '/custom/models')
    face.resetField('semanticModelDir')
    // Editing a draft is a form-validation fact only; no wire call fires from
    // the keystrokes themselves.
    expect(port.semanticModelStatus).not.toHaveBeenCalled()
  })

  it('is a no-op without a model port, without throwing', async () => {
    const scope = fakeScope()
    const controller = new EnrichmentFormController(scope, credentialPort())
    controllers.push(controller)
    const face = controller.inject()
    await face.checkModelStatus()
    await face.downloadModel()
    await face.cancelModelDownload()
    await face.verifyModel()
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelUnavailable).toBe(false)
  })

  it('surfaces a thrown download failure as the state error', async () => {
    const port = modelPortOf({
      downloadSemanticModel: vi.fn(async () => {
        throw new Error('bridge down')
      }),
    })
    const { face } = controllerOf(port)
    await face.downloadModel()
    const state = face.hooks.enrichmentCard.getSnapshot().semanticModelState
    expect(state.downloading).toBe(false)
    expect(state.error).toBe('bridge down')
  })

  it('drops the downloading flag when the start call is refused', async () => {
    const port = modelPortOf({
      downloadSemanticModel: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'no space', {}),
      })),
    })
    const { face } = controllerOf(port)
    await face.downloadModel()
    const state = face.hooks.enrichmentCard.getSnapshot().semanticModelState
    expect(state.downloading).toBe(false)
    expect(state.error).toBe('no space')
  })

  it('keeps the deleting phase when a verify that finished later clears its own phase', async () => {
    // Both operations set the one phase field. A verify resolving after a
    // delete started must not return the phase to idle: the delete request is
    // still open, and an idle phase re-enables every button.
    const verifying = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const deleting = deferred<RemoteResult<never>>()
    const port = modelPortOf({
      verifySemanticModel: vi.fn(() => verifying.promise),
      deleteSemanticModel: vi.fn(() => deleting.promise as never),
    })
    const { face } = controllerOf(port)
    const verify = face.verifyModel()
    const remove = face.deleteModel()
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelPhase).toBe('deleting')

    verifying.resolve({
      ok: true,
      value: {
        model: 'balanced',
        ready: true,
        downloading: false,
        path: '/models/balanced',
        downloadedBytes: 1,
        totalBytes: 1,
        percent: 100,
      },
    })
    await verify
    // The verify finished, the delete did not: the phase still belongs to the
    // delete.
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelPhase).toBe('deleting')

    deleting.resolve({
      ok: true,
      value: {
        success: true,
        model: 'balanced',
        path: '',
        removed: true,
        removedFiles: 1,
        removedBytes: 1,
      } as never,
    })
    await remove
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelPhase).toBe('idle')
  })

  it('stops every model action once the endpoints answered unavailable', async () => {
    const port = modelPortOf({
      semanticModelStatus: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/service-unavailable', 'not composed', {
          endpoint: 'zotero/semanticModelStatus',
        }),
      })),
      verifySemanticModel: vi.fn(async () => ({
        ok: true as const,
        value: {
          model: 'balanced',
          ready: true,
          downloading: false,
          path: '',
          downloadedBytes: 0,
          totalBytes: 0,
          percent: 100,
        },
      })),
    })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    await face.verifyModel()
    expect(port.verifySemanticModel).not.toHaveBeenCalled()
    await face.cancelModelDownload()
    expect(port.cancelSemanticModelDownload).not.toHaveBeenCalled()
  })

  it('leaves status alone until something asks: no mount-time RPC', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    await Promise.resolve()
    expect(port.semanticModelStatus).not.toHaveBeenCalled()
    await face.checkModelStatus()
    expect(port.semanticModelStatus).toHaveBeenCalledTimes(1)
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelState.ready).toBe(false)
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelUnavailable).toBe(false)
  })

  it('passes the staged model, source, and directory to the download', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticDownloadSource', 'huggingface')
    face.edit('semanticModelDir', '/custom/models')
    await face.downloadModel()
    expect(port.downloadSemanticModel).toHaveBeenCalledWith(
      {
        model: 'balanced',
        source: 'huggingface',
        modelDir: '/custom/models',
      },
      expect.any(AbortSignal),
    )
  })

  it('sends force only when redownload is asked for', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    await face.downloadModel()
    expect(port.downloadSemanticModel).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ force: true }),
      expect.any(AbortSignal),
    )
    await face.downloadModel(true)
    expect(port.downloadSemanticModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
      expect.any(AbortSignal),
    )
  })

  it('cancels with the staged directory and re-reads status', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', '/custom/models')
    await face.cancelModelDownload()
    expect(port.cancelSemanticModelDownload).toHaveBeenCalledWith(
      {
        model: 'balanced',
        modelDir: '/custom/models',
      },
      expect.any(AbortSignal),
    )
  })

  it('verify adopts the returned status, ready or not', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    await face.verifyModel()
    const state = face.hooks.enrichmentCard.getSnapshot().semanticModelState
    expect(state.ready).toBe(true)
  })

  it('deletes with the staged target and re-reads status', async () => {
    const deleteSemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: {
        success: true,
        model: 'balanced',
        path: '/custom/models/bundle',
        removed: true,
        removedFiles: 3,
        removedBytes: 12,
      },
    }))
    const port = modelPortOf({ deleteSemanticModel })
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', '/custom/models')
    await face.deleteModel()
    expect(deleteSemanticModel).toHaveBeenCalledWith(
      { model: 'balanced', modelDir: '/custom/models' },
      expect.any(AbortSignal),
    )
    expect(port.semanticModelStatus).toHaveBeenLastCalledWith(
      { model: 'balanced', modelDir: '/custom/models' },
      expect.any(AbortSignal),
    )
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelPhase).toBe('idle')
  })

  it('surfaces a delete refusal and clears the deleting phase', async () => {
    const port = modelPortOf({
      deleteSemanticModel: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('zotero/domain', 'The model is downloading.', {
          code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
        }),
      })),
    })
    const { face } = controllerOf(port)
    await face.deleteModel()
    const state = face.hooks.enrichmentCard.getSnapshot()
    expect(state.semanticModelFailure?.message).toBe('The model is downloading.')
    expect(state.semanticModelPhase).toBe('idle')
  })

  it('skips status for a staged model the catalog does not know', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModel', 'kalm-0.5b')
    await Promise.resolve()
    expect(port.semanticModelStatus).not.toHaveBeenCalled()
    // The unknown spelling stays invalid; nothing was sent anywhere.
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModel.invalid).toBe(true)
  })

  it('marks the model surface unavailable when the endpoints do not answer', async () => {
    const port = modelPortOf({
      semanticModelStatus: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/service-unavailable', 'not composed', {
          endpoint: 'zotero/semanticModelStatus',
        }),
      })),
      downloadSemanticModel: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/service-unavailable', 'not composed', {
          endpoint: 'zotero/downloadSemanticModel',
        }),
      })),
    })
    const { face } = controllerOf(port)
    await face.checkModelStatus()
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelUnavailable).toBe(true)
    // A download attempt against an unavailable component is a no-op, not a
    // fake success.
    await face.downloadModel()
    expect(port.downloadSemanticModel).not.toHaveBeenCalled()
  })

  it('ignores a stale status response that arrives after a newer request', async () => {
    const first =
      deferred<
        EnrichmentModelPort['semanticModelStatus'] extends never
          ? never
          : RemoteResult<ZoteroSemanticModelStatusResultView>
      >()
    const second = deferred<RemoteResult<ZoteroSemanticModelStatusResultView>>()
    const port = modelPortOf()
    const statusMock = port.semanticModelStatus as ReturnType<typeof vi.fn>
    statusMock.mockImplementationOnce(() => first.promise)
    statusMock.mockImplementationOnce(() => second.promise)
    const { face } = controllerOf(port)
    const older = face.checkModelStatus()
    const newer = face.checkModelStatus()
    first.resolve({
      ok: true as const,
      value: {
        model: 'balanced',
        ready: true,
        downloading: false,
        path: '/old',
        downloadedBytes: 0,
        totalBytes: 10,
        percent: 0,
      },
    })
    second.resolve({
      ok: true as const,
      value: {
        model: 'balanced',
        ready: false,
        downloading: true,
        path: '/new',
        downloadedBytes: 5,
        totalBytes: 10,
        percent: 50,
      },
    })
    await Promise.all([older, newer])
    const state = face.hooks.enrichmentCard.getSnapshot().semanticModelState
    // The newer request wins even though the older one resolved last.
    expect(state.path).toBe('/new')
    expect(state.downloading).toBe(true)
  })
})
