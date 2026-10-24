// @vitest-environment jsdom
/**
 * The Zotero configuration page (the plugin manager's `plugins.bundle.config`
 * slot), rendered through a driven fixture runtime: the test binds the
 * controller's snapshot source with useSyncExternalStore, feeds the component
 * plain props, and drives user gestures with testing-library's fireEvent. The
 * page renders its whole grouped form at once (no disclosure chrome), so no
 * test point has to open it first.
 * @module tests/client/ZoteroSettingsSection
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroSettingsSection } from '../../src/client/ZoteroSettingsSection.tsx'
import type { ZoteroSettingsSectionProps } from '../../src/client/ZoteroSettingsSection.tsx'
import { ZoteroSettingsForm } from '../../src/client/ZoteroSettingsForm.tsx'
import { en, zh } from '../../src/client/locales.ts'
import {
  FIELD_GROUPS,
  ZoteroCardController,
  type ZoteroCardFace,
  type ZoteroCardState,
} from '../../src/client/zotero-card-controller.ts'
import {
  ScholarlyFormController,
  type ScholarlyCardFace,
  type ScholarlyCardState,
} from '../../src/client/scholarly-form-controller.ts'
import { fakeScope, type FakeScope } from './helpers/fake-scope.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki); the page
// only needs the pending capsule, so stub it with the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

/** The renderer's binding: a snapshot selector hook over the page's store. */
function Harness({
  face,
  scholarlyFace,
  dictionary = zh,
}: {
  face: ZoteroCardFace
  scholarlyFace?: ScholarlyCardFace
  dictionary?: typeof zh
}) {
  const state = useSyncExternalStore(
    face.hooks.zoteroCard.subscribe,
    face.hooks.zoteroCard.getSnapshot,
  )
  const scholarlyState = useSyncExternalStore(
    scholarlyFace ? scholarlyFace.hooks.scholarlyCard.subscribe : () => () => {},
    scholarlyFace ? scholarlyFace.hooks.scholarlyCard.getSnapshot : () => undefined as any,
  )
  const props = {
    // `plugins.bundle.config` renders its entries with `view: 'page'` only.
    view: 'page',
    // The page resolves its copy through the locale runtime, so the fixture
    // binds the shipped dictionary with the shared translate stub.
    t: makeTranslate(dictionary),
    // The shell supplies `close`; the page never uses it, so the fixture omits it.
    useZoteroCard: (selector: (snapshot: ZoteroCardState) => unknown) => selector(state),
    useScholarlyCard: scholarlyFace
      ? (selector: (snapshot: ScholarlyCardState) => unknown) => selector(scholarlyState)
      : undefined,
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
    scholarly: scholarlyFace,
  } as unknown as ZoteroSettingsSectionProps
  return <ZoteroSettingsSection {...props} />
}

let scope: FakeScope

function mount(dictionary: typeof zh = zh, scholarlyFace?: ScholarlyCardFace): void {
  const controller = new ZoteroCardController(scope)
  render(
    <Harness face={controller.inject()} scholarlyFace={scholarlyFace} dictionary={dictionary} />,
  )
}

afterEach(() => {
  // vitest runs without globals, so testing-library cannot register its own
  // auto-cleanup; without it, successive renders would accumulate in the DOM.
  cleanup()
  scope = undefined as unknown as FakeScope
})

/** The save control, whose label becomes `saving` while a save is in flight. */
const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: new RegExp(`^(?:${zh.save}|${zh.saving})`) })

describe('ZoteroSettingsSection', () => {
  it('explains itself while the namespace is unavailable', () => {
    scope = fakeScope({ status: 'unavailable' })
    render(<Harness face={new ZoteroCardController(scope).inject()} />)
    expect(screen.getByRole('status').textContent).toContain(zh.unavailable)
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('renders the full grouped form and the official save control', () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 } })
    mount()
    // Every field of the namespace is on the page, with no disclosure to open:
    // one control per field table row (numeric/text inputs and boolean
    // checkboxes alike). The count derives from that table, so a field added
    // or dropped fails here instead of silently changing the page.
    expect([...document.querySelectorAll('input')]).toHaveLength(
      FIELD_GROUPS.flatMap((group) => group.fields).length,
    )
    expect(saveButton().disabled).toBe(true)
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

  it('toggles the web tab and saves the boolean write from the official save control', async () => {
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
    // The invalid face is behavioral (aria-invalid plus the invalid copy),
    // not a second input class: the stub carries no stylesheet.
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

  it('disables every field while a save is crossing the wire', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    const original = scope.mutate.bind(scope)
    scope.mutate = async (ops, expectedRevision) => {
      await pending
      return original(ops, expectedRevision)
    }
    mount()
    fireEvent.change(document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement, {
      target: { value: '9000' },
    })
    fireEvent.click(saveButton())
    await vi.waitFor(() => {
      for (const input of document.querySelectorAll('input')) {
        expect((input as HTMLInputElement).disabled).toBe(true)
      }
      expect(saveButton().disabled).toBe(true)
    })
    release()
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'timeoutMs', value: 9000 }]),
    )
  })

  it('marks the web toggle overridden like every other field', () => {
    scope = fakeScope({
      value: { webEnabled: false },
      base: { webEnabled: true },
      user: { webEnabled: false },
    })
    mount()
    // Presence in the user layer marks the override: the toggle carries the
    // same badge and reset as every other field.
    expect(screen.getByText(zh.overridden)).toBeDefined()
    expect(screen.getByText(zh.reset)).toBeDefined()
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

  it('discards the staged draft when the page unmounts', () => {
    // The official `<SettingsForm>` discards on unmount: leaving the page is
    // the discard, so the staged draft never outlives the section.
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    const handle = render(<Harness face={new ZoteroCardController(scope).inject()} />)
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    handle.unmount()
    expect(scope.writes).toEqual([])
    mount()
    const fresh = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    expect(fresh.value).toBe('5000')
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
  })

  it('renders SegmentedTabs with all 5 tabs and features as default selected tab', () => {
    scope = fakeScope({ value: {} })
    mount()

    const tabList = screen.getByRole('tablist', { name: zh.configTabsLabel })
    expect(tabList).toBeDefined()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      zh.tabFeatures,
      zh.tabConnection,
      zh.tabSearch,
      zh.tabScholarly,
      zh.tabAdvanced,
    ])

    const featuresTab = screen.getByRole('tab', { name: zh.tabFeatures })
    expect(featuresTab.getAttribute('aria-selected')).toBe('true')
    expect(featuresTab.getAttribute('aria-controls')).toBe('zotero-panel-features')

    const featuresPanel = document.getElementById('zotero-panel-features')
    expect(featuresPanel?.getAttribute('hidden')).toBeNull()

    const connectionPanel = document.getElementById('zotero-panel-connection')
    expect(connectionPanel?.getAttribute('hidden')).toBe('')
  })

  it('switches active tab on click, toggling aria-selected and hidden attribute on panels', () => {
    scope = fakeScope({ value: {} })
    mount()

    const connectionTab = screen.getByRole('tab', { name: zh.tabConnection })
    fireEvent.click(connectionTab)

    expect(connectionTab.getAttribute('aria-selected')).toBe('true')
    const featuresTab = screen.getByRole('tab', { name: zh.tabFeatures })
    expect(featuresTab.getAttribute('aria-selected')).toBe('false')

    const connectionPanel = document.getElementById('zotero-panel-connection')
    expect(connectionPanel?.getAttribute('hidden')).toBeNull()
    const featuresPanel = document.getElementById('zotero-panel-features')
    expect(featuresPanel?.getAttribute('hidden')).toBe('')

    const scholarlyTab = screen.getByRole('tab', { name: zh.tabScholarly })
    fireEvent.click(scholarlyTab)
    expect(scholarlyTab.getAttribute('aria-selected')).toBe('true')
    const scholarlyPanel = document.getElementById('zotero-panel-scholarly')
    expect(scholarlyPanel?.getAttribute('hidden')).toBeNull()

    const advancedTab = screen.getByRole('tab', { name: zh.tabAdvanced })
    fireEvent.click(advancedTab)
    expect(advancedTab.getAttribute('aria-selected')).toBe('true')
    const advancedPanel = document.getElementById('zotero-panel-advanced')
    expect(advancedPanel?.getAttribute('hidden')).toBeNull()
  })

  it('explains the disabled scholarly component instead of offering its fields', () => {
    scope = fakeScope({ value: {} })
    mount()
    fireEvent.click(screen.getByRole('tab', { name: zh.tabScholarly }))
    expect(screen.getByText(zh.scholarlyDisabled)).toBeDefined()
    expect(screen.queryByLabelText(zh.scholarlyEmail)).toBeNull()
  })

  it('explains the disabled component when the scholarly namespace is not served', () => {
    scope = fakeScope({ value: {} })
    const scholarlyController = new ScholarlyFormController(fakeScope({ status: 'unavailable' }))
    mount(zh, scholarlyController.inject())
    fireEvent.click(screen.getByRole('tab', { name: zh.tabScholarly }))
    expect(screen.getByText(zh.scholarlyDisabled)).toBeDefined()
    expect(screen.queryByText(zh.unavailable)).toBeNull()
    expect(screen.queryByLabelText(zh.scholarlyEmail)).toBeNull()
    scholarlyController.dispose()
  })

  it('renders scholarly controls on Tab 4 when scholarly card is provided', () => {
    scope = fakeScope({ value: {} })
    const scholarlyScope = fakeScope({
      value: { email: 'scholar@example.com', maxResults: 15 },
    })
    const scholarlyController = new ScholarlyFormController(scholarlyScope)
    mount(zh, scholarlyController.inject())

    const scholarlyTab = screen.getByRole('tab', { name: zh.tabScholarly })
    fireEvent.click(scholarlyTab)

    expect(screen.getByLabelText(zh.scholarlyEmail)).toBeDefined()
    expect(screen.getByLabelText(zh.scholarlyMaxResults)).toBeDefined()
    expect((screen.getByLabelText(zh.scholarlyEmail) as HTMLInputElement).value).toBe(
      'scholar@example.com',
    )
    scholarlyController.dispose()
  })

  it('preserves uncommitted edits across tab transitions without unmount-discard', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    const scholarlyScope = fakeScope({ value: { email: 'initial@example.com' } })
    const scholarlyController = new ScholarlyFormController(scholarlyScope)
    mount(zh, scholarlyController.inject())

    // 1. Edit a Zotero field on Tab 2 (Connection)
    const connectionTab = screen.getByRole('tab', { name: zh.tabConnection })
    fireEvent.click(connectionTab)
    const timeoutInput = screen.getByLabelText(zh.timeoutMs) as HTMLInputElement
    fireEvent.change(timeoutInput, { target: { value: '9999' } })
    expect(timeoutInput.value).toBe('9999')

    // 2. Switch to Tab 4 (Scholarly) and edit a Scholarly field
    const scholarlyTab = screen.getByRole('tab', { name: zh.tabScholarly })
    fireEvent.click(scholarlyTab)
    const emailInput = screen.getByLabelText(zh.scholarlyEmail) as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'updated@example.com' } })
    expect(emailInput.value).toBe('updated@example.com')

    // 3. Switch back to Tab 2 (Connection) - Zotero edit must be preserved!
    fireEvent.click(connectionTab)
    const timeoutInputAgain = screen.getByLabelText(zh.timeoutMs) as HTMLInputElement
    expect(timeoutInputAgain.value).toBe('9999')

    // 4. Switch back to Tab 4 (Scholarly) - Scholarly edit must be preserved!
    fireEvent.click(scholarlyTab)
    const emailInputAgain = screen.getByLabelText(zh.scholarlyEmail) as HTMLInputElement
    expect(emailInputAgain.value).toBe('updated@example.com')

    scholarlyController.dispose()
  })

  it('renders structured group headers with titles and descriptions across groups', () => {
    scope = fakeScope({ value: {} })
    mount()

    expect(screen.getByText(zh.groupWeb)).toBeDefined()
    expect(screen.getByText(zh.groupWebDesc)).toBeDefined()
    expect(screen.getByText(zh.groupWrite)).toBeDefined()
    expect(screen.getByText(zh.groupWriteDesc)).toBeDefined()
    expect(screen.getByText(zh.groupDefaults)).toBeDefined()
    expect(screen.getByText(zh.groupDefaultsDesc)).toBeDefined()
    expect(screen.getByText(zh.groupConnection)).toBeDefined()
    expect(screen.getByText(zh.groupConnectionDesc)).toBeDefined()
    expect(screen.getByText(zh.groupSearchQuery)).toBeDefined()
    expect(screen.getByText(zh.groupSearchQueryDesc)).toBeDefined()
    expect(screen.getByText(zh.groupSearchEvidence)).toBeDefined()
    expect(screen.getByText(zh.groupSearchEvidenceDesc)).toBeDefined()
    expect(screen.getByText(zh.groupOutput)).toBeDefined()
    expect(screen.getByText(zh.groupOutputDesc)).toBeDefined()
    expect(screen.getByText(zh.groupJobs)).toBeDefined()
    expect(screen.getByText(zh.groupJobsDesc)).toBeDefined()
    expect(screen.getByText(zh.groupDiagnostics)).toBeDefined()
    expect(screen.getByText(zh.groupDiagnosticsDesc)).toBeDefined()
  })

  it('fires onTabChange callback when controlled tab changes', () => {
    const onTabChange = vi.fn()
    scope = fakeScope({ value: {} })
    const controller = new ZoteroCardController(scope)
    const face = controller.inject()
    const state = face.hooks.zoteroCard.getSnapshot()

    render(
      <ZoteroSettingsForm
        t={makeTranslate(zh)}
        state={state}
        actions={face}
        activeTab="features"
        onTabChange={onTabChange}
      />,
    )

    const searchTab = screen.getByRole('tab', { name: zh.tabSearch })
    fireEvent.click(searchTab)
    expect(onTabChange).toHaveBeenCalledWith('search')

    controller.dispose()
  })

  it('switches internal tab when uncontrolled (no onTabChange)', () => {
    scope = fakeScope({ value: {} })
    const controller = new ZoteroCardController(scope)
    const face = controller.inject()
    const state = face.hooks.zoteroCard.getSnapshot()

    render(<ZoteroSettingsForm t={makeTranslate(zh)} state={state} actions={face} />)

    const searchTab = screen.getByRole('tab', { name: zh.tabSearch })
    fireEvent.click(searchTab)
    expect(screen.getByText(zh.groupSearchQuery)).toBeDefined()

    controller.dispose()
  })
})
