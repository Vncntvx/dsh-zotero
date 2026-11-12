// @vitest-environment jsdom
/**
 * The enrichment settings controller: defaults, staged writes, and the one
 * requirement that shapes the whole feature — the mode switch is independent
 * of the token, so a configured token never forces pro mode.
 * @module tests/client/enrichment/enrichment-form-controller
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import { fakeScope } from '../helpers/fake-scope.ts'

const controllers: EnrichmentFormController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function credentialPort(
  overrides: Partial<EnrichmentCredentialPort> = {},
): EnrichmentCredentialPort {
  return {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
    ...overrides,
  } as EnrichmentCredentialPort
}

function controllerOf(
  options: Parameters<typeof fakeScope>[0] = {},
  port: EnrichmentCredentialPort = credentialPort(),
  model?: EnrichmentModelPort,
) {
  const scope = fakeScope(options)
  const controller = new EnrichmentFormController(scope, port, model)
  controllers.push(controller)
  return { scope, controller, face: controller.inject() }
}

describe('EnrichmentFormController', () => {
  it('projects the free mode and an empty output directory by default', () => {
    const { face } = controllerOf()
    const state = face.hooks.enrichmentCard.getSnapshot()
    expect(state.mode.text).toBe('free')
    expect(state.outputDir.text).toBe('')
    expect(state.mineruTokenRef.text).toBe('')
    expect(state.enableSemanticSearch.text).toBe('')
    expect(state.semanticModel.text).toBe('balanced')
    expect(state.semanticDownloadSource.text).toBe('hf-mirror')
    expect(state.semanticModelDir.text).toBe('')
  })

  it('stages and saves semantic settings', async () => {
    const { scope, face } = controllerOf()
    face.edit('enableSemanticSearch', 'true')
    face.edit('semanticModel', 'bilingual')
    face.edit('semanticDownloadSource', 'huggingface')
    face.edit('semanticModelDir', '/custom/models')
    const state = face.hooks.enrichmentCard.getSnapshot()
    expect(state.enableSemanticSearch.text).toBe('true')
    expect(state.semanticModel.text).toBe('bilingual')
    expect(state.semanticDownloadSource.text).toBe('huggingface')
    expect(state.semanticModelDir.text).toBe('/custom/models')
    await face.save()
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'enableSemanticSearch',
      value: true,
    })
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'semanticModel',
      value: 'bilingual',
    })
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'semanticDownloadSource',
      value: 'huggingface',
    })
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'semanticModelDir',
      value: '/custom/models',
    })
  })

  it('marks invalid semantic fields invalid and refuses to save them', async () => {
    const { scope, face } = controllerOf()
    face.edit('semanticModel', 'not-a-real-model')
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModel.invalid).toBe(true)

    face.edit('semanticDownloadSource', 'not-a-real-source')
    expect(face.hooks.enrichmentCard.getSnapshot().semanticDownloadSource.invalid).toBe(true)

    face.edit('semanticModelDir', 'relative/path')
    expect(face.hooks.enrichmentCard.getSnapshot().semanticModelDir.invalid).toBe(true)

    await face.save()
    expect(scope.writes.some((w) => w.field === 'semanticModel')).toBe(false)
    expect(scope.writes.some((w) => w.field === 'semanticDownloadSource')).toBe(false)
    expect(scope.writes.some((w) => w.field === 'semanticModelDir')).toBe(false)
  })

  it('resets semanticModelDir with unset write', async () => {
    const { scope, face } = controllerOf()
    face.edit('semanticModelDir', '/custom/models')
    await face.save()
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'semanticModelDir',
      value: '/custom/models',
    })
    face.resetField('semanticModelDir')
    await face.save()
    expect(scope.writes.some((w) => w.op === 'unset' && w.field === 'semanticModelDir')).toBe(true)
  })

  it('stages and saves the mode when the switch is used', async () => {
    const { scope, face } = controllerOf()
    face.edit('mode', 'pro')
    expect(face.hooks.enrichmentCard.getSnapshot().mode.text).toBe('pro')
    await face.save()
    expect(scope.writes).toContainEqual({ op: 'set', field: 'mode', value: 'pro' })
  })

  it('keeps the mode free when a token reference is configured', () => {
    // The exact scenario the switch exists for: a configured token must not
    // force pro mode.
    const { face } = controllerOf()
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    const state = face.hooks.enrichmentCard.getSnapshot()
    expect(state.mode.text).toBe('free')
    expect(state.mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('clears a staged token when its reference changes', () => {
    const { face } = controllerOf()
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    face.edit('mineruToken', 'secret')
    face.edit('mineruTokenRef', 'OTHER_TOKEN')
    expect(face.hooks.enrichmentCard.getSnapshot().mineruToken.text).toBe('')
  })

  it('restores the default output directory by clearing the override', async () => {
    const { scope, face } = controllerOf()
    face.edit('outputDir', '/tmp/parsed')
    await face.save()
    expect(scope.writes).toContainEqual({ op: 'set', field: 'outputDir', value: '/tmp/parsed' })
    face.resetField('outputDir')
    await face.save()
    expect(scope.writes.some((write) => write.op === 'unset' && write.field === 'outputDir')).toBe(
      true,
    )
  })

  it('marks a relative output directory invalid and refuses to save it', async () => {
    const { scope, face } = controllerOf()
    face.edit('outputDir', 'papers/parsed')
    expect(face.hooks.enrichmentCard.getSnapshot().outputDir.invalid).toBe(true)
    await face.save()
    expect(scope.writes.some((write) => write.field === 'outputDir')).toBe(false)
  })

  it('marks a mode outside the closed set invalid and refuses to save it', async () => {
    const { scope, face } = controllerOf()
    face.edit('mode', 'turbo')
    expect(face.hooks.enrichmentCard.getSnapshot().mode.invalid).toBe(true)
    await face.save()
    expect(scope.writes.some((write) => write.field === 'mode')).toBe(false)
  })

  it('reads the credential state for the committed reference', async () => {
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { MINERU_API_TOKEN: { configured: true, writable: true } },
    }))
    const { face } = controllerOf({}, credentialPort({ describe }))
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    await vi.waitFor(() => {
      expect(face.hooks.enrichmentCard.getSnapshot().mineruToken.configured).toBe(true)
    })
    expect(describe).toHaveBeenCalledWith(['MINERU_API_TOKEN'])
  })

  it('re-reads the credential when the host reports its reference changed', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller, face } = controllerOf({}, credentialPort({ describe }))
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(1))

    controller.refreshCredential('MINERU_API_TOKEN')
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(2))
    // A reference this form does not use is ignored.
    controller.refreshCredential('OTHER_TOKEN')
    await Promise.resolve()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('never reads a credential for an invalid reference spelling', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { face } = controllerOf({}, credentialPort({ describe }))
    await Promise.resolve()
    describe.mockClear()
    face.edit('mineruTokenRef', 'not a ref')
    await face.save()
    await Promise.resolve()
    // The field is marked invalid, so the save never lands and no read runs.
    expect(face.hooks.enrichmentCard.getSnapshot().mineruTokenRef.invalid).toBe(true)
    expect(describe).not.toHaveBeenCalled()
  })

  it('drops a queued credential read when disposed before it runs', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller } = controllerOf(
      { value: { mineruTokenRef: 'MINERU_API_TOKEN' } },
      credentialPort({ describe }),
    )
    controller.refreshCredential('MINERU_API_TOKEN')
    controller.dispose()
    await Promise.resolve()
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
  })

  it('coalesces two refreshes in the same tick into one read', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller } = controllerOf(
      { value: { mineruTokenRef: 'MINERU_API_TOKEN' } },
      credentialPort({ describe }),
    )
    controller.refreshCredential('MINERU_API_TOKEN')
    controller.refreshCredential('MINERU_API_TOKEN')
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(1))
  })

  it('ignores credential refreshes after disposal and is idempotent on dispose', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller } = controllerOf(
      { value: { mineruTokenRef: 'MINERU_API_TOKEN' } },
      credentialPort({ describe }),
    )
    controller.dispose()
    controller.dispose()
    controller.refreshCredential('MINERU_API_TOKEN')
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
  })

  it('ignores a refresh for an uncommitted reference and never reads', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller } = controllerOf({}, credentialPort({ describe }))
    await Promise.resolve()
    describe.mockClear()
    controller.refreshCredential('OTHER_REF')
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
  })

  it('refuses to write a token with an invalid committed reference', async () => {
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const { scope, face } = controllerOf(
      { value: { mineruTokenRef: 'not a ref' } },
      credentialPort({ set }),
    )
    face.edit('mineruToken', 'orphan secret')
    await face.save()
    expect(set).not.toHaveBeenCalled()
    expect(scope.writes.some((write) => write.field === 'mineruToken')).toBe(false)
  })

  it('writes a token under the default plugin reference when no custom reference is set', async () => {
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const { face } = controllerOf({}, credentialPort({ set }))
    face.edit('mineruToken', 'test-token')
    await face.save()
    expect(set).toHaveBeenCalledWith('MINERU_API_TOKEN', 'test-token')
  })

  it('does not write a blank token draft', async () => {
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const { face } = controllerOf(
      { value: { mineruTokenRef: 'MINERU_API_TOKEN' } },
      credentialPort({ set }),
    )
    face.edit('mineruToken', '   ')
    await face.save()
    expect(set).not.toHaveBeenCalled()
  })

  it('reports a refused credential write as not configured', async () => {
    const set = vi.fn(async () => ({ ok: false as const, error: { code: 'x' } }))
    const { face } = controllerOf(
      { value: { mineruTokenRef: 'MINERU_API_TOKEN' } },
      credentialPort({ set: set as unknown as EnrichmentCredentialPort['set'] }),
    )
    face.edit('mineruToken', 'secret')
    await face.save()
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith('MINERU_API_TOKEN', 'secret'))
    expect(face.hooks.enrichmentCard.getSnapshot().mineruToken.configured).toBe(false)
  })

  it('treats a failed credential describe as not configured', async () => {
    const describe = vi.fn(async () => ({ ok: false as const, error: { code: 'x' } }))
    const { face } = controllerOf(
      {},
      credentialPort({ describe: describe as unknown as EnrichmentCredentialPort['describe'] }),
    )
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    await vi.waitFor(() => expect(describe).toHaveBeenCalled())
    expect(face.hooks.enrichmentCard.getSnapshot().mineruToken.configured).toBe(false)
  })

  it('disables the token control when the credential is not writable', async () => {
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { MINERU_API_TOKEN: { configured: true, writable: false } },
    }))
    const { face } = controllerOf({}, credentialPort({ describe }))
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    await vi.waitFor(() => {
      expect(face.hooks.enrichmentCard.getSnapshot().mineruToken.disabled).toBe(true)
    })
  })

  it('disables the token control while the namespace is read-only', () => {
    const { face } = controllerOf({
      writable: false,
      value: { mineruTokenRef: 'MINERU_API_TOKEN' },
    })
    const state = face.hooks.enrichmentCard.getSnapshot()
    expect(state.mineruToken.disabled).toBe(true)
  })

  it('writes the token through the credential port, never through settings', async () => {
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { MINERU_API_TOKEN: { configured: true, writable: true } },
    }))
    const { scope, face } = controllerOf({}, credentialPort({ set, describe }))
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    face.edit('mineruToken', 'secret-token')
    await face.save()
    await vi.waitFor(() => {
      expect(set).toHaveBeenCalledWith('MINERU_API_TOKEN', 'secret-token')
    })
    expect(scope.writes.some((write) => write.field === 'mineruToken')).toBe(false)
  })
})
