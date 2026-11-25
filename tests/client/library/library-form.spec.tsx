// @vitest-environment jsdom
/**
 * Test suite for the library settings form and row configuration section
 * (plugins.row.config) for the dsh-zotero#library component.
 * @module tests/client/library/library-form
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { CitationFormController } from '../../../src/client/citation-form-controller.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ScholarlyCredentialPort } from '../../../src/client/scholarly-form-controller.ts'
import { deferred } from '../../helpers/sync.ts'
import {
  LibrarySettingsSection,
  type LibrarySettingsSectionProps,
} from '../../../src/client/LibrarySettingsSection.tsx'
import {
  LibraryFormController,
  type LibraryCardFace,
  type LibraryCardState,
} from '../../../src/client/library-form-controller.ts'
import { en, zh } from '../../../src/client/locales.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

function LibraryHarness({
  face,
  view = 'page',
  dictionary = zh,
}: {
  face: LibraryCardFace
  view?: 'summary' | 'page'
  dictionary?: typeof zh
}) {
  const [citationController] = useState(() => new CitationFormController(fakeScope()))
  useEffect(() => () => citationController.dispose(), [citationController])
  const citation = citationController.inject()
  const citationState = useSyncExternalStore(
    citation.hooks.citationCard.subscribe,
    citation.hooks.citationCard.getSnapshot,
  )
  const state = useSyncExternalStore(
    face.hooks.libraryCard.subscribe,
    face.hooks.libraryCard.getSnapshot,
  )
  const props = {
    view,
    citation,
    useCitationCard: (selector: (snapshot: typeof citationState) => unknown) =>
      selector(citationState),
    t: makeTranslate(dictionary),
    useLibraryCard: (selector: (snapshot: LibraryCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  } as unknown as LibrarySettingsSectionProps
  return <LibrarySettingsSection {...props} />
}

describe('LibrarySettingsSection', () => {
  it('renders summary copy when view is summary', () => {
    const scope = fakeScope({ value: {} })
    const controller = new LibraryFormController(scope)
    const { container } = render(
      <LibraryHarness face={controller.inject()} view="summary" dictionary={zh} />,
    )
    expect(container.textContent).toBe(zh.tabLibraryDesc)
    controller.dispose()
  })

  it('renders English summary when locale is en', () => {
    const scope = fakeScope({ value: {} })
    const controller = new LibraryFormController(scope)
    const { container } = render(
      <LibraryHarness face={controller.inject()} view="summary" dictionary={en} />,
    )
    expect(container.textContent).toBe(en.tabLibraryDesc)
    controller.dispose()
  })

  it('renders the library sidebar checkbox in page view', () => {
    const scope = fakeScope({
      value: {
        rightSidebarEnabled: true,
      },
    })
    const controller = new LibraryFormController(scope)
    render(<LibraryHarness face={controller.inject()} view="page" dictionary={zh} />)

    expect(screen.getByLabelText(zh.libraryDisplaySettings)).toBeDefined()
    expect(screen.getByText(zh.rightSidebarEnabled)).toBeDefined()

    expect(
      screen.getByRole('checkbox', { name: zh.rightSidebarEnabled, checked: true }),
    ).toBeTruthy()

    controller.dispose()
  })

  it('toggles the checkbox, edits model state, and saves writes to scope', async () => {
    const scope = fakeScope({
      value: {
        rightSidebarEnabled: true,
      },
    })
    const controller = new LibraryFormController(scope)
    render(<LibraryHarness face={controller.inject()} view="page" dictionary={zh} />)

    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes[0]).toBeDefined()

    // Toggle rightSidebarEnabled
    fireEvent.click(checkboxes[0]!)
    expect(checkboxes[0]?.checked).toBe(false)

    // Click save button
    const panelSave = screen
      .getAllByRole('button', { name: zh.save })
      .find((button) => !button.hasAttribute('disabled'))!
    fireEvent.click(panelSave)

    await Promise.resolve()
    expect(scope.writes).toEqual([{ op: 'set', field: 'rightSidebarEnabled', value: false }])

    controller.dispose()
  })

  it('renders the overridden reset button and resets the field when clicked', () => {
    const scope = fakeScope({
      value: {
        rightSidebarEnabled: false,
      },
      user: {
        rightSidebarEnabled: false,
      },
    })
    const controller = new LibraryFormController(scope)
    render(<LibraryHarness face={controller.inject()} view="page" dictionary={zh} />)

    const resetButtons = screen.getAllByRole('button', { name: new RegExp(`^${zh.reset}:`) })
    expect(resetButtons.length).toBe(1)

    fireEvent.click(resetButtons[0]!)

    const snapshot = controller.inject().hooks.libraryCard.getSnapshot()
    expect(snapshot.rightSidebarEnabled.overridden).toBe(false)

    controller.dispose()
  })
})

describe('LibraryFormController', () => {
  it('projects field states, staged edits, and reset capability', () => {
    const scope = fakeScope({
      value: {
        rightSidebarEnabled: false,
      },
      user: {
        rightSidebarEnabled: false,
      },
    })
    const controller = new LibraryFormController(scope)
    const face = controller.inject()

    let snapshot = face.hooks.libraryCard.getSnapshot()
    expect(snapshot.rightSidebarEnabled.text).toBe('false')
    expect(snapshot.rightSidebarEnabled.overridden).toBe(true)

    // Edit rightSidebarEnabled
    face.edit('rightSidebarEnabled', 'true')
    snapshot = face.hooks.libraryCard.getSnapshot()
    expect(snapshot.rightSidebarEnabled.text).toBe('true')
    expect(snapshot.dirty).toBe(true)

    // Discard
    face.discard()
    snapshot = face.hooks.libraryCard.getSnapshot()
    expect(snapshot.rightSidebarEnabled.text).toBe('false')
    expect(snapshot.dirty).toBe(false)

    // Reset overridden field
    face.resetField('rightSidebarEnabled')
    expect(face.hooks.libraryCard.getSnapshot().rightSidebarEnabled.overridden).toBe(false)
    face.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'rightSidebarEnabled' }])

    controller.dispose()
  })
})

it('saves journal detail fields in settings order after reverse selection', async () => {
  const scope = fakeScope({ value: { journalMetricsEnabled: true, journalMetricDetailFields: [] } })
  const controller = new LibraryFormController(scope)
  const face = controller.inject()
  try {
    render(<LibraryHarness face={face} />)
    fireEvent.click(screen.getByRole('checkbox', { name: zh['journalMetric.pku'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh['journalMetric.sci'] }))
    face.save()
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([
        { op: 'set', field: 'journalMetricDetailFields', value: ['sci', 'pku'] },
      ]),
    )
  } finally {
    controller.dispose()
  }
})

it('keeps a refused key draft and retries it through the credential port only', async () => {
  const scope = fakeScope({ value: {} })
  const ref = 'EASYSCHOLAR_SECRET_KEY'
  let configured = false
  const set = vi.fn<ScholarlyCredentialPort['set']>(async () => {
    configured = true
    return { ok: true as const, value: undefined }
  })
  const refused = deferred<{ ok: false; error: RemoteError<'gateway/internal'> }>()
  set.mockImplementationOnce(() => refused.promise)
  const controller = new LibraryFormController(scope, {
    describe: async () => ({ ok: true, value: { [ref]: { configured, writable: true } } }),
    set,
  })
  const face = controller.inject()
  const { getSnapshot } = face.hooks.libraryCard
  try {
    face.edit('journalMetricsEnabled', 'true')
    face.edit('easyScholarSecret', 'test-key')
    face.save()
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith(ref, 'test-key'))
    refused.resolve({ ok: false, error: new RemoteError('gateway/internal', 'refused', {}) })
    await vi.waitFor(() => expect(getSnapshot().saving).toBe(false))
    expect(getSnapshot().easyScholarSecret).toMatchObject({ text: 'test-key', configured: false })
    face.save()
    await vi.waitFor(() =>
      expect(getSnapshot().easyScholarSecret).toMatchObject({ text: '', configured: true }),
    )
    expect(set).toHaveBeenCalledTimes(2)
    expect(scope.writes).toEqual([{ op: 'set', field: 'journalMetricsEnabled', value: true }])
  } finally {
    controller.dispose()
  }
})

it('discards late credential metadata after the host changes the active reference', async () => {
  const scope = fakeScope({ value: { easyScholarSecretKeyRef: 'ORIGINAL_KEY' } })
  const stale = deferred<Awaited<ReturnType<ScholarlyCredentialPort['describe']>>>()
  const describe = vi.fn<ScholarlyCredentialPort['describe']>()
  describe.mockReturnValueOnce(stale.promise).mockRejectedValue(new Error('unavailable'))
  const controller = new LibraryFormController(scope, {
    describe,
    set: vi.fn<ScholarlyCredentialPort['set']>(),
  })
  const face = controller.inject()
  try {
    scope.publish({ value: { easyScholarSecretKeyRef: 'CURRENT_KEY' } })
    await controller.refreshCredential('CURRENT_KEY')
    stale.resolve({ ok: true, value: { ORIGINAL_KEY: { configured: true, writable: true } } })
    await stale.promise
    await Promise.resolve()
    expect(describe.mock.calls.map(([refs]) => refs)).toEqual([
      ['ORIGINAL_KEY'],
      ['CURRENT_KEY'],
      ['CURRENT_KEY'],
    ])
    expect(face.hooks.libraryCard.getSnapshot().easyScholarSecret.configured).toBe(false)
  } finally {
    controller.dispose()
  }
})

it.each([
  ['easyScholarSecretKeyRef', 'contains space'],
  ['journalMetricListOrder', '["sci","sciif"]'],
  ['journalMetricDetailFields', '["sci","sci"]'],
] as const)('keeps invalid %s drafts out of the host settings', async (field, value) => {
  const scope = fakeScope({ value: {} })
  const controller = new LibraryFormController(scope)
  const face = controller.inject()
  try {
    face.edit(field, value)
    await face.save()
    expect(face.hooks.libraryCard.getSnapshot()[field].invalid).toBe(true)
    expect(scope.writes).toEqual([])
  } finally {
    controller.dispose()
  }
})
