// @vitest-environment jsdom
/**
 * One field parser produces a trimmed, valid `{model, dir, source}` target. An
 * invalid draft fails form validation only: it sends no RPC, creates no
 * directory, and never marks the component unavailable.
 * @module tests/client/enrichment/model-draft-validation
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
  parseSemanticModelTarget,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
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

function modelPortOf(): EnrichmentModelPort {
  return {
    semanticModelStatus: vi.fn(async () => ({
      ok: true as const,
      value: {
        model: 'balanced',
        ready: false,
        downloading: false,
        path: '',
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
      },
    })),
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
      value: {
        model: 'balanced',
        ready: false,
        downloading: false,
        path: '',
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
      },
    })),
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

describe('the single trimmed field parser', () => {
  it('trims every field and returns one valid target', () => {
    expect(parseSemanticModelTarget('  balanced  ', ' huggingface ', '  /models/dir  ')).toEqual({
      model: 'balanced',
      normalizedDir: '/models/dir',
      source: 'huggingface',
    })
  })

  it('rejects an unknown model, an unknown source, and a relative directory', () => {
    expect(parseSemanticModelTarget('typo', 'hf-mirror', '/models')).toBeUndefined()
    expect(parseSemanticModelTarget('balanced', 'typo', '/models')).toBeUndefined()
    expect(parseSemanticModelTarget('balanced', 'hf-mirror', 'relative/dir')).toBeUndefined()
  })

  it('accepts an empty directory as the default location', () => {
    expect(parseSemanticModelTarget('balanced', 'hf-mirror', '   ')).toEqual({
      model: 'balanced',
      normalizedDir: '',
      source: 'hf-mirror',
    })
  })
})

describe('an invalid draft sends no RPC', () => {
  it('a half-typed directory fires no status read, download, verify or cancel', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', 'relative/path')
    // The invalid draft is a form-validation fact, not a wire question.
    expect(stateOf(face).semanticModelDir.invalid).toBe(true)
    await face.checkModelStatus()
    await face.downloadModel()
    await face.verifyModel()
    await face.cancelModelDownload()
    expect(port.semanticModelStatus).not.toHaveBeenCalled()
    expect(port.downloadSemanticModel).not.toHaveBeenCalled()
    expect(port.verifySemanticModel).not.toHaveBeenCalled()
    expect(port.cancelSemanticModelDownload).not.toHaveBeenCalled()
    expect(stateOf(face).semanticModelUnavailable).toBe(false)
  })

  it('an unknown staged model cancels observation without marking the component absent', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModel', 'kalm-0.5b')
    expect(stateOf(face).semanticModel.invalid).toBe(true)
    await face.checkModelStatus()
    expect(port.semanticModelStatus).not.toHaveBeenCalled()
    expect(stateOf(face).semanticModelUnavailable).toBe(false)
  })

  it('only a valid trimmed target reaches the wire request', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', '  /models/dir  ')
    await face.checkModelStatus()
    expect(port.semanticModelStatus).toHaveBeenCalledWith(
      { model: 'balanced', modelDir: '/models/dir' },
      expect.any(AbortSignal),
    )
  })

  it('a discarded invalid draft restores a valid target and resumes status reads', async () => {
    const port = modelPortOf()
    const { face } = controllerOf(port)
    face.edit('semanticModelDir', 'not/absolute')
    expect(stateOf(face).semanticModelDir.invalid).toBe(true)
    face.discard()
    expect(stateOf(face).semanticModelDir.invalid).toBe(false)
    await vi.waitFor(() => expect(port.semanticModelStatus).toHaveBeenCalled())
  })
})
