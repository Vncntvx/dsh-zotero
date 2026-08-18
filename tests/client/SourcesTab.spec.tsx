// @vitest-environment jsdom
/**
 * The Sources panel: pure helpers (snapshot collection, status projection,
 * clock, id shortening, diagnosis line) plus the rendered tab — the
 * connectivity strip states, the sources-first default with its stable
 * union and filters, the honest evidence/exports placeholders, refresh,
 * abort, and the empty state.
 * @module tests/client/SourcesTab
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroStatusView } from '../../src/client/remote.ts'
import {
  SourcesTab,
  collectZoteroCalls,
  currentTime,
  sessionSignatureOf,
  stateOf,
  type SourcesTabProps,
} from '../../src/client/components/SourcesTab.tsx'
import {
  connectionDiagnosisOf,
  type ConnectionView,
} from '../../src/client/components/workspace/connection.ts'
import { callNameOf } from '../../src/client/presenters.ts'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import { running, settled } from './helpers/blocks.ts'

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
      items?: Array<{ id: string; label?: unknown; disabled?: boolean }>
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
    IconChevronLeftOutline14: icon('chevron-left'),
    IconChevronRightOutline14: icon('chevron-right'),
    IconBrowseOutline16: icon('browse'),
    writeClipboard: vi.fn(async () => true),
    Tooltip: ({ children }: { children: React.ReactElement }) => children,
  }
})

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

const CONNECTED: ZoteroStatusView = {
  providerId: 'local',
  connected: true,
  apiVersion: '3',
  schemaVersion: '37',
  serverId: 'sPMHtLD6HHBd',
  diagnosis: 'ok',
}

const UNAVAILABLE: ZoteroStatusView = {
  providerId: 'local',
  connected: false,
  diagnosis: 'connection refused',
}

function snapshotOf(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 's1' as unknown as ConversationSnapshot['sessionId'],
    views: new Map() as ConversationSnapshot['views'],
    chat: {} as ConversationSnapshot['chat'],
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  }
}

/** A settled zotero_search result carrying one row. */
function searchResult(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return settled({
    seq: 3,
    callId: 'r1',
    call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
    meta: {
      returned: 1,
      total: 1,
      displayed: 1,
      omitted: 0,
      items: [
        {
          ref: 'zotero://user/0/item/AAAAAAA1',
          title: 'FlashAttention-2',
          creatorSummary: 'Dao',
          year: 2023,
          itemType: 'conferencePaper',
        },
      ],
    },
    ...overrides,
  })
}

/** Render the tab with a stubbed session hook and status face. */
function mountTab(
  session: ConversationSnapshot | undefined,
  status: () => Promise<{ ok: boolean; value?: unknown; error?: unknown }>,
  inputActions?: { setDraft: (text: string) => void },
): {
  view: ReturnType<typeof render>
  calls: number
} {
  let calls = 0
  const props = {
    t,
    status: async () => {
      calls += 1
      return (await status()) as never
    },
    useSession: (sel: (snap: ConversationSnapshot) => unknown) =>
      session === undefined ? undefined : sel(session),
    ...(inputActions === undefined ? {} : { inputActions }),
  } as unknown as SourcesTabProps
  const view = render(<SourcesTab {...props} />)
  return { view, calls }
}

afterEach(cleanup)

describe('collectZoteroCalls', () => {
  it('collects settled results and in-flight calls, deduped by callId and ordered', () => {
    const result = settled({
      seq: 3,
      callId: 'b',
      call: { name: 'zotero_get', argsRaw: '{}' },
    })
    const snapshot = snapshotOf({
      nodes: [result],
      runningCalls: [running({ callId: 'a' })],
    })
    const calls = collectZoteroCalls(snapshot)
    expect(calls.map((call) => call.callId)).toEqual(['b', 'a'])
    expect(collectZoteroCalls(snapshot).map((call) => call.callId)).toEqual(['b', 'a'])
  })

  it('includes nested dispatch and ignores non-zotero calls', () => {
    const nested = settled({
      seq: 4,
      callId: 'nested',
      call: { name: 'zotero_export', argsRaw: '{}' },
    })
    const outer = settled({
      seq: 5,
      callId: 'outer',
      call: { name: 'bash', argsRaw: '{}' },
      subCalls: [nested],
    })
    const calls = collectZoteroCalls(snapshotOf({ nodes: [outer] }))
    expect(calls.map((call) => call.callId)).toEqual(['nested'])
  })

  it('returns an empty list without a session and skips non-tool nodes', () => {
    expect(collectZoteroCalls(undefined)).toEqual([])
    const assistant = { kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1, blocks: [] }
    expect(collectZoteroCalls(snapshotOf({ nodes: [assistant as never] }))).toEqual([])
  })
})

describe('status projection helpers', () => {
  it('projects the settled arms with the acquisition time', () => {
    expect(stateOf({ ok: true, value: CONNECTED }, '10:00:00')).toEqual({
      kind: 'connected',
      data: CONNECTED,
      checkedAt: '10:00:00',
    })
    expect(stateOf({ ok: true, value: UNAVAILABLE }, '10:00:01')).toEqual({
      kind: 'unavailable',
      data: UNAVAILABLE,
      checkedAt: '10:00:01',
    })
    expect(
      stateOf({ ok: false, error: { code: 'x', message: 'offline', details: {} } }, '10:00:02'),
    ).toEqual({ kind: 'remote-error', message: 'offline' })
  })

  it('formats the clock as an absolute HH:MM:SS time', () => {
    expect(currentTime()).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('signs the zotero-relevant snapshot slice', () => {
    expect(sessionSignatureOf(undefined)).toBe('')
    const snapshot = snapshotOf({
      nodes: [settled({ seq: 3, callId: 'a' })],
      runningCalls: [running({ callId: 'b' })],
    })
    const signed = sessionSignatureOf(snapshot)
    expect(signed).toBe('1:3:1:b')
    // The same content signs identically; streaming publications change
    // neither the node count nor the running ids.
    expect(
      sessionSignatureOf(
        snapshotOf({
          nodes: [settled({ seq: 3, callId: 'a' })],
          runningCalls: [running({ callId: 'b' })],
        }),
      ),
    ).toBe(signed)
    expect(sessionSignatureOf(snapshotOf())).toBe('0:-1:0:')
  })

  it('builds the failure diagnosis line', () => {
    expect(connectionDiagnosisOf({ kind: 'remote-error', message: 'gateway offline' }, t)).toBe(
      'gateway offline',
    )
    expect(
      connectionDiagnosisOf({ kind: 'unavailable', data: UNAVAILABLE, checkedAt: '10:00:00' }, t),
    ).toBe('诊断: connection refused')
    expect(
      connectionDiagnosisOf(
        {
          kind: 'unavailable',
          data: { providerId: 'local', connected: false, diagnosis: '' },
          checkedAt: '10:00:00',
        },
        t,
      ),
    ).toBe(zh.statusUnavailable)
    expect(connectionDiagnosisOf({ kind: 'loading' }, t)).toBe('')
  })

  it('names calls from both block forms', () => {
    expect(callNameOf(running())).toBe('zotero_search')
    expect(callNameOf(settled())).toBe('zotero_search')
    expect(callNameOf(settled({ call: null }))).toBeNull()
  })
})

describe('SourcesTab', () => {
  it('renders the checking strip, then the connected note and the diagnostic facts', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf(), status)
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

  it('shows the diagnosis for an unavailable Zotero and a refresh re-probes', async () => {
    const status = vi
      .fn(async () => ({ ok: true, value: CONNECTED }))
      .mockResolvedValueOnce({ ok: true, value: UNAVAILABLE })
    const { view } = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.statusUnavailable)).toBeDefined()
    expect(screen.getByText(/connection refused/)).toBeDefined()
    fireEvent.click(screen.getByText(zh.refresh))
    await act(async () => {})
    expect(status).toHaveBeenCalledTimes(2)
    expect(screen.getByText(zh.statusConnectedNote)).toBeDefined()
    view.unmount()
  })

  it('skips the probe when no status face is injected', async () => {
    const view = render(
      <SourcesTab
        t={t}
        status={undefined as never}
        useSession={((sel: (snap: ConversationSnapshot) => unknown) => sel(snapshotOf())) as never}
        sessionId={'s1' as never}
        useProjection={undefined as never}
        useInput={undefined as never}
        inputActions={undefined as never}
        useSessions={undefined as never}
        useWorkspaces={undefined as never}
      />,
    )
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
    const { view } = mountTab(snapshotOf(), status)
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
    const { view } = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText('gateway offline')).toBeDefined()
    view.unmount()
  })

  it('renders a rejected probe as a remote error instead of staying on loading', async () => {
    const status = vi.fn(async () => {
      throw new Error('remote face unmounted')
    })
    const { view } = mountTab(snapshotOf(), status)
    expect(screen.getByText(zh.checking)).toBeDefined()
    await act(async () => {})
    expect(screen.getByText('remote face unmounted')).toBeDefined()
    view.unmount()
  })

  it('renders a non-Error rejection message too', async () => {
    const status = vi.fn(async () => {
      throw 'remote face unmounted'
    })
    const { view } = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText('remote face unmounted')).toBeDefined()
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
    const { view } = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.checking)).toBeDefined()
    view.unmount()
    // The abort wins over the late rejection: no state update, no unhandled
    // rejection from the probe's catch.
    await act(async () => {
      rejectProbe(new Error('late rejection'))
    })
  })

  it('opens on the sources lens and keeps every search hit when one was inspected', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
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
    const { view } = mountTab(snapshotOf({ nodes: [search, get] }), status)
    await act(async () => {})
    const lensTab = view.container.querySelector('[data-workspace-lens="sources"]')!
    expect(lensTab.getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelectorAll('[data-provenance]')).toHaveLength(20)
    // The workflow stats strip is gone; the filter bar is the only count line.
    expect(screen.getByText(`${zh.filterAll} 20`)).toBeDefined()
    view.unmount()
  })

  it('filters the stable union by evidence and by failures', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const retrieve = settled({
      seq: 4,
      callId: 'rv1',
      call: { name: 'zotero_retrieve', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA1"}' },
      meta: {
        count: 1,
        sources: ['annotation'],
        truncated: false,
        sourcesSkipped: [],
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'claim',
            previewTruncated: false,
            pageLabel: '7',
          },
        ],
      },
    })
    const failed = settled({
      seq: 5,
      callId: 'g1',
      call: { name: 'zotero_get', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA2"}' },
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_NOT_FOUND' },
    })
    const { view } = mountTab(snapshotOf({ nodes: [searchResult(), retrieve, failed] }), status)
    await act(async () => {})
    // The search hit and the retrieve share one item; the failed get is its own.
    expect(view.container.querySelectorAll('[data-provenance]')).toHaveLength(2)

    fireEvent.click(screen.getByText(`${zh.filterEvidence} 1`))
    expect(view.container.querySelectorAll('[data-provenance]')).toHaveLength(1)
    expect(screen.getByText(zh.evidenceBadge.replace('{count}', '1'))).toBeDefined()

    fireEvent.click(screen.getByText(`${zh.filterIssues} 1`))
    expect(view.container.querySelectorAll('[data-provenance]')).toHaveLength(1)
    expect(screen.getByText(zh.issuesBadge)).toBeDefined()

    fireEvent.click(screen.getByText(`${zh.filterAll} 2`))
    expect(view.container.querySelectorAll('[data-provenance]')).toHaveLength(2)
    view.unmount()
  })

  it('marks a source from another instance and notes omitted rows', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
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
    const { view } = mountTab(snapshotOf({ nodes: [foreign] }), status)
    await act(async () => {})
    expect(screen.getByText(zh.omittedRowsNote.replace('{count}', '5'))).toBeDefined()
    // The mismatch row carries the issues badge; the selected inspector shows
    // the warning line for the first (mismatched) source.
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(1)
    const row = view.container.querySelector('[data-provenance="mismatch"]')!
    fireEvent.click(row)
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(2)
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
    const { view } = mountTab(snapshotOf({ nodes: [foreign] }), status)
    await act(async () => {})
    // Connected: the foreign qualifier is a mismatch against the verified id.
    expect(view.container.querySelector('[data-provenance="mismatch"]')).not.toBeNull()

    fireEvent.click(screen.getByText(zh.refresh))
    await act(async () => {})
    // Unavailable: the instance is no longer verifiable, so the verdict
    // degrades to unknown instead of staying a stale mismatch.
    expect(view.container.querySelector('[data-provenance="mismatch"]')).toBeNull()
    expect(view.container.querySelector('[data-provenance="unknown"]')).not.toBeNull()
    view.unmount()
  })

  it('shows honest placeholders on the inspector evidence panel and the exports lens', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf({ nodes: [searchResult()] }), status)
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

  it('shows the inspector overview with search provenance and prefills from its actions', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const setDraft = vi.fn()
    const retrieve = settled({
      seq: 4,
      callId: 'rv1',
      call: { name: 'zotero_retrieve', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA1"}' },
      meta: {
        count: 1,
        sources: ['annotation'],
        truncated: false,
        sourcesSkipped: [],
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'claim',
            previewTruncated: false,
            pageLabel: '7',
          },
        ],
      },
    })
    const { view } = mountTab(snapshotOf({ nodes: [searchResult(), retrieve] }), status, {
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

  it('shows the honest sources empty note and hides zero-count filters', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const failedSearch = settled({
      seq: 3,
      callId: 's1',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_INVALID_ARGUMENT' },
    })
    const { view } = mountTab(snapshotOf({ nodes: [failedSearch] }), status)
    await act(async () => {})
    expect(screen.getByText(zh.noSources)).toBeDefined()
    view.unmount()

    const filtered = mountTab(snapshotOf({ nodes: [searchResult()] }), status)
    await act(async () => {})
    // Zero-count filters are not rendered at all, so an empty filter state
    // is never actively reachable.
    expect(screen.queryByText(`${zh.filterExported} 0`)).toBeNull()
    expect(screen.queryByText(`${zh.filterIssues} 0`)).toBeNull()
    expect(screen.queryByText(zh.filterEmptyNote)).toBeNull()
    filtered.view.unmount()
  })

  it('recovers from a filter that empties when the sources change under it', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const holder = { session: snapshotOf({ nodes: [searchResult()] }) }
    const props = {
      t,
      status: async () => ({ ok: true, value: CONNECTED }),
      useSession: (sel: (snap: ConversationSnapshot) => unknown) =>
        holder.session === undefined ? undefined : sel(holder.session),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)
    await act(async () => {})
    // Nothing is exported yet, so no pill can empty the list. A direct
    // sources change under an active filter is the one path that can leave
    // an active filter with zero matches — the clear button recovers it.
    const exportCall = settled({
      seq: 4,
      callId: 'e1',
      call: {
        name: 'zotero_export',
        argsRaw: '{"refs":["zotero://user/0/item/AAAAAAA1"],"format":"bibtex"}',
      },
      meta: {
        format: 'bibtex',
        requested: 1,
        refs: ['zotero://user/0/item/AAAAAAA1'],
        refsOmitted: 0,
      },
      content: [{ type: 'text', text: '@book{x}' }],
    })
    const withExport = { ...holder.session, nodes: [searchResult(), exportCall] }
    holder.session = withExport as ConversationSnapshot
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    fireEvent.click(
      screen.getAllByText(`${zh.filterExported} 1`).find((el) => el.tagName === 'BUTTON')!,
    )
    expect(
      screen
        .getAllByText(`${zh.filterExported} 1`)
        .find((el) => el.tagName === 'BUTTON')!
        .getAttribute('data-pill'),
    ).toBe('active')
    // The same session now loses its export (a stale snapshot view): the
    // filter stays active, the list empties, and the clear action restores.
    holder.session = snapshotOf({ nodes: [searchResult()] })
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    expect(screen.getByText(zh.filterEmptyNote)).toBeDefined()
    fireEvent.click(screen.getByText(zh.filterClear))
    expect(screen.getByText(`${zh.filterAll} 1`).getAttribute('data-pill')).toBe('active')
    view.unmount()
  })

  it('carries the exported count on the filter pill, the badge, and the exports tab', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const exportCall = settled({
      seq: 4,
      callId: 'e1',
      call: {
        name: 'zotero_export',
        argsRaw: '{"refs":["zotero://user/0/item/AAAAAAA1"],"format":"bibtex"}',
      },
      meta: {
        format: 'bibtex',
        requested: 1,
        refs: ['zotero://user/0/item/AAAAAAA1'],
        refsOmitted: 0,
      },
      content: [{ type: 'text', text: '@book{x}' }],
    })
    const { view } = mountTab(snapshotOf({ nodes: [searchResult(), exportCall] }), status)
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

  it('renders the sources list with a fallback key when the session id is missing', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(
      snapshotOf({ sessionId: undefined as never, nodes: [searchResult()] }),
      status,
    )
    await act(async () => {})
    expect(screen.getByText(`${zh.filterAll} 1`)).toBeDefined()
    view.unmount()
  })

  it('resets the filter when the session switches', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const retrieve = settled({
      seq: 4,
      callId: 'rv1',
      call: { name: 'zotero_retrieve', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA1"}' },
      meta: {
        count: 1,
        sources: ['annotation'],
        truncated: false,
        sourcesSkipped: [],
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'claim',
            previewTruncated: false,
            pageLabel: '7',
          },
        ],
      },
    })
    const holder = { session: snapshotOf({ nodes: [searchResult(), retrieve] }) }
    const props = {
      t,
      status: async () => ({ ok: true, value: CONNECTED }),
      useSession: (sel: (snap: ConversationSnapshot) => unknown) =>
        holder.session === undefined ? undefined : sel(holder.session),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByText(`${zh.filterEvidence} 1`))
    expect(screen.getByText(`${zh.filterEvidence} 1`).getAttribute('data-pill')).toBe('active')

    // A new session id remounts the list (key), so the filter starts clean.
    holder.session = snapshotOf({
      sessionId: 's2' as unknown as ConversationSnapshot['sessionId'],
      nodes: [searchResult()],
    })
    view.rerender(<SourcesTab {...props} />)
    await act(async () => {})
    // The passages filter has nothing to show in the new session, so its
    // pill is gone and "all" is active again.
    expect(screen.queryByText(`${zh.filterEvidence} 0`)).toBeNull()
    expect(screen.getByText(`${zh.filterAll} 1`).getAttribute('data-pill')).toBe('active')
    view.unmount()
  })

  it('prefills the composer from the empty-state starters without submitting', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const setDraft = vi.fn()
    const { view } = mountTab(snapshotOf(), status, { setDraft })
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

    const bare = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.queryByText(zh.starterFind)).toBeNull()
    bare.view.unmount()
  })
})
