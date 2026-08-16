// @vitest-environment jsdom
/**
 * The dedicated Zotero web view: pure helpers (snapshot collection, status
 * projection, clock, id shortening) plus the rendered tab — the connectivity
 * strip states, the activity list driven by a stubbed conversation snapshot,
 * refresh, abort, and the empty state.
 * @module tests/client/ZoteroTab
 */

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroStatusView } from '../../src/client/remote.ts'
import {
  ZoteroTab,
  collectZoteroCalls,
  currentTime,
  shortServerId,
  stateOf,
  type ZoteroTabProps,
} from '../../src/client/ZoteroTab.tsx'
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
      runningCalls: [running({ callId: 'a' })],
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
    expect(callNameOf(running())).toBe('zotero_search')
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
      settled({
        seq: 2,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          total: 1,
          items: [
            {
              ref: 'zotero://user/0/item/AAAAAAA9',
              title: 'Found',
              creatorSummary: 'A',
              itemType: 'report',
            },
          ],
        },
      }),
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
    // The per-call cards live on the activity lens; the items lens shows the
    // aggregated corpus instead.
    fireEvent.click(screen.getByText(zh.lensActivity))
    for (const button of screen
      .getAllByRole('button')
      .filter((candidate) => candidate.getAttribute('aria-expanded') !== null)) {
      fireEvent.click(button)
    }
    expect(screen.getByText('a.pdf')).toBeDefined()
    expect(screen.getByText(/@book\{x\}/)).toBeDefined()
    // The unknown zotero name renders no card but must not crash.
    expect(screen.getByText(zh.tagExport)).toBeDefined()
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
      snapshotOf({ nodes: [result], runningCalls: [running({ callId: 'r2' })] }),
      status,
    )
    await act(async () => {})
    // The tab opens on the activity ledger; the settled search renders as a
    // corpus line with its actions at the line end on the items lens (a
    // search-only row never invites an empty expansion).
    fireEvent.click(screen.getByText(zh.lensItems))
    expect(screen.getByText(/FlashAttention-2/)).toBeDefined()
    expect(screen.getAllByLabelText(zh.copyRef).length).toBeGreaterThan(0)
    view.unmount()

    const empty = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.getByText(zh.noActivity)).toBeDefined()
    empty.view.unmount()
  })
})

describe('ZoteroTab lenses', () => {
  const REF = 'zotero://user/0/item/AAAAAAA1'

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
            ref: REF,
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

  function getDetail(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
    return settled({
      seq: 4,
      callId: 'g1',
      call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
      meta: {
        title: 'FlashAttention-2',
        creators: 'Dao',
        notesPreview: [],
        annotationsPreview: [],
      },
      ...overrides,
    })
  }

  function exportArtifact(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
    return settled({
      seq: 5,
      callId: 'e1',
      call: { name: 'zotero_export', argsRaw: `{"refs":["${REF}"],"format":"bibtex"}` },
      meta: { format: 'bibtex', requested: 1 },
      content: [{ type: 'text', text: '@book{flash2023,\n}' }],
      ...overrides,
    })
  }

  it('opens on the activity ledger with the funnel once two stages occurred', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf({ nodes: [searchResult(), getDetail()] }), status)
    await act(async () => {})
    // The activity ledger is the tab's front page; the funnel rides the bar.
    expect(screen.getByText(zh.lensActivity).getAttribute('data-pill')).toBe('active')
    expect(screen.getByText(zh.tagSearch)).toBeDefined()
    expect(screen.getByText(zh.tagGet)).toBeDefined()
    expect(screen.getByText(zh.funnelSearched.replace('{count}', '1'))).toBeDefined()
    expect(screen.getByText(zh.funnelRead.replace('{count}', '1'))).toBeDefined()
    view.unmount()
  })

  it('renders only the non-zero funnel chips for a single-stage session', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf({ nodes: [searchResult()] }), status)
    await act(async () => {})
    expect(screen.getByText(zh.funnelSearched.replace('{count}', '1'))).toBeDefined()
    expect(screen.queryByText(new RegExp(zh.funnelRead.replace('{count}', '\\d+')))).toBeNull()
    expect(screen.queryByText(new RegExp(zh.funnelCited.replace('{count}', '\\d+')))).toBeNull()
    view.unmount()
  })

  it('opens on the activity ledger even with export artifacts and reaches the citations lens', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(
      snapshotOf({ nodes: [searchResult(), getDetail(), exportArtifact()] }),
      status,
    )
    await act(async () => {})
    expect(screen.getByText(zh.lensActivity).getAttribute('data-pill')).toBe('active')
    fireEvent.click(screen.getByText(zh.lensCitations))
    expect(screen.getByText(zh.lensCitations).getAttribute('data-pill')).toBe('active')
    expect(screen.getByText(zh.exportsLabel)).toBeDefined()
    expect(screen.getByText(zh.quickAccessLabel)).toBeDefined()
    view.unmount()
  })

  it('switches to the activity lens through the pill bar', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const { view } = mountTab(snapshotOf({ nodes: [exportArtifact()] }), status)
    await act(async () => {})
    fireEvent.click(screen.getByText(zh.lensActivity))
    expect(screen.getByText(zh.lensActivity).getAttribute('data-pill')).toBe('active')
    // The ledger caption counts the calls and the card leads with its tag.
    expect(screen.getByText(zh.activityNote.replace('{count}', '1'))).toBeDefined()
    expect(screen.getByText(zh.tagExport)).toBeDefined()
    view.unmount()
  })

  it('renders the activity strip segments and cross-highlights the hovered call', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const failedSearch = settled({
      seq: 1,
      callId: 's1',
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_INVALID_ARGUMENT' },
    })
    const untimedExport = settled({
      seq: 2,
      callId: 'e1',
      call: { name: 'zotero_export', argsRaw: '{}' },
      callTime: null,
      meta: { format: 'bibtex', requested: 1 },
      content: [{ type: 'text', text: '@book{x}' }],
    })
    const zeroDuration = settled({ seq: 3, callId: 'z1', time: 1 })
    const { view } = mountTab(
      snapshotOf({
        nodes: [failedSearch, untimedExport, zeroDuration],
        runningCalls: [running({ callId: 'r1' })],
      }),
      status,
    )
    await act(async () => {})
    fireEvent.click(screen.getByText(zh.lensActivity))
    const spans = view.container.querySelectorAll('[data-activity-span]')
    expect(spans.length).toBe(4)
    // Kind tones follow the wire tools; failures mark the segment red.
    expect(spans[0]!.getAttribute('data-kind')).toBe('search')
    expect(spans[0]!.getAttribute('data-error')).toBe('true')
    expect(spans[1]!.getAttribute('data-kind')).toBe('export')
    expect(spans[1]!.getAttribute('data-error')).toBeNull()
    expect(spans[2]!.getAttribute('data-kind')).toBe('search')
    // The settled duration grows the segment; untimed and zero-duration
    // blocks fall back to the minimum width (no inline style).
    expect(spans[0]!.getAttribute('style')?.includes('flex-grow')).toBe(true)
    expect(spans[1]!.getAttribute('style')).toBeNull()
    expect(spans[2]!.getAttribute('style')).toBeNull()
    expect(spans[3]!.getAttribute('style')).toBeNull()
    // Hovering a segment rings it and washes the matching call's row.
    fireEvent.mouseEnter(spans[0]!)
    expect(spans[0]!.getAttribute('data-hovered')).toBe('true')
    expect(view.container.querySelector('[data-hovered="true"]')).toBeDefined()
    fireEvent.mouseLeave(spans[0]!)
    expect(view.container.querySelector('[data-hovered="true"]')).toBeNull()
    view.unmount()
  })

  it('prefills the composer from the empty-state starters without submitting', async () => {
    const status = vi.fn(async () => ({ ok: true, value: CONNECTED }))
    const setDraft = vi.fn()
    const { view } = mountTab(snapshotOf(), status, { setDraft })
    await act(async () => {})
    fireEvent.click(screen.getByText(zh.starterFind))
    fireEvent.click(screen.getByText(zh.starterCite))
    fireEvent.click(screen.getByText(zh.starterTidy))
    expect(setDraft).toHaveBeenCalledTimes(3)
    expect(setDraft).toHaveBeenCalledWith(zh.starterFindTemplate)
    expect(setDraft).toHaveBeenCalledWith(zh.starterCiteTemplate)
    expect(setDraft).toHaveBeenCalledWith(zh.starterTidyTemplate)
    view.unmount()

    const bare = mountTab(snapshotOf(), status)
    await act(async () => {})
    expect(screen.queryByText(zh.starterFind)).toBeNull()
    bare.view.unmount()
  })
})
