// @vitest-environment jsdom
/**
 * The parsing settings controller: defaults, staged writes, and the one
 * requirement that shapes the whole feature — the mode switch is independent
 * of the token, so a configured token never forces pro mode.
 * @module tests/client/parsing/parsing-form-controller
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ParsingFormController,
  type ParsingCredentialPort,
} from '../../../src/client/parsing-form-controller.ts'
import { fakeScope } from '../helpers/fake-scope.ts'

const controllers: ParsingFormController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function credentialPort(overrides: Partial<ParsingCredentialPort> = {}): ParsingCredentialPort {
  return {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
    ...overrides,
  } as ParsingCredentialPort
}

function controllerOf(
  options: Parameters<typeof fakeScope>[0] = {},
  port: ParsingCredentialPort = credentialPort(),
) {
  const scope = fakeScope(options)
  const controller = new ParsingFormController(scope, port)
  controllers.push(controller)
  return { scope, controller, face: controller.inject() }
}

describe('ParsingFormController', () => {
  it('projects the free mode and an empty output directory by default', () => {
    const { face } = controllerOf()
    const state = face.hooks.parsingCard.getSnapshot()
    expect(state.mode.text).toBe('free')
    expect(state.outputDir.text).toBe('')
    expect(state.mineruTokenRef.text).toBe('')
    expect(state.allowParsingUpload.text).toBe('')
  })

  it('stages and saves the mode when the switch is used', async () => {
    const { scope, face } = controllerOf()
    face.edit('mode', 'pro')
    expect(face.hooks.parsingCard.getSnapshot().mode.text).toBe('pro')
    await face.save()
    expect(scope.writes).toContainEqual({ op: 'set', field: 'mode', value: 'pro' })
  })

  it('keeps the mode free when a token reference is configured', () => {
    // The exact scenario the switch exists for: a configured token must not
    // force pro mode.
    const { face } = controllerOf()
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    const state = face.hooks.parsingCard.getSnapshot()
    expect(state.mode.text).toBe('free')
    expect(state.mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('clears a staged token when its reference changes', () => {
    const { face } = controllerOf()
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    face.edit('mineruToken', 'secret')
    face.edit('mineruTokenRef', 'OTHER_TOKEN')
    expect(face.hooks.parsingCard.getSnapshot().mineruToken.text).toBe('')
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
    expect(face.hooks.parsingCard.getSnapshot().outputDir.invalid).toBe(true)
    await face.save()
    expect(scope.writes.some((write) => write.field === 'outputDir')).toBe(false)
  })

  it('marks a mode outside the closed set invalid and refuses to save it', async () => {
    const { scope, face } = controllerOf()
    face.edit('mode', 'turbo')
    expect(face.hooks.parsingCard.getSnapshot().mode.invalid).toBe(true)
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
      expect(face.hooks.parsingCard.getSnapshot().mineruToken.configured).toBe(true)
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
    face.edit('mineruTokenRef', 'not a ref')
    await face.save()
    await Promise.resolve()
    // The field is marked invalid, so the save never lands and no read runs.
    expect(face.hooks.parsingCard.getSnapshot().mineruTokenRef.invalid).toBe(true)
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

  it('ignores a refresh for the empty reference and never reads', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: {} }))
    const { controller } = controllerOf({}, credentialPort({ describe }))
    controller.refreshCredential('')
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
  })

  it('refuses to write a token with no committed reference', async () => {
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const { scope, face } = controllerOf({}, credentialPort({ set }))
    face.edit('mineruToken', 'orphan secret')
    await face.save()
    expect(set).not.toHaveBeenCalled()
    expect(scope.writes.some((write) => write.field === 'mineruToken')).toBe(false)
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
      credentialPort({ set: set as unknown as ParsingCredentialPort['set'] }),
    )
    face.edit('mineruToken', 'secret')
    await face.save()
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith('MINERU_API_TOKEN', 'secret'))
    expect(face.hooks.parsingCard.getSnapshot().mineruToken.configured).toBe(false)
  })

  it('treats a failed credential describe as not configured', async () => {
    const describe = vi.fn(async () => ({ ok: false as const, error: { code: 'x' } }))
    const { face } = controllerOf(
      {},
      credentialPort({ describe: describe as unknown as ParsingCredentialPort['describe'] }),
    )
    face.edit('mineruTokenRef', 'MINERU_API_TOKEN')
    await face.save()
    await vi.waitFor(() => expect(describe).toHaveBeenCalled())
    expect(face.hooks.parsingCard.getSnapshot().mineruToken.configured).toBe(false)
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
      expect(face.hooks.parsingCard.getSnapshot().mineruToken.disabled).toBe(true)
    })
  })

  it('disables the token control while the namespace is read-only', () => {
    const { face } = controllerOf({
      writable: false,
      value: { mineruTokenRef: 'MINERU_API_TOKEN' },
    })
    const state = face.hooks.parsingCard.getSnapshot()
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
