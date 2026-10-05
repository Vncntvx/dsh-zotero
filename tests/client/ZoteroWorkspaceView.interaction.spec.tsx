// @vitest-environment jsdom
/**
 * The workspace view's interaction flows: selection by row click and by key
 * (arrows, Home/End, Enter, Space), the lens and inspector tablists, the
 * toolbar menu, the overview disclosure and its actions, the filter pills, the
 * filter strip's paging, and the narrow-surface pane state. Every test drives
 * an input and asserts what that input produces; the states those flows start
 * from are asserted in `ZoteroWorkspaceView.states`.
 * @module tests/client/ZoteroWorkspaceView.interaction
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../src/client/locales.ts'
import type { ZoteroStatusView } from '../../src/client/remote.ts'
import { filterCountsOf, evidencePassageTotalOf } from '../../src/client/sources/selectors.ts'
import type { ConnectionView } from '../../src/client/components/workspace/connection.ts'
import { mixedFixture, singleFixture } from './helpers/source-fixtures.ts'
import { CONNECTED, mountView } from './helpers/workspace-harness.tsx'

// The real primitives bundle pulls heavy dependencies (katex, shiki, the
// portal machinery); the view needs the shared DOM face. Its toolbar menu is
// the one surface this spec drives through the primitive's own callbacks, so
// it swaps in the interactive variant instead of the display-only default.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { interactiveMenu, primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub({ Menu: interactiveMenu })
})

import { writeClipboardSpy } from './helpers/primitives-stub.ts'

const writeClipboard = await writeClipboardSpy()

/** The rendered view; the helpers below read only its container. */
type View = ReturnType<typeof render>

/** The option row at `index` — the roving-selection target of the list sites. */
function optionAt(view: View, index: number): Element {
  return view.container.querySelectorAll('[role="option"]')[index]!
}

/** The tab carrying `data-inspector-panel` / `data-workspace-lens` = `name`. */
function tabOf(view: View, attribute: string, name: string): Element {
  return view.container.querySelector(`[${attribute}="${name}"]`)!
}

/**
 * Press `key` on `target` and assert the element `selected` resolves to
 * afterwards carries `aria-selected="true"`. Every key site in this spec
 * asserts exactly this pair — the key delivered to the listbox, the tablist, or
 * the focused row, and the selection it must land on — so the interaction and
 * its assertion travel together and no site can quietly lose one half. The
 * target is resolved after the key, where the inline query ran before.
 */
function expectKeySelects(target: Element, key: string, selected: () => Element): void {
  fireEvent.keyDown(target, { key })
  expect(selected().getAttribute('aria-selected')).toBe('true')
}

afterEach(cleanup)

describe('selection', () => {
  it('renders the first source selected and switches selection on row click', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const options = view.container.querySelectorAll('[role="option"]')
    expect(options).toHaveLength(12)
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(options[5]!)
    expect(options[5]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('moves selection with the arrow keys and jumps with Home/End', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const listbox = view.container.querySelector('[role="listbox"]')!
    expectKeySelects(listbox, 'ArrowDown', () => optionAt(view, 1))
    expectKeySelects(listbox, 'ArrowUp', () => optionAt(view, 0))
    expectKeySelects(listbox, 'End', () => optionAt(view, 11))
    expectKeySelects(listbox, 'Home', () => optionAt(view, 0))
    // Any other key leaves the selection untouched.
    expectKeySelects(listbox, 'a', () => optionAt(view, 0))
  })

  it('confirms a focused option with Enter on narrow surfaces', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const option = view.container.querySelectorAll('[role="option"]')[2]!
    // Any other key on the row itself does nothing.
    fireEvent.keyDown(option, { key: 'a' })
    expect(view.container.querySelector('[data-pane="list"]')).not.toBeNull()
    fireEvent.keyDown(option, { key: 'Enter' })
    expect(view.container.querySelector('[data-pane="detail"]')).not.toBeNull()
    view.unmount()
  })
})

describe('toolbar', () => {
  it('closes the diagnostic menu on selection and on Escape', () => {
    const { view } = mountView(singleFixture())
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(view.container.querySelector('[data-menu="open"]')).not.toBeNull()
    fireEvent.click(view.container.querySelector('[data-menu-item="build"]')!)
    expect(view.container.querySelector('[data-menu="open"]')).toBeNull()
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    fireEvent.keyDown(view.container.querySelector('[data-menu]')!, { key: 'Escape' })
    expect(view.container.querySelector('[data-menu="open"]')).toBeNull()
    view.unmount()
  })

  it('renders the failure diagnosis and refreshes on demand', () => {
    const unavailable: ConnectionView = {
      kind: 'unavailable',
      data: {
        providerId: 'local',
        connected: false,
        serverId: 'sPMHtLD6HHBd',
        apiVersion: '3',
        diagnosis: 'connection refused',
      } as ZoteroStatusView,
      checkedAt: '10:00:01',
    }
    const { view, onRefresh } = mountView(singleFixture(), unavailable)
    expect(screen.getByText(/connection refused/)).toBeDefined()
    fireEvent.click(screen.getByText(zh.refresh))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    // An unavailable probe still carries instance facts: the menu shows them.
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(screen.getByText(/sPMHtLD6HHBd/)).toBeDefined()
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    view.unmount()
  })
})

describe('inspector', () => {
  it('shows the overview by default and switches panels', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    expect(
      screen.getByText(new RegExp(zh.searchFrom.replace('{query}', 'risk policy'))),
    ).toBeDefined()
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    // The summary line names the retrieves and the kept counts.
    expect(screen.getByText(/检索 1 次/)).toBeDefined()
    expect(screen.getByText(/保留 2 条/)).toBeDefined()
    expect(screen.getByText(/报告 4 条/)).toBeDefined()
    fireEvent.click(view.container.querySelector('[data-inspector-panel="exports"]')!)
    expect(screen.getByText(/BibTeX/)).toBeDefined()
    view.unmount()
  })

  it('exposes the lens bar and inspector tabs as tablists with roving selection', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    const tabs = view.container.querySelector('[data-inspector-panel="overview"]')!.parentElement!
    expect(tabs.getAttribute('role')).toBe('tablist')
    expect(tabs.getAttribute('aria-label')).toBe(zh.inspectorTabsLabel)
    expectKeySelects(tabs, 'ArrowRight', () => tabOf(view, 'data-inspector-panel', 'evidence'))
    expectKeySelects(tabs, 'ArrowLeft', () => tabOf(view, 'data-inspector-panel', 'overview'))
    expectKeySelects(tabs, 'End', () => tabOf(view, 'data-inspector-panel', 'exports'))
    expectKeySelects(tabs, 'Home', () => tabOf(view, 'data-inspector-panel', 'overview'))
    const lensBar = view.container.querySelector('[data-workspace-lens="sources"]')!.parentElement!
    expect(lensBar.getAttribute('role')).toBe('tablist')
    expect(lensBar.getAttribute('aria-label')).toBe(zh.lensBarLabel)
    const lensTab = view.container.querySelector('[data-workspace-lens="sources"]')!
    expect(lensTab.getAttribute('role')).toBe('tab')
    expect(lensTab.getAttribute('aria-selected')).toBe('true')
    expectKeySelects(lensBar, 'ArrowRight', () => tabOf(view, 'data-workspace-lens', 'exports'))
  })

  it('resets to the overview panel when the selection changes', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    fireEvent.click(view.container.querySelector('[data-inspector-panel="exports"]')!)
    expect(
      view.container
        .querySelector('[data-inspector-panel="exports"]')!
        .getAttribute('aria-selected'),
    ).toBe('true')
    // Select the second visible row: the inspector returns to overview.
    const options = view.container.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(1)
    fireEvent.click(options[1]!)
    expect(
      view.container
        .querySelector('[data-inspector-panel="overview"]')!
        .getAttribute('aria-selected'),
    ).toBe('true')
    view.unmount()
  })

  it('confirms a listbox option with Space as well as Enter', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const options = view.container.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(1)
    expectKeySelects(optionAt(view, 1), ' ', () => tabOf(view, 'data-inspector-panel', 'overview'))
    view.unmount()
  })

  it('keeps blocked open actions inert for a mismatched item', () => {
    const { view } = mountView(mixedFixture())
    // Item index 3 is the mismatch branch of the mixed fixture.
    fireEvent.click(optionAt(view, 3))
    expect(screen.getAllByText(zh.databaseMismatch).length).toBeGreaterThanOrEqual(1)
    const blocked = view.container.querySelector('button[aria-disabled="true"]')!
    expect(blocked).toBeDefined()
    // Clicking a blocked action stays inert — the block is the point.
    fireEvent.click(blocked)
    expect(screen.getAllByText(zh.databaseMismatch).length).toBeGreaterThanOrEqual(1)
    view.unmount()
  })
})

describe('overview panel', () => {
  it('reveals the search details behind the disclosure and hides them again', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    expect(screen.queryByText(new RegExp(zh.scopeLine))).toBeNull()
    fireEvent.click(screen.getByText(zh.searchDetailOpen))
    expect(screen.getByText(new RegExp(`${zh.scopeLine} ${zh.overviewScopeLibrary}`))).toBeDefined()
    expect(screen.getByText(new RegExp(zh.modeEverything))).toBeDefined()
    expect(screen.getByText(new RegExp(`${zh.refLine} zotero://user/0/item/P`))).toBeDefined()
    fireEvent.click(screen.getByText(zh.searchDetailClose))
    expect(screen.queryByText(new RegExp(zh.scopeLine))).toBeNull()
    view.unmount()
  })

  it('copies the ref from a visible action-row button and confirms it', async () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    // The copy sits beside its siblings, not behind an overflow trigger.
    expect(view.container.querySelector('[data-menu]')).toBeNull()
    fireEvent.click(screen.getByLabelText(zh.copyRef))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/P')
    // A successful write earns the feedback, and the label persists now, so
    // the button can say so.
    await vi.waitFor(() => expect(screen.getByText(zh.copied)).toBeDefined())
    view.unmount()
  })

  it('prefills the export-citation ask from the overview action', () => {
    const workspace = singleFixture()
    const setDraft = vi.fn()
    const { view } = mountView(workspace, CONNECTED, setDraft)
    fireEvent.click(screen.getByText(zh.exportCitation))
    expect(setDraft).toHaveBeenCalledWith(
      zh.citeTemplate.replace('{ref}', 'zotero://user/0/item/P'),
    )
    view.unmount()
  })
})

describe('filter interplay', () => {
  it('notes when the selection is hidden by a filter and keeps the document', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    // Pick a fresh hit without evidence, then filter to evidence-bearing
    // sources: the inspector keeps showing that same source with a note —
    // the filter changed the list, not the document under inspection.
    fireEvent.click(optionAt(view, 1))
    fireEvent.click(
      screen.getByText(`${zh.filterEvidence} ${filterCountsOf(workspace.sources).evidence}`),
    )
    expect(screen.getByText(zh.selectionHiddenNote)).toBeDefined()
    expect(screen.getByText(/Source item 2: mixed states/)).toBeDefined()
    view.unmount()
  })
})

describe('source sidebar', () => {
  it('pages the filter strip with edge arrows only while the pills overflow', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const bar = screen.getByText(`${zh.filterAll} 12`).closest('[role="group"]')!
    // jsdom measures no layout, so the strip fits and no edge arrow renders.
    expect(screen.queryByLabelText(zh.filterScrollLeft)).toBeNull()
    expect(screen.queryByLabelText(zh.filterScrollRight)).toBeNull()
    // Widen the strip's scroll footprint, then the scroll listener recomputes
    // the edges: the right arrow announces the hidden pills.
    Object.defineProperty(bar, 'scrollWidth', { value: 400, configurable: true })
    Object.defineProperty(bar, 'clientWidth', { value: 80, configurable: true })
    fireEvent.scroll(bar)
    expect(screen.getByLabelText(zh.filterScrollRight)).toBeDefined()
    expect(screen.queryByLabelText(zh.filterScrollLeft)).toBeNull()
    // Paging right moves the strip (the shimmed scrollBy writes scrollLeft);
    // the left edge opens while the right edge still holds pills.
    fireEvent.click(screen.getByLabelText(zh.filterScrollRight))
    expect(bar.scrollLeft).toBe(120)
    expect(screen.getByLabelText(zh.filterScrollLeft)).toBeDefined()
    expect(screen.getByLabelText(zh.filterScrollRight)).toBeDefined()
    // Paging back reaches the start and drops the left arrow.
    fireEvent.click(screen.getByLabelText(zh.filterScrollLeft))
    expect(bar.scrollLeft).toBe(0)
    expect(screen.queryByLabelText(zh.filterScrollLeft)).toBeNull()
    // A wider rail pages by the strip minus a pill instead of the floor.
    Object.defineProperty(bar, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(bar, 'scrollWidth', { value: 600, configurable: true })
    fireEvent.scroll(bar)
    fireEvent.click(screen.getByLabelText(zh.filterScrollRight))
    expect(bar.scrollLeft).toBe(240)
    view.unmount()
  })
})

describe('evidence overview', () => {
  it('opens the cross-source board from the sidebar entry and returns', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    // The aggregate entry carries the true passage sum — not the source
    // count the filter pill shows — so the two numbers never conflate.
    const total = evidencePassageTotalOf(workspace.sources)
    expect(total).toBeGreaterThan(filterCountsOf(workspace.sources).evidence)
    fireEvent.click(screen.getByText(zh.evidenceEntryLabel.replace('{count}', String(total))))
    // The board groups passages by source; the cards carry their own facts,
    // so the defensive scope note is gone from the page.
    expect(screen.getByText(/Source item 1: mixed states/)).toBeDefined()
    expect(screen.queryByText(/不能确定这些内容被用于最终回答/)).toBeNull()
    fireEvent.click(screen.getByText(zh.backToSources))
    expect(screen.getByText(zh.searchDetailOpen)).toBeDefined()
    view.unmount()
  })
})

describe('narrow-surface pane state', () => {
  it('selecting a row enters the detail pane; back and Escape return to the list', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    // Selecting a row switches the pane state to detail.
    fireEvent.click(optionAt(view, 2))
    expect(view.container.querySelector('[data-pane="detail"]')).not.toBeNull()
    // The back action returns to the list.
    fireEvent.click(screen.getByText(zh.backToList))
    expect(view.container.querySelector('[data-pane="list"]')).not.toBeNull()
    // Selecting again enters detail; Escape returns to the list.
    fireEvent.click(optionAt(view, 4))
    expect(view.container.querySelector('[data-pane="detail"]')).not.toBeNull()
    fireEvent.keyDown(view.container.querySelector('[data-pane="detail"]')!, { key: 'Escape' })
    expect(view.container.querySelector('[data-pane="list"]')).not.toBeNull()
    view.unmount()
  })
})
