// @vitest-environment jsdom
/**
 * The Scholarly form controller, its settings form component, and the
 * dedicated row configuration section. Key values are credential-port writes,
 * never settings writes.
 * @module tests/client/settings/scholarly-form
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import { en, zh } from '../../../src/client/locales.ts'
import { emptyCredentialPort } from '../helpers/credential-port.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

interface FakeCredentials extends ScholarlyCredentialPort {
  readonly writes: Array<{ ref: string; value: string }>
  configured(ref: string): boolean
}

function fakeCredentials(
  initial: Readonly<Record<string, ScholarlyCredentialInfo>> = {},
): FakeCredentials {
  const values = new Map(Object.entries(initial))
  const writes: Array<{ ref: string; value: string }> = []
  return {
    writes,
    configured: (ref) => values.get(ref)?.configured === true,
    async describe(refs) {
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

function ScholarlyHarness({
  face,
  dictionary = zh,
  view = 'page',
}: {
  face: ScholarlyCardFace
  dictionary?: typeof zh
  view?: 'summary' | 'page'
}) {
  const state = useSyncExternalStore(
    face.hooks.scholarlyCard.subscribe,
    face.hooks.scholarlyCard.getSnapshot,
  )
  const props = {
    view,
    t: makeTranslate(dictionary),
    useScholarlyCard: (selector: (snapshot: ScholarlyCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  } as unknown as ScholarlySettingsSectionProps
  return <ScholarlySettingsSection {...props} />
}

describe('ScholarlyFormController', () => {
  it('projects an empty reference and unconfigured secrets from an empty scope', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const snapshot = controller.inject().hooks.scholarlyCard.getSnapshot()

    expect(snapshot.available).toBe(true)
    expect(snapshot.writable).toBe(true)
    expect(snapshot.dirty).toBe(false)
    expect(snapshot.email.text).toBe('')
    expect(snapshot.s2ApiKeyEnv.text).toBe('')
    expect(snapshot.s2Key.configured).toBe(false)
    expect(snapshot.ncbiKey.configured).toBe(false)
    expect(snapshot.openalexKey.configured).toBe(false)
    controller.dispose()
  })

  it('reads configured state from the credential port, never from settings values', async () => {
    const scope = fakeScope({
      value: { s2ApiKeyEnv: 'S2_API_KEY', s2Key: 'must-not-be-a-config-value' },
    })
    const credentials = fakeCredentials({
      S2_API_KEY: { configured: true, writable: true },
    })
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('')
    expect(face.hooks.scholarlyCard.getSnapshot().ncbiKey.configured).toBe(false)
    expect(face.hooks.scholarlyCard.getSnapshot().openalexKey.configured).toBe(false)
    controller.dispose()
  })

  it('stages edits, marks form dirty, and validates numeric drafts', () => {
    const scope = fakeScope({ value: { maxResults: 10 } })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const face = controller.inject()

    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(false)
    face.edit('email', 'researcher@example.edu')
    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(true)
    expect(face.hooks.scholarlyCard.getSnapshot().email.text).toBe('researcher@example.edu')

    face.edit('maxResults', 'not-a-number')
    expect(face.hooks.scholarlyCard.getSnapshot().invalid).toBe(true)
    face.edit('maxResults', '25')
    expect(face.hooks.scholarlyCard.getSnapshot().invalid).toBe(false)
    controller.dispose()
  })

  it('blocks an invalid credential reference before save', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const face = controller.inject()

    face.edit('s2ApiKeyEnv', 'not a reference')
    expect(face.hooks.scholarlyCard.getSnapshot().s2ApiKeyEnv.invalid).toBe(true)
    expect(face.hooks.scholarlyCard.getSnapshot().invalid).toBe(true)
    face.save()
    expect(scope.writes).toEqual([])
    controller.dispose()
  })

  it('saves reference edits through settings and key edits through credentials', async () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    face.edit('email', 'author@uni.edu')
    face.edit('s2ApiKeyEnv', 'S2_API_KEY')
    face.edit('s2Key', 'key-123')
    face.save()

    await vi.waitFor(() =>
      expect(credentials.writes).toEqual([{ ref: 'S2_API_KEY', value: 'key-123' }]),
    )
    expect(scope.writes).toEqual([
      { op: 'set', field: 'email', value: 'author@uni.edu' },
      { op: 'set', field: 's2ApiKeyEnv', value: 'S2_API_KEY' },
    ])
    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )
    controller.dispose()
  })

  it('drops a key draft when its reference changes', () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'OLD_KEY' } })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const face = controller.inject()

    face.edit('s2Key', 'staged-key')
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('staged-key')
    face.edit('s2ApiKeyEnv', 'NEW_KEY')
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.text).toBe('')
    controller.dispose()
  })

  it('ignores blank or whitespace secret edits on save', () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    face.edit('s2Key', '   ')
    face.save()

    expect(scope.writes).toEqual([])
    expect(credentials.writes).toEqual([])
    controller.dispose()
  })

  it('drops staged edits on discard', () => {
    const scope = fakeScope({ value: { email: 'original@edu' } })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const face = controller.inject()

    face.edit('email', 'draft@edu')
    face.discard()
    expect(face.hooks.scholarlyCard.getSnapshot().email.text).toBe('original@edu')
    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(false)
    controller.dispose()
  })

  it('resets an overridden field and mutates with unset op', () => {
    const scope = fakeScope({
      value: { email: 'custom@edu' },
      base: { email: 'default@edu' },
      user: { email: 'custom@edu' },
    })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    const face = controller.inject()

    face.resetField('email')
    face.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'email' }])
    controller.dispose()
  })
})

describe('ScholarlyFormController credential lifecycle', () => {
  it('marks an invalid committed reference and disables its key control', () => {
    const controller = new ScholarlyFormController(
      fakeScope({ value: { s2ApiKeyEnv: 'not a reference' } }),
      emptyCredentialPort,
    )
    const state = controller.inject().hooks.scholarlyCard.getSnapshot()
    expect(state.s2Key.referenceState).toBe('invalid')
    expect(state.s2Key.disabled).toBe(true)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)
    expect(screen.getAllByText(zh.invalidCredentialRef)).toHaveLength(1)
    controller.dispose()
  })

  it('disables a key control the Host reports read-only', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const readOnly: ScholarlyCredentialPort = {
      describe: async (refs) => ({
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: false }])),
      }),
      set: async () => ({ ok: true, value: undefined }) as RemoteResult<unknown>,
    }
    const controller = new ScholarlyFormController(scope, readOnly)
    const face = controller.inject()
    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().s2Key.disabled).toBe(true))
    controller.dispose()
  })

  it('ignores an invalidation for a reference the committed section does not name', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const credentials = fakeCredentials()
    const describe = vi.spyOn(credentials, 'describe')
    const controller = new ScholarlyFormController(scope, credentials)
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(1))

    controller.refreshCredential('OTHER_KEY')
    await Promise.resolve()
    expect(describe).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('refuses a key draft with no committed reference without calling the Host', async () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const set = vi.spyOn(credentials, 'set')
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()
    face.edit('s2Key', 'key-1')
    face.save()

    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().saving).toBe(false))
    expect(set).not.toHaveBeenCalled()
    expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(true)
    controller.dispose()
  })

  it('reads credentials once the settings section arrives', async () => {
    const scope = fakeScope({ status: 'loading' })
    const credentials = fakeCredentials({ S2_API_KEY: { configured: true, writable: true } })
    const describe = vi.spyOn(credentials, 'describe')
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()
    expect(describe).not.toHaveBeenCalled()

    scope.publish({ status: 'ready', value: { s2ApiKeyEnv: 'S2_API_KEY' } })

    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true),
    )
    controller.dispose()
  })

  it('does not call the credential domain while a reference draft is typed', async () => {
    const scope = fakeScope({ value: {} })
    const credentials = fakeCredentials()
    const describe = vi.spyOn(credentials, 'describe')
    const controller = new ScholarlyFormController(scope, credentials)
    const face = controller.inject()

    face.edit('s2ApiKeyEnv', 'S')
    face.edit('s2ApiKeyEnv', 'S2')
    face.edit('s2ApiKeyEnv', 'S2_API_KEY')
    expect(describe).not.toHaveBeenCalled()

    face.save()
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(1))
    controller.dispose()
  })

  it('keeps a successful key write successful when a concurrent invalidation supersedes its read', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const reads: Array<{
      resolve: (value: RemoteResult<Readonly<Record<string, ScholarlyCredentialInfo>>>) => void
    }> = []
    const port: ScholarlyCredentialPort = {
      describe: () => new Promise((resolve) => reads.push({ resolve })),
      set: async () => ({ ok: true, value: undefined }) as RemoteResult<unknown>,
    }
    const controller = new ScholarlyFormController(scope, port)
    const face = controller.inject()
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    face.edit('s2Key', 'key-1')
    face.save()
    await vi.waitFor(() => expect(reads).toHaveLength(2))

    controller.refreshCredential('S2_API_KEY')
    await vi.waitFor(() => expect(reads).toHaveLength(3))

    const answer = { S2_API_KEY: { configured: true, writable: true } }
    reads[1]!.resolve({ ok: true, value: answer })
    reads[2]!.resolve({ ok: true, value: answer })
    reads[0]!.resolve({ ok: true, value: {} })

    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().saving).toBe(false))
    expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(false)
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(true)
    controller.dispose()
  })

  it('reports a refused credential write as a failed save', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const refusing: ScholarlyCredentialPort = {
      describe: async (refs) => ({
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured: false, writable: true }])),
      }),
      set: async () => ({
        ok: false,
        error: new RemoteError('gateway/internal', 'credentials store refused the write', {}),
      }),
    }
    const controller = new ScholarlyFormController(scope, refusing)
    const face = controller.inject()
    face.edit('s2Key', 'key-1')
    face.save()

    await vi.waitFor(() => expect(face.hooks.scholarlyCard.getSnapshot().saving).toBe(false))
    expect(face.hooks.scholarlyCard.getSnapshot().failed).toBe(true)
    expect(face.hooks.scholarlyCard.getSnapshot().s2Key.configured).toBe(false)
    controller.dispose()
  })

  it('disables a key control until its committed reference is valid', () => {
    const controller = new ScholarlyFormController(fakeScope({ value: {} }), emptyCredentialPort)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    const input = screen.getByLabelText(zh.scholarlyS2Key) as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(screen.getAllByText(zh.scholarlyKeyNeedsReference)).toHaveLength(3)
    controller.dispose()
  })
})

describe('ScholarlySettingsSection', () => {
  it('renders summary copy when view is summary', () => {
    const controller = new ScholarlyFormController(fakeScope({ value: {} }), fakeCredentials())
    const { container } = render(
      <ScholarlyHarness face={controller.inject()} view="summary" dictionary={zh} />,
    )
    expect(container.textContent).toBe(zh.tabScholarlyDesc)
    controller.dispose()
  })

  it('renders English summary when locale is en', () => {
    const controller = new ScholarlyFormController(fakeScope({ value: {} }), fakeCredentials())
    const { container } = render(
      <ScholarlyHarness face={controller.inject()} view="summary" dictionary={en} />,
    )
    expect(container.textContent).toBe(en.tabScholarlyDesc)
    controller.dispose()
  })

  it('renders reference fields, key controls, and quotas in page view', () => {
    const controller = new ScholarlyFormController(
      fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } }),
      fakeCredentials({ S2_API_KEY: { configured: true, writable: true } }),
    )
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    expect(screen.getByLabelText(zh.groupScholarlyAuth)).toBeDefined()
    expect(screen.getByLabelText(zh.groupScholarlyLimits)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyEmail)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyS2ApiKeyEnv)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyNcbiApiKeyEnv)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyOpenalexApiKeyEnv)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyS2Key)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyNcbiKey)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyOpenalexKey)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyMaxResults)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyMaxContentChars)).toBeDefined()
    expect(screen.getByLabelText(zh.groupJobs)).toBeDefined()
    expect(screen.getByLabelText(zh.enableRunInBackground)).toBeDefined()
    expect(screen.getByLabelText(zh.promoteOnTimeout)).toBeDefined()
    expect(screen.getByLabelText(zh.foregroundWaitMs)).toBeDefined()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3)

    fireEvent.click(screen.getByLabelText(zh.enableRunInBackground))
    fireEvent.change(screen.getByLabelText(zh.foregroundWaitMs), { target: { value: '5000' } })
    expect((screen.getByLabelText(zh.enableRunInBackground) as HTMLInputElement).checked).toBe(true)
    controller.dispose()
  })

  it('renders the configured badge from the credential port', async () => {
    const controller = new ScholarlyFormController(
      fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } }),
      fakeCredentials({ S2_API_KEY: { configured: true, writable: true } }),
    )
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    await vi.waitFor(() => {
      // The configured state is what the field says, not an attribute: the real
      // secret field renders the localized label beside its input.
      expect(screen.getAllByText(zh.secretConfigured).length).toBeGreaterThan(0)
    })
    controller.dispose()
  })

  it('types a key, stages the draft, and writes it through the credential port on save', async () => {
    const scope = fakeScope({ value: { s2ApiKeyEnv: 'S2_API_KEY' } })
    const credentials = fakeCredentials()
    const controller = new ScholarlyFormController(scope, credentials)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    const saveBtn = screen.getByRole('button', { name: new RegExp(`^${zh.save}`) })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)

    const s2Input = screen.getByLabelText(zh.scholarlyS2Key) as HTMLInputElement
    fireEvent.change(s2Input, { target: { value: 'new-s2-key' } })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveBtn)

    await vi.waitFor(() =>
      expect(credentials.writes).toEqual([{ ref: 'S2_API_KEY', value: 'new-s2-key' }]),
    )
    expect(scope.writes).toEqual([])
    controller.dispose()
  })

  it('clicks reset on an overridden field and saves an unset op', () => {
    const scope = fakeScope({
      value: { email: 'override@edu' },
      base: { email: 'base@edu' },
      user: { email: 'override@edu' },
    })
    const controller = new ScholarlyFormController(scope, fakeCredentials())
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    fireEvent.click(screen.getByRole('button', { name: zh.reset }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
    expect(scope.writes).toEqual([{ op: 'unset', field: 'email' }])
    controller.dispose()
  })
})
