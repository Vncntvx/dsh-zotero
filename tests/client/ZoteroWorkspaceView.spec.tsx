// @vitest-environment jsdom
/**
 * The workspace view: fixture-driven presentation — selection defaults and
 * keyboard movement, filter interplay, the toolbar's diagnostic menu, and
 * the inspector's overview/evidence/exports panels. Rendered from the
 * deterministic fixtures, so no session or live Zotero is involved.
 * @module tests/client/ZoteroWorkspaceView
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import type { ZoteroStatusView } from '../../src/client/remote.ts'
import { filterCountsOf } from '../../src/client/sources/selectors.ts'
import type { ConnectionView } from '../../src/client/components/workspace/connection.ts'
import {
  ZoteroWorkspaceView,
  effectiveSelectionOf,
  initialSelectionOf,
  type SelectionState,
} from '../../src/client/components/workspace/ZoteroWorkspaceView.tsx'
import { mixedFixture, repeatedRetrieveFixture, singleFixture } from './helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement('span', { 'data-icon': name, ...props })
  return {
    StateDot: ({ state }: { state: string }) => createElement('span', { 'data-dot': state }),
    Pill: ({
      active,
      children,
      ...rest
    }: {
      active?: boolean
      children?: unknown
      [key: string]: unknown
    }) =>
      createElement(
        'button',
        { 'data-pill': active === true ? 'active' : undefined, ...rest },
        children as never,
      ),
    Menu: ({
      anchor,
      items,
      open,
    }: {
      anchor?: unknown
      items?: Array<{ id: string; label?: unknown }>
      open?: boolean
    }) =>
      createElement(
        'div',
        { 'data-menu': open === true ? 'open' : undefined },
        anchor as never,
        open === true
          ? items?.map((item) =>
              createElement(
                'span',
                { key: item.id, 'data-menu-item': item.id },
                item.label as never,
              ),
            )
          : undefined,
      ),
    IconChevronDownOutline14: icon('chevron-down'),
    IconBrowseOutline16: icon('browse'),
    writeClipboard: vi.fn(async () => true),
    Tooltip: ({ children }: { children: React.ReactElement }) => children,
  }
})

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

const CONNECTED: ConnectionView = {
  kind: 'connected',
  data: {
    providerId: 'local',
    connected: true,
    apiVersion: '3',
    schemaVersion: '37',
    serverId: 'sPMHtLD6HHBd',
    diagnosis: 'ok',
  } as ZoteroStatusView,
  checkedAt: '10:00:00',
}

function mountView(
  workspace: ReturnType<typeof singleFixture>,
  connection: ConnectionView = CONNECTED,
) {
  const onRefresh = vi.fn()
  const view = render(
    <ZoteroWorkspaceView
      workspace={workspace}
      connection={connection}
      sessionId="s1"
      onRefresh={onRefresh}
      t={t}
    />,
  )
  return { view, onRefresh }
}

afterEach(cleanup)

describe('selection', () => {
  it('defaults to the first visible source', () => {
    const workspace = mixedFixture()
    expect(initialSelectionOf(workspace.sources)).toEqual({
      key: workspace.sources[0]!.key,
      focusIndex: 0,
    })
    expect(initialSelectionOf([])).toEqual({ key: undefined, focusIndex: 0 })
  })

  it('keeps a hidden selection when a filter hides it, falling back to the first visible', () => {
    const workspace = mixedFixture()
    const visible = workspace.sources.slice(0, 3)
    const selection: SelectionState = { key: visible[2]!.key, focusIndex: 2 }
    expect(effectiveSelectionOf(selection, visible)).toBe(visible[2]!.key)
    // A selection outside the visible rows falls back to the first visible.
    expect(
      effectiveSelectionOf({ key: 'zotero://user/0/item/ZZZZZZZZ', focusIndex: 0 }, visible),
    ).toBe(visible[0]!.key)
  })

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
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(
      view.container.querySelectorAll('[role="option"]')[1]!.getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(listbox, { key: 'End' })
    expect(
      view.container.querySelectorAll('[role="option"]')[11]!.getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(listbox, { key: 'Home' })
    expect(
      view.container.querySelectorAll('[role="option"]')[0]!.getAttribute('aria-selected'),
    ).toBe('true')
  })
})

describe('toolbar', () => {
  it('shows the connected note and the diagnostic menu facts', () => {
    const { view } = mountView(singleFixture())
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    expect(screen.getByText(/sPMHtLD6HHBd/)).toBeDefined()
    expect(screen.getByText(/上次检查 10:00:00/)).toBeDefined()
    view.unmount()
  })

  it('renders the failure diagnosis and refreshes on demand', () => {
    const unavailable: ConnectionView = {
      kind: 'unavailable',
      data: {
        providerId: 'local',
        connected: false,
        diagnosis: 'connection refused',
      } as ZoteroStatusView,
      checkedAt: '10:00:01',
    }
    const { view, onRefresh } = mountView(singleFixture(), unavailable)
    expect(screen.getByText(/connection refused/)).toBeDefined()
    fireEvent.click(screen.getByText(zh.refresh))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})

describe('inspector', () => {
  it('shows the overview by default and switches panels', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    expect(screen.getByText(zh.fromSearches)).toBeDefined()
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    // The summary line names the retrieves and the kept counts.
    expect(screen.getByText(/检索 1 次/)).toBeDefined()
    expect(screen.getByText(/保留 2 条/)).toBeDefined()
    expect(screen.getByText(/报告 4 条/)).toBeDefined()
    fireEvent.click(view.container.querySelector('[data-inspector-panel="exports"]')!)
    expect(screen.getByText(/bibtex/)).toBeDefined()
    view.unmount()
  })

  it('shows the truncated summary for repeated retrieves', () => {
    const { view } = mountView(repeatedRetrieveFixture())
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(/检索 3 次/)).toBeDefined()
    expect(screen.getByText(new RegExp(zh.budgetLimitedNote))).toBeDefined()
    view.unmount()
  })

  it('notes when the selection is hidden by a filter', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    // Pick a fresh hit without evidence, then filter to evidence-bearing
    // sources: the inspector keeps the hidden selection with a note.
    const options = view.container.querySelectorAll('[role="option"]')
    fireEvent.click(options[1]!)
    fireEvent.click(
      screen.getByText(`${zh.filterEvidence} ${filterCountsOf(workspace.sources).evidence}`),
    )
    expect(screen.getByText(zh.selectionHiddenNote)).toBeDefined()
    view.unmount()
  })
})
