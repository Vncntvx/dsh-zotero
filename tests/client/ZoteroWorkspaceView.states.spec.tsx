// @vitest-environment jsdom
/**
 * The workspace view's render states: the toolbar's connected note and
 * diagnostic menu facts, the inspector panels (counts, the retrieved/never
 * retrieved onboards, the passage facts, the exports note) and the sidebar and
 * lens entries for a given workspace. Each test mounts a fixture and asserts
 * what that state renders; the flows that change a state under a click or a key
 * live in `ZoteroWorkspaceView.interaction`.
 * @module tests/client/ZoteroWorkspaceView.states
 */

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../src/client/locales.ts'
import {
  artifactOf,
  mixedFixture,
  passageOf,
  repeatedRetrieveFixture,
  searchOf,
  singleFixture,
  workspaceOf,
  zeroMatchFixture,
} from './helpers/source-fixtures.ts'
import { mountView } from './helpers/workspace-harness.tsx'
import type { ConnectionView } from '../../src/client/components/workspace/connection.ts'
import type { ZoteroStatusView } from '../../src/client/remote.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki, the
// portal machinery); the view needs the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(cleanup)

describe('toolbar', () => {
  it('shows the connected note and the diagnostic menu facts', () => {
    const { view } = mountView(singleFixture())
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    // The answering build is named, so a version-scoped expectation has
    // something to check against.
    expect(screen.getByText(/Zotero 版本 10\.0\.2-beta\.9/)).toBeDefined()
    expect(screen.getByText(/sPMHtLD6HHBd/)).toBeDefined()
    expect(screen.getByText(/上次检查 10:00:00/)).toBeDefined()
    // The default connected fixture wires no write capability, so the menu
    // carries no write row.
    expect(screen.queryByText(new RegExp(zh.writeLabel))).toBeNull()
    view.unmount()
  })

  it('shows the write state when the Remote status carries the write block', () => {
    const connection: ConnectionView = {
      kind: 'connected',
      data: {
        providerId: 'local',
        connected: true,
        apiVersion: '3',
        serverId: 'sPMHtLD6HHBd',
        write: { enabled: true, authorized: false },
        diagnosis: 'ok',
      } as ZoteroStatusView,
      checkedAt: '10:00:00',
    }
    const { view } = mountView(singleFixture(), connection)
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    expect(
      screen.getByText(new RegExp(`${zh.writeLabel}.*${zh.writeUnauthorizedLabel}`)),
    ).toBeDefined()
    view.unmount()
  })
})

describe('inspector', () => {
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
})

describe('overview panel', () => {
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
})

describe('evidence overview', () => {
  it('hides the entry when only one source carries passages', () => {
    // One evidence-bearing source reads better in its own detail rows; the
    // comparative board exists for weighing several papers at once.
    const { view } = mountView(singleFixture())
    expect(
      screen.queryByText(new RegExp(zh.evidenceEntryLabel.replace('{count}', '\\d+'))),
    ).toBeNull()
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

describe('exports lens count', () => {
  it('counts distinct exported documents across calls and formats', () => {
    const REF = 'zotero://user/0/item/QRST3456'
    const { view } = mountView(
      workspaceOf([], {
        exports: [
          artifactOf({ callId: 'e1', refs: [REF], settledAt: 1000 }),
          artifactOf({ callId: 'e2', refs: [REF], settledAt: 2000 }),
          artifactOf({
            callId: 'e3',
            format: 'ris',
            refs: [REF],
            settledAt: 3000,
            items: undefined,
          }),
        ],
      }),
    )
    // Three export calls of the same document — the lens tab reads 1.
    expect(view.container.querySelector('[data-workspace-lens="exports"]')!.textContent).toContain(
      '1',
    )
    view.unmount()
  })

  it('counts distinct documents, not the formats they were exported as', () => {
    const { view } = mountView(
      workspaceOf([], {
        exports: [
          artifactOf({ callId: 'e1', refs: ['zotero://user/0/item/QRST3456'] }),
          artifactOf({ callId: 'e2', refs: ['zotero://user/0/item/AAAA1111'] }),
        ],
      }),
    )
    expect(view.container.querySelector('[data-workspace-lens="exports"]')!.textContent).toContain(
      '2',
    )
    view.unmount()
  })
})
