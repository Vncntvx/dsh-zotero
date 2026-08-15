// @vitest-environment jsdom
/**
 * The dedicated Zotero web view: pure helpers (snapshot collection, status
 * projection, clock, id shortening) plus the rendered tab — the connectivity
 * strip states, the activity list driven by a stubbed conversation snapshot,
 * refresh, abort, and the empty state.
 * @module tests/client/ZoteroTab
 */

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type {
  ConversationSnapshot,
  RunningToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroStatusView } from '../../src/client/remote.ts'
import {
  ZoteroTab,
  callNameOf,
  collectZoteroCalls,
  currentTime,
  shortServerId,
  stateOf,
  type ZoteroTabProps,
} from '../../src/client/ZoteroTab.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement('span', { 'data-icon': name, ...props })
  return {
    StateDot: ({ state }: { state: string }) => createElement('span', { 'data-dot': state }),
    IconChevronDownOutline14: icon('chevron-down'),
    IconInspectOutline12: icon('inspect'),
    IconBrowseOutline16: icon('browse'),
    IconCopyOutline16: icon('copy'),
    IconSearchOutline16: icon('search'),
    CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
    writeClipboard: vi.fn(async () => true),
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

function runningCall(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'c1',
    name: 'zotero_search',
    argsRaw: '{"query":"attention"}',
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
    ...overrides,
  }
}

function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'c1',
    call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
    callTime: 1,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  }
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

/** Render the tab with a stubbed session hook and status face. */
function mountTab(
  session: ConversationSnapshot | undefined,
  status: () => Promise<{ ok: boolean; value?: unknown; error?: unknown }>,
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
  } as unknown as ZoteroTabProps
  const view = render(<ZoteroTab {...props} />)
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
      runningCalls: [runningCall({ callId: 'a' })],
    })
    const calls = collectZoteroCalls(snapshot)
    // Settled results sort by seq; in-flight calls trail them by design.
    expect(calls.map((call) => call.callId)).toEqual(['b', 'a'])
    // The same snapshot yields the same list (pure replay).
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

  it('returns an empty list without a session', () => {
    expect(collectZoteroCalls(undefined)).toEqual([])
  })

  it('skips non-tool-result nodes when collecting', () => {
    const assistant = { kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1, blocks: [] }
    const calls = collectZoteroCalls(snapshotOf({ nodes: [assistant as never] }))
    expect(calls).toEqual([])
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

  it('formats the clock as an absolute HH:MM:SS time and shortens ids', () => {
    expect(currentTime()).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(shortServerId('sPMHtLD6HHBd')).toBe('sPMHtLD6')
  })

  it('names calls from both block forms', () => {
    expect(callNameOf(runningCall())).toBe('zotero_search')
    expect(callNameOf(settled())).toBe('zotero_search')
    expect(callNameOf(settled({ call: null }))).toBeNull()
  })
})

describe('ZoteroTab', () => {
  it('renders the checking strip, then the connected facts after the probe', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf(), status)
    expect(screen.getByText(zh.checking)).toBeDefined()
    await act(async () => {})
    expect(screen.getByText(zh.statusConnected)).toBeDefined()
    expect(screen.getByText(/API 版本 3/)).toBeDefined()
    expect(screen.getByText(/Schema 版本 37/)).toBeDefined()
    expect(screen.getByText(/sPMHtLD6/)).toBeDefined()
    expect(screen.getByText(/上次检查/)).toBeDefined()
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
    expect(screen.getByText(zh.statusConnected)).toBeDefined()
    view.unmount()
  })

  it('renders every zotero card kind plus the fallback for unknown names', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const kinds = [
      settled({ seq: 3, callId: 'g', call: { name: 'zotero_get', argsRaw: '{}' } }),
      settled({
        seq: 4,
        callId: 'r',
        call: { name: 'zotero_retrieve', argsRaw: '{"ref":"zotero://user/0/item/ABCD1234"}' },
        meta: {
          count: 1,
          sources: ['annotation'],
          truncated: false,
          sourcesSkipped: [],
          items: [
            {
              source: 'annotation',
              sourceRef: 'zotero://user/0/annotation/ANN000001',
              preview: 'claim',
              previewTruncated: false,
              pageLabel: '7',
            },
          ],
        },
      }),
      settled({
        seq: 5,
        callId: 'a',
        call: { name: 'zotero_attachment', argsRaw: '{}' },
        meta: { kind: 'file', title: 'a.pdf', contentType: 'application/pdf', path: '/tmp/a.pdf' },
      }),
      settled({
        seq: 6,
        callId: 'e',
        call: { name: 'zotero_export', argsRaw: '{}' },
        meta: { format: 'bibtex', requested: 1 },
        content: [{ type: 'text', text: '@book{x}' }],
      }),
      settled({ seq: 7, callId: 'x', call: { name: 'zotero_mystery', argsRaw: '{}' } }),
    ]
    const { view } = mountTab(snapshotOf({ nodes: kinds }), status)
    await act(async () => {})
    for (const button of screen
      .getAllByRole('button')
      .filter((candidate) => candidate.getAttribute('aria-expanded') !== null)) {
      fireEvent.click(button)
    }
    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.getByText(/@book\{x\}/)).toBeDefined()
    // The unknown zotero name renders no card but must not crash.
    expect(screen.getByText('Export Zotero citations')).toBeDefined()
    view.unmount()
  })

  it('skips the probe when no status face is injected', async () => {
    const view = render(
      <ZoteroTab
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
    expect(screen.getByText(zh.noActivity)).toBeDefined()
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

  it('renders carrier failures and aborts the probe on unmount', async () => {
    const status = vi.fn(async () => ({
      ok: false,
      error: { code: 'x', message: 'gateway offline', details: {} },
    }))
    const { view } = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText('gateway offline')).toBeDefined()
    view.unmount()
  })

  it('lists the session zotero calls as cards and shows the empty state otherwise', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const result = settled({
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
      content: [{ type: 'text', text: 'Found 1 of 1 results:' }],
    })
    const { view } = mountTab(
      snapshotOf({ nodes: [result], runningCalls: [runningCall({ callId: 'r2' })] }),
      status,
    )
    await act(async () => {})
    // The card rows live in the expanded body; open the settled result row
    // (the strip's Refresh button is the other button in the tab).
    const row = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-expanded') !== null)
    expect(row).toBeDefined()
    fireEvent.click(row!)
    expect(screen.getByText(/FlashAttention-2/)).toBeDefined()
    view.unmount()

    const empty = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.noActivity)).toBeDefined()
    empty.view.unmount()
  })
})
