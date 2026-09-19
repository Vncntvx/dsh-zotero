// @vitest-environment jsdom
/**
 * The Zotero settings page in the Settings panel's left navigation, rendered
 * through a driven fixture runtime: the test binds the controller's snapshot
 * source with useSyncExternalStore, feeds the component plain props, and drives
 * user gestures with testing-library's fireEvent. The page renders its whole
 * grouped form at once (no disclosure chrome), so no test point has to open it
 * first.
 * @module tests/client/ZoteroSettingsSection
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroSettingsSection } from '../../src/client/ZoteroSettingsSection.tsx'
import type { ZoteroSettingsSectionProps } from '../../src/client/ZoteroSettingsSection.tsx'
import { en, zh } from '../../src/client/locales.ts'
import {
  ZoteroCardController,
  type ZoteroCardFace,
  type ZoteroCardState,
} from '../../src/client/zotero-card-controller.ts'
import { fakeScope, type FakeScope } from './helpers/fake-scope.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki); the page
// only needs the pending capsule, so stub it with the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

/** The renderer's binding: a snapshot selector hook over the page's store. */
function Harness({ face, dictionary = zh }: { face: ZoteroCardFace; dictionary?: typeof zh }) {
  const state = useSyncExternalStore(
    face.hooks.zoteroCard.subscribe,
    face.hooks.zoteroCard.getSnapshot,
  )
  const props = {
    // The page resolves its copy through the locale runtime, so the fixture
    // binds the shipped dictionary with the shared translate stub.
    t: makeTranslate(dictionary),
    // The shell supplies `close`; the page never uses it, so the fixture omits it.
    useZoteroCard: (selector: (snapshot: ZoteroCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  } as unknown as ZoteroSettingsSectionProps
  return <ZoteroSettingsSection {...props} />
}

let scope: FakeScope

function mount(dictionary: typeof zh = zh): void {
  const controller = new ZoteroCardController(scope)
  render(<Harness face={controller.inject()} dictionary={dictionary} />)
}

afterEach(() => {
  // vitest runs without globals, so testing-library cannot register its own
  // auto-cleanup; without it, successive renders would accumulate in the DOM.
  cleanup()
  scope = undefined as unknown as FakeScope
})

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: zh.save })

const discardButton = (): HTMLButtonElement => screen.getByRole('button', { name: zh.discard })

describe('ZoteroSettingsSection', () => {
  it('keeps the nav entry and explains itself while the namespace is unavailable', () => {
    scope = fakeScope({ status: 'unavailable' })
    render(<Harness face={new ZoteroCardController(scope).inject()} />)
    // The left-nav label comes from the registration, so the page must not
    // vanish: it states why it is empty instead.
    expect(screen.getByText(zh.nav)).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain(zh.unavailable)
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('renders the page header, the full grouped form, and the action row', () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 } })
    mount()
    expect(screen.getByRole('heading', { name: zh.title })).toBeDefined()
    expect(screen.getByText(zh.description)).toBeDefined()
    // Every field of the namespace is on the page, with no disclosure to open
    // (now + maxChangesResults).
    expect(document.querySelectorAll('input')).toHaveLength(25)
    expect(saveButton().disabled).toBe(true)
    expect(discardButton().disabled).toBe(true)
  })

  it('renders the changes cap with the hint that says it is display-only', () => {
    scope = fakeScope({ value: { maxChangesResults: 50 } })
    mount()
    // The two strings this change reworded, rendered in place by the field:
    // the cap bounds the listing, not the read.
    expect(screen.getByLabelText(zh.maxChangesResults)).toBeDefined()
    expect(screen.getByText(zh.maxChangesResultsHint)).toBeDefined()
  })

  it('renders the same field from the English dictionary', () => {
    scope = fakeScope({ value: { maxChangesResults: 50 } })
    mount(en)
    expect(screen.getByLabelText(en.maxChangesResults)).toBeDefined()
    expect(screen.getByText(en.maxChangesResultsHint)).toBeDefined()
  })

  it('marks the page as unsaved while a draft is staged', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    expect(screen.queryByText(zh.unsaved)).toBeNull()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    expect(screen.getByText(zh.unsaved)).toBeDefined()
    fireEvent.click(discardButton())
    expect(screen.queryByText(zh.unsaved)).toBeNull()
  })

  it('toggles the web tab and saves the boolean write from the action row', async () => {
    scope = fakeScope({ value: { webEnabled: true } })
    mount()
    const toggle = screen.getByLabelText(zh.webEnabled) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: false }]),
    )
  })

  it('toggles webEnabled on from an absent value and saves true', async () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api' } })
    mount()
    const toggle = screen.getByLabelText(zh.webEnabled) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: true }]),
    )
  })

  it('rejects an invalid numeric draft and blocks the save', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: 'abc' } })
    expect(timeout.getAttribute('aria-invalid')).toBe('true')
    // Official invalid face: always `css.input`; border rides
    // `[aria-invalid='true']`, not a second class.
    expect(timeout.className).toMatch(/input/)
    expect(timeout.className).not.toMatch(/inputInvalid/)
    expect(screen.getByText(zh.invalidNumber)).toBeDefined()
    expect(saveButton().disabled).toBe(true)
  })

  it('edits a field and saves every staged write', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'timeoutMs', value: 9000 }]),
    )
  })

  it('shows no override marker on the web toggle even when the user layer holds it', () => {
    scope = fakeScope({
      value: { webEnabled: false },
      base: { webEnabled: true },
      user: { webEnabled: false },
    })
    mount()
    // The toggle's own state is its undo: no badge, no reset, no marker row.
    expect(screen.queryByText(zh.overridden)).toBeNull()
    expect(screen.queryByText(zh.reset)).toBeNull()
  })

  it('resets an overridden value field back to the base from the action row', async () => {
    scope = fakeScope({
      value: { timeoutMs: 5000 },
      base: { timeoutMs: 7000 },
      user: { timeoutMs: 5000 },
    })
    mount()
    fireEvent.click(screen.getByText(zh.reset))
    fireEvent.click(saveButton())
    await vi.waitFor(() => expect(scope.writes).toEqual([{ op: 'unset', field: 'timeoutMs' }]))
  })

  it('discard drops the staged draft without writing', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(discardButton())
    expect(scope.writes).toEqual([])
    expect(timeout.value).toBe('5000')
    expect(saveButton().disabled).toBe(true)
  })

  it('keeps the draft and reports failure when the write is refused', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, rejectWrites: true })
    mount()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await screen.findByText(zh.saveFailed)
    expect(timeout.value).toBe('9000')
    // The draft survives so the user can correct it.
    expect(saveButton().disabled).toBe(false)
  })

  it('disables every control while the document is read-only', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, writable: false })
    mount()
    expect(screen.getByText(zh.readOnly)).toBeDefined()
    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect(input.disabled).toBe(true)
    }
    expect(saveButton().disabled).toBe(true)
    expect(discardButton().disabled).toBe(true)
  })
})
