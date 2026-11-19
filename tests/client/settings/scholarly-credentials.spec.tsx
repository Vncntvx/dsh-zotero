// @vitest-environment jsdom
/**
 * The scholarly credential seam: the page hides reference names and stages
 * the suggested reference on the first key save, while custom references,
 * failed writes, and an empty committed reference keep their semantics.
 * @module tests/client/settings/scholarly-credentials
 */

import { cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  ScholarlyFormController,
  type ScholarlyCardFace,
  type ScholarlyCardState,
  type ScholarlyCredentialInfo,
  type ScholarlyCredentialPort,
} from '../../../src/client/scholarly-form-controller.ts'
import {
  ScholarlySettingsSection,
  type ScholarlySettingsSectionProps,
} from '../../../src/client/ScholarlySettingsSection.tsx'
import { zh } from '../../../src/client/locales.ts'
import { emptyCredentialPort } from '../helpers/credential-port.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

interface FakeCredentials extends ScholarlyCredentialPort {
  readonly writes: Array<{ ref: string; value: string }>
  readonly reads: string[][]
}

/** A recording credential port over an initially empty store. */
function fakeCredentials(): FakeCredentials {
  const values = new Map<string, ScholarlyCredentialInfo>()
  const writes: Array<{ ref: string; value: string }> = []
  const reads: string[][] = []
  return {
    writes,
    reads,
    async describe(refs) {
      reads.push([...refs])
      const value: Record<string, ScholarlyCredentialInfo> = {}
      for (const ref of refs) value[ref] = values.get(ref) ?? { configured: false, writable: true }
      return { ok: true, value } as RemoteResult<Record<string, ScholarlyCredentialInfo>>
    },
    async set(ref, value) {
      values.set(ref, { configured: value.trim() !== '', writable: true })
      writes.push({ ref, value })
      return { ok: true, value: undefined } as RemoteResult<unknown>
    },
  }
}

function ScholarlyHarness({ face }: { face: ScholarlyCardFace }) {
  const state = useSyncExternalStore(
    face.hooks.scholarlyCard.subscribe,
    face.hooks.scholarlyCard.getSnapshot,
  )
  const props = {
    view: 'page',
    t: makeTranslate(zh),
    useScholarlyCard: (selector: (snapshot: ScholarlyCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  } as unknown as ScholarlySettingsSectionProps
  return <ScholarlySettingsSection {...props} />
}

describe('scholarly credential references', () => {
  it('stages the suggested reference with the first key save', async () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()
    face.edit('s2Key', 'key-1')
    face.save()

    await vi.waitFor(() =>
      expect(credentials.writes).toEqual([{ ref: 'S2_API_KEY', value: 'key-1' }]),
    )
    expect(scope.writes).toEqual([{ op: 'set', field: 's2ApiKeyEnv', value: 'S2_API_KEY' }])
    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )
    controller.dispose()
  })

  it('withdraws the suggested reference when the key draft is cleared', () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    face.edit('s2Key', 'key-1')
    face.edit('s2Key', '')
    face.save()

    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('')
    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(false)
    expect(scope.writes).toEqual([])
    expect(credentials.writes).toEqual([])
    controller.dispose()
  })

  it('keeps a custom committed reference when saving a key', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'CUSTOM_KEY' } })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()
    face.edit('s2Key', 'key-2')
    face.save()

    await vi.waitFor(() =>
      expect(credentials.writes).toEqual([{ ref: 'CUSTOM_KEY', value: 'key-2' }]),
    )
    expect(scope.writes).toEqual([])
    controller.dispose()
  })

  it('keeps the staged reference and draft when a key write fails, then succeeds on retry', async () => {
    const scope = fakeScope({ value: {} })
    let attempts = 0
    let stored = false
    const port: ScholarlyCredentialPort = {
      describe: async (refs) => ({
        ok: true,
        value: Object.fromEntries(
          refs.map((ref) => [ref, { configured: stored && ref === 'S2_API_KEY', writable: true }]),
        ),
      }),
      set: async () => {
        attempts += 1
        if (attempts > 1) {
          stored = true
          return { ok: true, value: undefined } as RemoteResult<unknown>
        }
        return {
          ok: false,
          error: new RemoteError('gateway/internal', 'credentials store refused the write', {}),
        }
      },
    }
    const controller = new ScholarlyFormController(scope, port)
    const face = controller.inject()
    face.edit('s2Key', 'key-1')
    face.save()

    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().saving).toBe(false))
    expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(true)
    expect(scope.writes).toEqual([{ op: 'set', field: 's2ApiKeyEnv', value: 'S2_API_KEY' }])
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('key-1')

    face.save()
    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )
    expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(false)
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('')
    expect(scope.writes).toEqual([{ op: 'set', field: 's2ApiKeyEnv', value: 'S2_API_KEY' }])
    controller.dispose()
  })

  it('enables a key control when the committed reference is empty', () => {
    const controller = new ScholarlyFormController(fakeScope({ value: {} }), emptyCredentialPort)
    render(<ScholarlyHarness face={controller.inject()} />)

    const input = screen.getByLabelText(zh.scholarlyS2Key) as HTMLInputElement
    expect(input.disabled).toBe(false)
    expect(screen.queryByText(zh.invalidCredentialRef)).toBeNull()
    controller.dispose()
  })

  it('clears the staged key draft when its reference field is reset', () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    face.edit('s2Key', 'key-1')
    expect(face.hooks.scholarlyCard.getSnapshot().s2ApiKeyEnv.text).toBe('S2_API_KEY')

    face.resetField('s2ApiKeyEnv')
    const state = face.hooks.scholarlyCard.getSnapshot()
    expect(state.s2Key.text).toBe('')
    expect(state.s2ApiKeyEnv.text).toBe('')
    expect(state.dirty).toBe(false)

    face.save()
    expect(scope.writes).toEqual([])
    expect(credentials.writes).toEqual([])
    controller.dispose()
  })

  it('coalesces reference publications into one credential read', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)

    scope.publish({ value: { s2ApiKeyEnv: 'S2_API_KEY', ncbiApiKeyEnv: 'NCBI_API_KEY' } })

    await vi.waitFor(() => expect(credentials.reads).toHaveLength(1))
    expect(credentials.reads[0]).toEqual(['S2_API_KEY', 'NCBI_API_KEY'])
    controller.dispose()
  })

  it('is idempotent to dispose and ignores credential refreshes after teardown', () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)

    controller.dispose()
    const releases = scope.unsubscribes
    controller.dispose()
    controller.refreshCredential('S2_API_KEY')

    expect(scope.unsubscribes).toBe(releases)
    expect(credentials.reads).toEqual([])
  })

  it('fails a key save whose committed reference is invalid without writing anything', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'bad-ref!' } })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()
    face.edit('s2Key', 'key-1')
    face.save()

    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(true))
    const state = face.hooks.scholarlyCard.getSnapshot()
    expect(state.s2Key.referenceState).toBe('invalid')
    expect(state.s2Key.disabled).toBe(true)
    expect(state.s2Key.text).toBe('key-1')
    expect(scope.writes).toEqual([])
    expect(credentials.writes).toEqual([])
    controller.dispose()
  })

  it('clears the configured badge when the committed reference is removed', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const credentials = fakeCredentials()
    await credentials.set('S2_API_KEY', 'stored')
    credentials.writes.length = 0
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )

    scope.publish({ value: {} })
    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(false),
    )
    expect(credentials.reads).toHaveLength(1)
    controller.dispose()
  })
})
