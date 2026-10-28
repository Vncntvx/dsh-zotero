// @vitest-environment jsdom
/**
 * The Scholarly form controller, its settings form component, and the
 * dedicated row configuration section.
 * @module tests/client/settings/scholarly-form
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ScholarlyFormController,
  type ScholarlyCardFace,
  type ScholarlyCardState,
} from '../../../src/client/scholarly-form-controller.ts'
import {
  ScholarlySettingsSection,
  type ScholarlySettingsSectionProps,
} from '../../../src/client/ScholarlySettingsSection.tsx'
import { en, zh } from '../../../src/client/locales.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

afterEach(() => {
  cleanup()
})

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
  it('projects initial state from empty scope with unconfigured secrets', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()
    const snapshot = face.hooks.scholarlyCard.getSnapshot()

    expect(snapshot.available).toBe(true)
    expect(snapshot.writable).toBe(true)
    expect(snapshot.dirty).toBe(false)
    expect(snapshot.email.text).toBe('')
    expect(snapshot.s2Key.configured).toBe(false)
    expect(snapshot.ncbiKey.configured).toBe(false)
    expect(snapshot.openalexKey.configured).toBe(false)
    controller.dispose()
  })

  it('marks secrets as configured when present in scope value or user overlay', () => {
    const scope = fakeScope({
      value: { s2Key: 's2-secret-val' },
      user: { openalexKey: 'openalex-secret-val' },
    })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()
    const snapshot = face.hooks.scholarlyCard.getSnapshot()

    expect(snapshot.s2Key.configured).toBe(true)
    expect(snapshot.s2Key.text).toBe('')
    expect(snapshot.ncbiKey.configured).toBe(false)
    expect(snapshot.openalexKey.configured).toBe(true)
    expect(snapshot.openalexKey.text).toBe('')
    controller.dispose()
  })

  it('stages edits, marks form dirty, and validates numeric drafts', () => {
    const scope = fakeScope({ value: { maxResults: 10 } })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()

    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(false)
    face.edit('email', 'researcher@example.edu')
    expect(face.hooks.scholarlyCard.getSnapshot().dirty).toBe(true)
    expect(face.hooks.scholarlyCard.getSnapshot().email.text).toBe('researcher@example.edu')

    face.edit('maxResults', 'not-a-number')
    expect(face.hooks.scholarlyCard.getSnapshot().invalid).toBe(true)
    expect(face.hooks.scholarlyCard.getSnapshot().maxResults.invalid).toBe(true)

    face.edit('maxResults', '25')
    expect(face.hooks.scholarlyCard.getSnapshot().invalid).toBe(false)

    controller.dispose()
  })

  it('mutates scope with set ops when saved', async () => {
    const scope = fakeScope({ value: { email: '' } })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()

    face.edit('email', 'author@uni.edu')
    face.edit('maxResults', '30')
    face.save()

    expect(scope.writes).toEqual([
      { op: 'set', field: 'email', value: 'author@uni.edu' },
      { op: 'set', field: 'maxResults', value: 30 },
    ])
    controller.dispose()
  })

  it('drops staged edits on discard', () => {
    const scope = fakeScope({ value: { email: 'original@edu' } })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()

    face.edit('email', 'draft@edu')
    expect(face.hooks.scholarlyCard.getSnapshot().email.text).toBe('draft@edu')
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
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()

    face.resetField('email')
    face.save()

    expect(scope.writes).toEqual([{ op: 'unset', field: 'email' }])
    controller.dispose()
  })

  it('ignores blank or whitespace secret edits on save', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope)
    const face = controller.inject()

    face.edit('s2Key', '   ')
    face.save()

    expect(scope.writes).toEqual([])
    controller.dispose()
  })
})

describe('ScholarlySettingsSection', () => {
  it('renders summary copy when view is summary', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope)
    const { container } = render(
      <ScholarlyHarness face={controller.inject()} view="summary" dictionary={zh} />,
    )
    expect(container.textContent).toBe(zh.tabScholarlyDesc)
    controller.dispose()
  })

  it('renders English summary when locale is en', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope)
    const { container } = render(
      <ScholarlyHarness face={controller.inject()} view="summary" dictionary={en} />,
    )
    expect(container.textContent).toBe(en.tabScholarlyDesc)
    controller.dispose()
  })

  it('renders both groups and all Scholarly fields in page view', () => {
    const scope = fakeScope({
      value: {
        email: 'test@domain.org',
        s2Key: 'key-123',
        maxResults: 20,
      },
    })
    const controller = new ScholarlyFormController(scope)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.getByLabelText(zh.groupScholarlyAuth)).toBeDefined()
    expect(screen.getByLabelText(zh.groupScholarlyLimits)).toBeDefined()

    expect(screen.getByLabelText(zh.scholarlyEmail)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyS2Key)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyNcbiKey)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyOpenalexKey)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyMaxResults)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyMaxContentChars)).toBeDefined()

    // The component's presence is the authorization, so this form has no
    // enablement field at all: email, three keys, and two limits. The three
    // keys are masked.
    expect(document.querySelectorAll('input')).toHaveLength(6)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3)

    controller.dispose()
  })

  it('renders configured badge status on secret fields', () => {
    const scope = fakeScope({
      value: {
        s2Key: 'configured-secret',
      },
    })
    const controller = new ScholarlyFormController(scope)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    const s2SecretField = document.querySelector('[data-secret-field="scholarly-settings-s2Key"]')
    expect(s2SecretField).toBeDefined()
    const s2Badge = s2SecretField?.querySelector('[data-configured]')
    expect(s2Badge?.getAttribute('data-configured')).toBe('true')
    expect(s2Badge?.textContent).toBe(zh.secretConfigured)

    const ncbiSecretField = document.querySelector(
      '[data-secret-field="scholarly-settings-ncbiKey"]',
    )
    const ncbiBadge = ncbiSecretField?.querySelector('[data-configured]')
    expect(ncbiBadge?.getAttribute('data-configured')).toBe('false')
    expect(ncbiBadge?.textContent).toBe(zh.secretNotConfigured)

    controller.dispose()
  })

  it('types in secret field, stages draft, and enables save button', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ScholarlyFormController(scope)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    const saveBtn = screen.getByRole('button', {
      name: new RegExp(`^${zh.save}`),
    }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)

    const s2Input = screen.getByLabelText(zh.scholarlyS2Key) as HTMLInputElement
    fireEvent.change(s2Input, { target: { value: 'new-s2-key' } })

    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)

    expect(scope.writes).toEqual([{ op: 'set', field: 's2Key', value: 'new-s2-key' }])

    controller.dispose()
  })

  it('clicks reset button on an overridden field in ScholarlySettingsSection', () => {
    const scope = fakeScope({
      value: { email: 'override@edu' },
      base: { email: 'base@edu' },
      user: { email: 'override@edu' },
    })
    const controller = new ScholarlyFormController(scope)
    render(<ScholarlyHarness face={controller.inject()} view="page" dictionary={zh} />)

    const resetBtn = screen.getByRole('button', { name: zh.reset })
    fireEvent.click(resetBtn)
    const saveBtn = screen.getByRole('button', { name: new RegExp(`^${zh.save}`) })
    fireEvent.click(saveBtn)

    expect(scope.writes).toEqual([{ op: 'unset', field: 'email' }])
    controller.dispose()
  })
})
