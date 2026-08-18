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
  filterLineOf,
  modeLabelOf,
  scopeLabelOf,
} from '../../src/client/components/workspace/SourceOverview.tsx'
import {
  ZoteroWorkspaceView,
  effectiveSelectionOf,
  initialSelectionOf,
  type SelectionState,
} from '../../src/client/components/workspace/ZoteroWorkspaceView.tsx'
import {
  mixedFixture,
  passageOf,
  repeatedRetrieveFixture,
  searchOf,
  singleFixture,
  zeroMatchFixture,
} from './helpers/source-fixtures.ts'

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
    // The menu mock keeps the primitive's contract: item rows invoke
    // onSelect, Escape invokes onClose — so the components' own callbacks
    // stay exercised without the real portal.
    Menu: ({
      anchor,
      items,
      open,
      onSelect,
      onClose,
    }: {
      anchor?: unknown
      items?: Array<{ id: string; label?: unknown }>
      open?: boolean
      onSelect?: (id: string) => void
      onClose?: () => void
    }) =>
      createElement(
        'div',
        {
          'data-menu': open === true ? 'open' : undefined,
          onKeyDown: (event: { key: string }) => {
            if (event.key === 'Escape') onClose?.()
          },
        },
        anchor as never,
        open === true
          ? items?.map((item) =>
              createElement(
                'span',
                {
                  key: item.id,
                  'data-menu-item': item.id,
                  onClick: () => {
                    onSelect?.(item.id)
                  },
                },
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

const { writeClipboard } = vi.mocked(
  await vi.importMock<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(
    '@deepseek-ai/dsh-client-ui-primitives',
  ),
)

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
  setDraft: ((text: string) => void) | undefined = undefined,
) {
  const onRefresh = vi.fn()
  const view = render(
    <ZoteroWorkspaceView
      workspace={workspace}
      connection={connection}
      sessionId="s1"
      setDraft={setDraft}
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
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(
      view.container.querySelectorAll('[role="option"]')[0]!.getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(listbox, { key: 'End' })
    expect(
      view.container.querySelectorAll('[role="option"]')[11]!.getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(listbox, { key: 'Home' })
    expect(
      view.container.querySelectorAll('[role="option"]')[0]!.getAttribute('aria-selected'),
    ).toBe('true')
    // Any other key leaves the selection untouched.
    fireEvent.keyDown(listbox, { key: 'a' })
    expect(
      view.container.querySelectorAll('[role="option"]')[0]!.getAttribute('aria-selected'),
    ).toBe('true')
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
  it('shows the connected note and the diagnostic menu facts', () => {
    const { view } = mountView(singleFixture())
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    expect(screen.getByText(/sPMHtLD6HHBd/)).toBeDefined()
    expect(screen.getByText(/上次检查 10:00:00/)).toBeDefined()
    view.unmount()
  })

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

  it('carries the passages and exports counts on the panel tabs', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    const evidenceTab = view.container.querySelector('[data-inspector-panel="evidence"]')!
    expect(evidenceTab.textContent).toContain(String(workspace.sources[0]!.evidence.length))
    view.unmount()
  })

  it('onboards an item whose content was never retrieved', () => {
    const workspace = singleFixture()
    const bare = {
      ...workspace,
      sources: workspace.sources.map((item) => ({ ...item, retrievalFacts: undefined })),
    }
    const { view } = mountView(bare)
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(zh.evidenceNotRetrieved)).toBeDefined()
    // No retrieval happened, so there is no summary or availability to show.
    expect(screen.queryByText(/检索 \d+ 次/)).toBeNull()
    expect(screen.queryByText(zh.availabilityTitle)).toBeNull()
    view.unmount()
  })

  it('shows the truncated summary for repeated retrieves', () => {
    const { view } = mountView(repeatedRetrieveFixture())
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(/检索 3 次/)).toBeDefined()
    expect(screen.getByText(new RegExp(zh.budgetLimitedNote))).toBeDefined()
    view.unmount()
  })

  it('hides the zero-count filters instead of disabling them', () => {
    const workspace = mixedFixture()
    const bare = {
      ...workspace,
      sources: workspace.sources.map((item) => ({
        ...item,
        exports: [],
        facts: { ...item.facts, exportCount: 0 },
      })),
    }
    const { view } = mountView(bare)
    // A filter with nothing to show is not rendered at all; the counts that
    // exist stay visible with their numbers.
    expect(screen.queryByText(`${zh.filterExported} 0`)).toBeNull()
    expect(screen.getByText(`${zh.filterAll} 12`)).toBeDefined()
    view.unmount()
  })

  it('renders the passage facts: page labels, truncation, multi-retrieve dedup', () => {
    const workspace = singleFixture()
    const rich = {
      ...workspace,
      sources: workspace.sources.map((item) => ({
        ...item,
        evidence: [
          passageOf({
            pageLabel: '7',
            previewTruncated: true,
            text: 'An annotated passage that was cut.',
          }),
          passageOf({ callIds: ['call-1', 'call-2'] }),
        ],
        retrievalFacts: {
          ...item.retrievalFacts!,
          coverage: { indexedPages: 5, totalPages: 10, complete: false },
        },
      })),
    }
    const { view } = mountView(rich)
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(zh.pageLabel.replace('{label}', '7'))).toBeDefined()
    expect(screen.getByText(new RegExp(zh.truncatedPreview))).toBeDefined()
    expect(screen.getByText(zh.retrievedMultiple.replace('{count}', '2'))).toBeDefined()
    expect(screen.getByText(new RegExp(zh.coverageLabel))).toBeDefined()
    view.unmount()
  })

  it('shows the retrieved-but-none note for a retrieve that matched nothing', () => {
    const { view } = mountView(zeroMatchFixture())
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    // A zero-match retrieve has facts but no summary line was kept.
    expect(screen.getByText(zh.evidenceRetrievedNone)).toBeDefined()
    expect(screen.queryByText(/检索 \d+ 次/)).toBeNull()
    view.unmount()
  })

  it('reports passages that were reported but not previewed', () => {
    const workspace = singleFixture()
    const reported = {
      ...workspace,
      sources: workspace.sources.map((item) => ({
        ...item,
        evidence: [],
        facts: { ...item.facts, evidenceCount: 0, reportedEvidenceCount: 5 },
        retrievalFacts: {
          ...item.retrievalFacts!,
          truncated: true,
          sourceAvailability: {},
        },
      })),
    }
    const { view } = mountView(reported)
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(zh.evidenceReportedNoPreview.replace('{count}', '5'))).toBeDefined()
    // No availability entries: the section is absent entirely.
    expect(screen.queryByText(zh.availabilityTitle)).toBeNull()
    view.unmount()
  })

  it('notes an item without any exports on the exports panel', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    // Item index 1 is a fresh hit with no exports.
    fireEvent.click(view.container.querySelectorAll('[role="option"]')[1]!)
    fireEvent.click(view.container.querySelector('[data-inspector-panel="exports"]')!)
    expect(screen.getByText(zh.exportsEmptyNote)).toBeDefined()
    view.unmount()
  })

  it('keeps blocked open actions inert for a mismatched item', () => {
    const { view } = mountView(mixedFixture())
    // Item index 3 is the mismatch branch of the mixed fixture.
    fireEvent.click(view.container.querySelectorAll('[role="option"]')[3]!)
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(1)
    const blocked = view.container.querySelector('button[aria-disabled="true"]')!
    expect(blocked).toBeDefined()
    // Clicking a blocked action stays inert — the block is the point.
    fireEvent.click(blocked)
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(1)
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

  it('lists the episode filters and a browse search without a query', () => {
    const workspace = singleFixture()
    const browse = {
      ...workspace,
      sources: workspace.sources.map((item) => ({
        ...item,
        searches: [
          searchOf({
            query: undefined,
            itemTypes: ['journalArticle'],
            tags: ['hot'],
          }),
        ],
      })),
    }
    const { view } = mountView(browse)
    expect(screen.getByText(zh.searchFromBrowse)).toBeDefined()
    fireEvent.click(screen.getByText(zh.searchDetailOpen))
    expect(screen.getByText(new RegExp(`${zh.filterLine} journalArticle · hot`))).toBeDefined()
    view.unmount()
  })

  it('states direct reference for an item no search surfaced', () => {
    const workspace = singleFixture()
    const direct = {
      ...workspace,
      sources: workspace.sources.map((item) => ({ ...item, searches: [] })),
    }
    const { view } = mountView(direct)
    expect(screen.getByText(zh.overviewNoSearch)).toBeDefined()
    view.unmount()
  })

  it('copies the ref from the ··· overflow menu and closes it on Escape', () => {
    const workspace = singleFixture()
    const { view } = mountView(workspace)
    fireEvent.click(screen.getByLabelText(zh.moreActions))
    expect(view.container.querySelector('[data-menu="open"]')).not.toBeNull()
    fireEvent.keyDown(view.container.querySelector('[data-menu]')!, { key: 'Escape' })
    expect(view.container.querySelector('[data-menu="open"]')).toBeNull()
    fireEvent.click(screen.getByLabelText(zh.moreActions))
    fireEvent.click(view.container.querySelector('[data-menu-item="copyRef"]')!)
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/P')
    expect(view.container.querySelector('[data-menu="open"]')).toBeNull()
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

describe('overview label helpers', () => {
  it('labels every scope kind, preferring the name then the ref', () => {
    expect(scopeLabelOf({ kind: 'library' }, t)).toBe(zh.overviewScopeLibrary)
    expect(scopeLabelOf({ kind: 'collection', name: 'Reading' }, t)).toBe('Reading')
    expect(scopeLabelOf({ kind: 'collection', ref: 'zotero://user/0/collections/C' }, t)).toBe(
      'zotero://user/0/collections/C',
    )
    expect(scopeLabelOf({ kind: 'collection' }, t)).toBe(zh.overviewScopeCollection)
    expect(scopeLabelOf({ kind: 'savedSearch', name: 'Since 2020' }, t)).toBe('Since 2020')
    expect(scopeLabelOf({ kind: 'savedSearch', ref: 'zotero://user/0/searches/S' }, t)).toBe(
      'zotero://user/0/searches/S',
    )
    expect(scopeLabelOf({ kind: 'savedSearch' }, t)).toBe(zh.overviewScopeSavedSearch)
  })

  it('joins the episode filters and names both search modes', () => {
    expect(filterLineOf(['journalArticle'], ['hot'], t)).toBe('journalArticle · hot')
    expect(filterLineOf([], [], t)).toBe('')
    expect(modeLabelOf('metadata', t)).toBe(zh.modeMetadata)
    expect(modeLabelOf('everything', t)).toBe(zh.modeEverything)
  })
})

describe('filter interplay', () => {
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

describe('evidence overview', () => {
  it('opens the cross-source board from the sidebar entry and returns', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const entry = screen.getByText(
      zh.evidenceEntryLabel.replace('{count}', String(filterCountsOf(workspace.sources).evidence)),
    )
    fireEvent.click(entry)
    // The board groups passages by source; the scope note explains the limits.
    expect(screen.getByText(zh.evidenceScopeNote)).toBeDefined()
    fireEvent.click(screen.getByText(zh.backToSources))
    expect(screen.getByText(zh.searchDetailOpen)).toBeDefined()
    view.unmount()
  })

  it('hides the entry when no source carries passages', () => {
    const workspace = singleFixture()
    const bare = {
      ...workspace,
      sources: workspace.sources.map((item) => ({
        ...item,
        evidence: [],
        facts: { ...item.facts, evidenceCount: 0 },
      })),
    }
    const { view } = mountView(bare)
    expect(
      screen.queryByText(new RegExp(zh.evidenceEntryLabel.replace('{count}', '\\d+'))),
    ).toBeNull()
    view.unmount()
  })
})

describe('narrow-surface pane state', () => {
  it('selecting a row enters the detail pane; back and Escape return to the list', () => {
    const workspace = mixedFixture()
    const { view } = mountView(workspace)
    const options = view.container.querySelectorAll('[role="option"]')
    // Selecting a row switches the pane state to detail.
    fireEvent.click(options[2]!)
    expect(view.container.querySelector('[data-pane="detail"]')).not.toBeNull()
    // The back action returns to the list.
    fireEvent.click(screen.getByText(zh.backToList))
    expect(view.container.querySelector('[data-pane="list"]')).not.toBeNull()
    // Selecting again enters detail; Escape returns to the list.
    fireEvent.click(view.container.querySelectorAll('[role="option"]')[4]!)
    expect(view.container.querySelector('[data-pane="detail"]')).not.toBeNull()
    fireEvent.keyDown(view.container.querySelector('[data-pane="detail"]')!, { key: 'Escape' })
    expect(view.container.querySelector('[data-pane="list"]')).not.toBeNull()
    view.unmount()
  })
})
