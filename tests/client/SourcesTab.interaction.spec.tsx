// @vitest-environment jsdom
/**
 * The SourcesTab interaction flows: the refresh re-probe and its effect on the
 * verified instance id, the filter pills (apply, activate, recover from an
 * empty result, reset on a session switch), the inspector actions that prefill
 * the composer, and the empty-state starters. Each test drives an input and
 * asserts the output that input produces; the states those flows start from are
 * asserted in `SourcesTab.states`.
 * @module tests/client/SourcesTab.interaction
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesTab, type SourcesTabProps } from '../../src/client/components/SourcesTab.tsx'
import { zh } from '../../src/client/locales.ts'
import { settled } from './helpers/blocks.ts'
import {
  CONNECTED,
  UNAVAILABLE,
  chatOf,
  connectedProbe,
  exportOf,
  mountTab,
  retrieveOf,
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

/** The rendered tab; the filter helper below reads only its container. */
type View = ReturnType<typeof render>

/** The filter pill button carrying `label`; the same text also badges rows. */
function pillOf(label: string): HTMLElement {
  return screen.getAllByText(label).find((element) => element.tagName === 'BUTTON')!
}

/**
 * Click the filter pill carrying `label` and assert it ends up the active one —
 * the pill click and its assertion together, so a call site names only the pill.
 */
function expectPillActivated(label: string): void {
  fireEvent.click(pillOf(label))
  expect(pillOf(label).getAttribute('data-pill')).toBe('active')
}

/**
 * Click the filter pill carrying `label` and assert how many sources it leaves
 * visible — the filter click and its row-count assertion together.
 */
function expectFilteredTo(view: View, label: string, count: number): void {
  fireEvent.click(screen.getByText(label))
  expect(view.container.querySelectorAll('[data-evidence-match]')).toHaveLength(count)
}

afterEach(cleanup)

describe('connectivity', () => {
  it('shows the diagnosis for an unavailable Zotero and a refresh re-probes', async () => {
    const status = vi
      .fn(async () => ({ ok: true, value: CONNECTED }))
      .mockResolvedValueOnce({ ok: true, value: UNAVAILABLE })
    const { view } = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.statusUnavailable)).toBeDefined()
    expect(screen.getByText(/connection refused/)).toBeDefined()
    fireEvent.click(screen.getByText(zh.refresh))
    await act(async () => {})
    expect(status).toHaveBeenCalledTimes(2)
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    view.unmount()
  })

  it('clears the verified server id when the probe stops confirming it', async () => {
    const status = vi
      .fn(async () => ({ ok: true, value: CONNECTED }))
      .mockResolvedValueOnce({ ok: true, value: CONNECTED })
      .mockResolvedValueOnce({ ok: true, value: UNAVAILABLE })
    const foreign = settled({
      seq: 3,
      callId: 's1',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      meta: {
        returned: 1,
        total: 1,
        displayed: 1,
        omitted: 0,
        items: [
          {
            ref: 'zotero://user/0/item/AAAAAAA1?server=S1',
            title: 'Foreign',
            creatorSummary: 'Creator',
            itemType: 'journalArticle',
          },
        ],
      },
    })
    const { view } = mountTab(chatOf([toolRow(foreign)]), status)
    await act(async () => {})
    // Connected: the foreign qualifier is a mismatch against the verified id.
    expect(view.container.querySelector('[data-evidence-match="mismatch"]')).not.toBeNull()

    fireEvent.click(screen.getByText(zh.refresh))
    await act(async () => {})
    // Unavailable: the instance is no longer verifiable, so the verdict
    // degrades to unknown instead of staying a stale mismatch.
    expect(view.container.querySelector('[data-evidence-match="mismatch"]')).toBeNull()
    expect(view.container.querySelector('[data-evidence-match="unknown"]')).not.toBeNull()
    view.unmount()
  })
})

describe('filters', () => {
  it('filters the stable union by evidence and by failures', async () => {
    const status = connectedProbe()
    const retrieve = retrieveOf()
    const failed = settled({
      seq: 5,
      callId: 'g1',
      call: { name: 'zotero_get', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA2"}' },
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_NOT_FOUND' },
    })
    const { view } = mountTab(
      chatOf([toolRow(searchResult()), toolRow(retrieve), toolRow(failed)]),
      status,
    )
    await act(async () => {})
    // The search hit and the retrieve share one item; the failed get is its own.
    expect(view.container.querySelectorAll('[data-evidence-match]')).toHaveLength(2)

    expectFilteredTo(view, `${zh.filterEvidence} 1`, 1)
    expect(screen.getByText(zh.evidenceBadge.replace('{count}', '1'))).toBeDefined()

    expectFilteredTo(view, `${zh.filterIssues} 1`, 1)
    expect(screen.getByText(zh.issuesBadge)).toBeDefined()

    expectFilteredTo(view, `${zh.filterAll} 2`, 2)
    view.unmount()
  })

  it('recovers from a filter that empties when the sources change under it', async () => {
    const holder = { chat: chatOf([toolRow(searchResult())]) }
    const props = {
      t,
      status: async () => ({ ok: true, value: CONNECTED }),
      useSession: (sel: (snap: SessionSnapshot) => unknown) => sel(sessionOf()),
      useChat: (sel: (snap: ChatSnapshot) => unknown) =>
        holder.chat === undefined ? undefined : sel(holder.chat),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)
    await act(async () => {})
    // Nothing is exported yet, so no pill can empty the list. A direct
    // sources change under an active filter is the one path that can leave
    // an active filter with zero matches — the clear button recovers it.
    const exportCall = exportOf()
    const withExport = chatOf([toolRow(searchResult()), toolRow(exportCall)])
    holder.chat = withExport
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    expectPillActivated(`${zh.filterExported} 1`)
    // The same session now loses its export (a stale snapshot view): the
    // filter stays active, the list empties, and the clear action restores.
    holder.chat = chatOf([toolRow(searchResult())])
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    expect(screen.getByText(zh.filterEmptyNote)).toBeDefined()
    fireEvent.click(screen.getByText(zh.filterClear))
    expect(screen.getByText(`${zh.filterAll} 1`).getAttribute('data-pill')).toBe('active')
    view.unmount()
  })

  it('resets the filter when the session switches', async () => {
    const retrieve = retrieveOf()
    const holder = { session: sessionOf() }
    const chat = chatOf([toolRow(searchResult()), toolRow(retrieve)])
    const props = {
      t,
      status: async () => ({ ok: true, value: CONNECTED }),
      useSession: (sel: (snap: SessionSnapshot) => unknown) => sel(holder.session),
      useChat: (sel: (snap: ChatSnapshot) => unknown) => sel(chat),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)
    await act(async () => {})
    expectPillActivated(`${zh.filterEvidence} 1`)

    // A new session id remounts the list (key), so the filter starts clean.
    holder.session = sessionOf({ sessionId: 's2' as unknown as SessionSnapshot['sessionId'] })
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    // The passages filter has nothing to show in the new session, so its
    // pill is gone and "all" is active again.
    expect(screen.queryByText(`${zh.filterEvidence} 0`)).toBeNull()
    expect(screen.getByText(`${zh.filterAll} 1`).getAttribute('data-pill')).toBe('active')
    view.unmount()
  })
})

describe('composer prefills', () => {
  it('shows the inspector overview with search records and prefills from its actions', async () => {
    const status = connectedProbe()
    const setDraft = vi.fn()
    const retrieve = retrieveOf()
    const { view } = mountTab(chatOf([toolRow(searchResult()), toolRow(retrieve)]), status, {
      setDraft,
    })
    await act(async () => {})
    // The first source is selected by default; the overview shows the query
    // that surfaced it, and the passages tab carries the kept-passage count.
    expect(
      screen.getByText(new RegExp(zh.searchFrom.replace('{query}', 'attention'))),
    ).toBeDefined()
    expect(
      view.container.querySelector('[data-inspector-panel="evidence"]')!.textContent,
    ).toContain('1')
    // The overview actions prefill without submitting.
    fireEvent.click(screen.getByText(zh.askAboutItem))
    expect(setDraft).toHaveBeenCalledWith(
      zh.askTemplate.replace('{ref}', 'zotero://user/0/item/AAAAAAA1'),
    )
    view.unmount()
  })

  it('prefills the composer from the empty-state starters without submitting', async () => {
    const status = connectedProbe()
    const setDraft = vi.fn()
    const { view } = mountTab(chatOf(), status, { setDraft })
    await act(async () => {})
    expect(screen.getByText(zh.noSources)).toBeDefined()
    fireEvent.click(screen.getByText(zh.starterFind))
    fireEvent.click(screen.getByText(zh.starterCompare))
    fireEvent.click(screen.getByText(zh.starterEvidence))
    fireEvent.click(screen.getByText(zh.starterExportSelected))
    expect(setDraft).toHaveBeenCalledTimes(4)
    expect(setDraft).toHaveBeenCalledWith(zh.starterFindTemplate)
    expect(setDraft).toHaveBeenCalledWith(zh.starterCompareTemplate)
    expect(setDraft).toHaveBeenCalledWith(zh.starterEvidenceTemplate)
    expect(setDraft).toHaveBeenCalledWith(zh.starterExportSelectedTemplate)
    view.unmount()

    const bare = mountTab(chatOf(), status)
    await act(async () => {})
    expect(screen.queryByText(zh.starterFind)).toBeNull()
    bare.view.unmount()
  })
})
