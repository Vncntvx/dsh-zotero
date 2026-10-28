// @vitest-environment jsdom
/**
 * Test suite for the library settings form and row configuration section
 * (plugins.row.config) for the dsh-zotero#library component.
 * @module tests/client/library-form
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LibrarySettingsSection,
  type LibrarySettingsSectionProps,
} from '../../src/client/LibrarySettingsSection.tsx'
import {
  LibraryFormController,
  type LibraryCardFace,
  type LibraryCardState,
} from '../../src/client/library-form-controller.ts'
import { en, zh } from '../../src/client/locales.ts'
import { fakeScope } from './helpers/fake-scope.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

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
  const state = useSyncExternalStore(
    face.hooks.libraryCard.subscribe,
    face.hooks.libraryCard.getSnapshot,
  )
  const props = {
    view,
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

    expect(screen.getByLabelText(zh.groupLibrarySidebar)).toBeDefined()
    expect(screen.getByText(zh.rightSidebarEnabled)).toBeDefined()

    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes.length).toBe(1)
    expect(checkboxes[0]?.checked).toBe(true)

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
    const saveBtn = screen.getByRole('button', { name: zh.save })
    fireEvent.click(saveBtn)

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

    const resetButtons = screen.getAllByRole('button', { name: zh.reset })
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
