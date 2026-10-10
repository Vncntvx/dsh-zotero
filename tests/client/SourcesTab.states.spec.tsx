// @vitest-environment jsdom
/**
 * The SourcesTab render states: the connectivity strip's faces (checking, the
 * connected note with its diagnostic facts, the carrier and rejection
 * failures, a probe that never settles, a missing status face), the populated
 * sources default with its counts, omitted-rows note and mismatch marking, the
 * honest evidence/exports placeholders, and the empty state. Every test mounts
 * and asserts what the state renders; the probe and filter flows that change a
 * state under test live in `SourcesTab.interaction`.
 * @module tests/client/SourcesTab.states
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesTab, type SourcesTabProps } from '../../src/client/components/SourcesTab.tsx'
import { zh } from '../../src/client/locales.ts'
import { preparing, running, settled } from './helpers/blocks.ts'
import {
  CONNECTED,
  chatOf,
  connectedProbe,
  exportOf,
  mountTab,
  searchResult,
  sessionOf,
  toolRow,
} from './helpers/sources-tab-harness.tsx'

// The real primitives bundle pulls heavy dependencies (katex, shiki, the
// portal machinery); the tab only needs the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

afterEach(cleanup)

describe('connectivity strip states', () => {
  it('renders the checking strip, then the connected note and the diagnostic facts', async () => {
    const status = connectedProbe()
    const { view } = mountTab(chatOf(), status)
    expect(screen.getByText(zh.checking)).toBeDefined()
    await act(async () => {})
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    // The diagnostic facts live in the toolbar menu (portal mode).
    fireEvent.click(screen.getByLabelText(zh.detailsLabel))
    await act(async () => {})
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    expect(screen.getByText(/Schema 版本 37/)).toBeDefined()
    expect(screen.getByText(/sPMHtLD6HHBd/)).toBeDefined()
    view.unmount()
  })

  it('skips the probe when no status face is injected', async () => {
    // The whole-props cast keeps this test blind to the merged
    // PropsRuntime surface: upstream merges stop breaking it.
    const props = {
      t,
      status: undefined,
      useSession: (sel: (snap: SessionSnapshot) => unknown) => sel(sessionOf()),
      useChat: (sel: (snap: ChatSnapshot) => unknown) => sel(chatOf()),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)
    await act(async () => {})
    expect(screen.getByText(zh.noSources)).toBeDefined()
    view.unmount()
  })

  it('never settles state for an aborted probe', async () => {
    let resolveProbe: (value: { ok: boolean; value?: unknown }) => void = () => {}
    const status = vi.fn(
      () =>
        new Promise<{ ok: boolean; value?: unknown }>((resolve) => {
          resolveProbe = resolve
        }),
    )
    const { view } = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.checking)).toBeDefined()
    view.unmount()
    await act(async () => {
      resolveProbe({ ok: true, value: CONNECTED })
    })
  })

  it('renders carrier failures', async () => {
    const status = vi.fn(async () => ({
      ok: false,
      error: { code: 'x', message: 'gateway offline', details: {} },
    }))
    const { view } = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.getByText('诊断: gateway offline')).toBeDefined()
    view.unmount()
  })

  it('renders a rejected probe as a remote error instead of staying on loading', async () => {
    const status = vi.fn(async () => {
      throw new Error('remote face unmounted')
    })
    const { view } = mountTab(chatOf(), status)
    expect(screen.getByText(zh.checking)).toBeDefined()
    await act(async () => {})
    expect(screen.getByText('诊断: remote face unmounted')).toBeDefined()
    view.unmount()
  })

  it('renders a non-Error rejection message too', async () => {
    const status = vi.fn(async () => {
      throw 'remote face unmounted'
    })
    const { view } = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.getByText('诊断: remote face unmounted')).toBeDefined()
    view.unmount()
  })

  it('drops a rejected probe that unmounts before the rejection settles', async () => {
    let rejectProbe: (error: Error) => void = () => {}
    const status = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectProbe = reject
        }),
    )
    const { view } = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.checking)).toBeDefined()
    view.unmount()
    // The abort wins over the late rejection: no state update, no unhandled
    // rejection from the probe's catch.
    await act(async () => {
      rejectProbe(new Error('late rejection'))
    })
  })
})

describe('sources states', () => {
  it('opens on the sources lens and keeps every search hit when one was inspected', async () => {
    const status = connectedProbe()
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ref: `zotero://user/0/item/AAAAAAA${index}`,
      title: `Paper ${index}`,
      creatorSummary: 'Creator',
      year: 2020,
      itemType: 'journalArticle',
    }))
    const search = settled({
      seq: 3,
      callId: 's1',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      meta: { returned: 20, total: 20, displayed: 20, omitted: 0, items: rows },
    })
    const get = settled({
      seq: 4,
      callId: 'g1',
      call: { name: 'zotero_get', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA0"}' },
      meta: { title: 'Paper 0', creators: 'Creator', notesPreview: [], annotationsPreview: [] },
    })
    const { view } = mountTab(chatOf([toolRow(search), toolRow(get)]), status)
    await act(async () => {})
    const lensTab = view.container.querySelector('[data-workspace-lens="sources"]')!
    expect(lensTab.getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelectorAll('[data-evidence-match]')).toHaveLength(20)
    // The workflow stats strip is gone; the filter bar is the only count line.
    expect(screen.getByText(`${zh.filterAll} 20`)).toBeDefined()
    view.unmount()
  })

  it('marks a source from another instance and notes omitted rows', async () => {
    const status = connectedProbe()
    const foreign = settled({
      seq: 3,
      callId: 's1',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      meta: {
        returned: 2,
        total: 7,
        displayed: 2,
        omitted: 5,
        items: [
          {
            ref: 'zotero://user/0/item/AAAAAAA1?server=S1',
            title: 'Foreign',
            creatorSummary: 'Creator',
            itemType: 'journalArticle',
          },
          {
            ref: 'zotero://user/0/item/AAAAAAA2',
            title: 'Local',
            creatorSummary: 'Creator',
            itemType: 'journalArticle',
          },
        ],
      },
    })
    const { view } = mountTab(chatOf([toolRow(foreign)]), status)
    await act(async () => {})
    expect(screen.getByText(zh.omittedRowsNote.replace('{count}', '5'))).toBeDefined()
    // The mismatch row carries the issues badge; the selected inspector shows
    // the warning line for the first (mismatched) source.
    expect(screen.getAllByText(zh.databaseMismatch).length).toBeGreaterThanOrEqual(1)
    const row = view.container.querySelector('[data-evidence-match="mismatch"]')!
    fireEvent.click(row)
    expect(screen.getAllByText(zh.databaseMismatch).length).toBeGreaterThanOrEqual(2)
    view.unmount()
  })

  it('shows honest placeholders on the inspector evidence panel and the exports lens', async () => {
    const status = connectedProbe()
    const { view } = mountTab(chatOf([toolRow(searchResult())]), status)
    await act(async () => {})
    // A search hit that was never retrieved onboards instead of claiming a
    // retrieval that did not happen.
    fireEvent.click(view.container.querySelector('[data-inspector-panel="evidence"]')!)
    expect(screen.getByText(zh.evidenceNotRetrieved)).toBeDefined()
    // The exports lens is a top-level tab.
    fireEvent.click(view.container.querySelector('[data-workspace-lens="exports"]')!)
    expect(screen.getByText(zh.exportsEmptyNote)).toBeDefined()
    view.unmount()
  })

  it('shows the honest sources empty note and hides zero-count filters', async () => {
    const status = connectedProbe()
    const failedSearch = settled({
      seq: 3,
      callId: 's1',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_INVALID_ARGUMENT' },
    })
    const { view } = mountTab(chatOf([toolRow(failedSearch)]), status)
    await act(async () => {})
    expect(screen.getByText(zh.noSources)).toBeDefined()
    view.unmount()

    const filtered = mountTab(chatOf([toolRow(searchResult())]), status)
    await act(async () => {})
    // Zero-count filters are not rendered at all, so an empty filter state
    // is never actively reachable.
    expect(screen.queryByText(`${zh.filterExported} 0`)).toBeNull()
    expect(screen.queryByText(`${zh.filterIssues} 0`)).toBeNull()
    expect(screen.queryByText(zh.filterEmptyNote)).toBeNull()
    filtered.view.unmount()
  })

  it('carries the exported count on the filter pill, the badge, and the exports tab', async () => {
    const status = connectedProbe()
    const exportCall = exportOf()
    const { view } = mountTab(chatOf([toolRow(searchResult()), toolRow(exportCall)]), status)
    await act(async () => {})
    // The workflow header is gone; the filter pill, the row badge, and the
    // exports tab count are the count surfaces.
    expect(screen.getAllByText(`${zh.filterExported} 1`).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.exportBadge.replace('{count}', '1'))).toBeDefined()
    expect(view.container.querySelector('[data-workspace-lens="exports"]')!.textContent).toContain(
      '1',
    )
    view.unmount()
  })

  it('subscribes with the zotero signature as its equality gate', () => {
    // The panel hands the signature function to the chat hook as the equality
    // comparator, so a streaming publication keeps the previous snapshot (no
    // rebuild), while a phase or order change replaces it.
    let eq: ((a: ChatSnapshot | undefined, b: ChatSnapshot | undefined) => boolean) | undefined
    const base = chatOf([
      toolRow(settled({ seq: 3, callId: 'a' })),
      toolRow(running({ callId: 'b' })),
    ])
    const streamed = chatOf([
      toolRow(settled({ seq: 3, callId: 'a' })),
      { kind: 'assistant', anchorSeq: 4 } as ChatConversationViewNode,
      toolRow(running({ callId: 'b', argsRaw: '{"query":"a longer streamed prefix"}' })),
    ])
    const phaseMoved = chatOf([
      toolRow(settled({ seq: 3, callId: 'a' })),
      toolRow(preparing({ callId: 'b' })),
    ])
    mountTab(base, connectedProbe(), undefined, undefined, {
      onChatEquality: (given) => (eq = given),
    })
    expect(eq).toBeDefined()
    expect(eq!(base, streamed)).toBe(true)
    expect(eq!(base, phaseMoved)).toBe(false)
  })

  it('renders the sources list with a fallback key when the session id is missing', async () => {
    const status = connectedProbe()
    const { view } = mountTab(
      chatOf([toolRow(searchResult())]),
      status,
      undefined,
      sessionOf({ sessionId: undefined as never }),
    )
    await act(async () => {})
    expect(screen.getByText(`${zh.filterAll} 1`)).toBeDefined()
    view.unmount()
  })
})
