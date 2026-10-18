// @vitest-environment jsdom
/**
 * Tests for the DiagnosticsCard (plugins.detail.section slot): subject guard,
 * newest-first entries with the level filter and count badge, the fetch-error
 * line, the copy-bundle action, and the latest-N note.
 * @module tests/client/DiagnosticsCard
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { DiagnosticsCard } from '../../src/client/components/DiagnosticsCard.tsx'
import type { ZoteroDiagnosticsView, ZoteroStatusView } from '../../src/client/remote.ts'
import { zh } from '../../src/client/locales.ts'
import { deferred, type Deferred } from '../helpers/sync.js'
import { mockT } from './helpers/mock-translate.ts'

afterEach(cleanup)

const t = mockT

const targetSubject: PluginsSubject = {
  kind: 'bundle',
  pkg: {
    name: 'dsh-zotero',
    version: '0.1.0',
    installed: true,
    availability: 'profile',
    official: false,
    enabled: true,
    rows: [],
  },
}

const otherSubject: PluginsSubject = {
  kind: 'bundle',
  pkg: {
    name: 'other-plugin',
    installed: true,
    availability: 'profile',
    official: false,
    enabled: true,
    rows: [],
  },
}

function okView(
  overrides: Partial<ZoteroDiagnosticsView> = {},
): RemoteResult<ZoteroDiagnosticsView> {
  return {
    ok: true as const,
    value: {
      entries: [],
      total: 0,
      truncated: false,
      debug: false,
      ...overrides,
    },
  }
}

function entry(seq: number, level: 'debug' | 'info' | 'warn' | 'error', event: string, count = 1) {
  return { seq, ts: Date.parse('2026-01-01T00:00:00Z'), level, event, message: `m${seq}`, count }
}

function fakeProbe(): Promise<RemoteResult<ZoteroStatusView>> {
  return Promise.resolve({
    ok: true as const,
    value: { providerId: 'local', connected: true, endpoint: '127.0.0.1:23119' },
  })
}

describe('DiagnosticsCard', () => {
  it('returns null when the subject is another plugin', () => {
    const diagnostics = vi.fn(async () => okView())
    const { container } = render(
      <DiagnosticsCard subject={otherSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    expect(container.innerHTML).toBe('')
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it('renders entries newest-first with event, count badge, and detail', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [
          { ...entry(3, 'warn', 'tool.result'), message: 'zotero_search failed: boom' },
          entry(2, 'info', 'transport.built', 3),
        ],
        total: 2,
      }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.querySelector('[data-zotero-diagnostics]')).toBeTruthy())
    expect(container.textContent).toContain('tool.result')
    expect(container.textContent).toContain('×3')
    expect(container.textContent).toContain('transport.built')
    // Newest first: the tool outcome appears before the transport line.
    const text = container.textContent ?? ''
    expect(text.indexOf('tool.result')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('tool.result')).toBeLessThan(text.indexOf('transport.built'))
    expect(container.textContent).toContain(zh.diagnosticsDebugOff)
    // The section header and the card head carry two distinct labels, so the
    // page never stacks the same word twice.
    expect(container.textContent).toContain(zh.diagnosticsTitle)
    expect(container.textContent).toContain(zh.diagnosticsLogLabel)
  })

  it('filters to problems when the level toggle is pressed', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [entry(3, 'error', 'http.failure'), entry(2, 'info', 'transport.built')],
        total: 2,
      }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('http.failure'))
    fireEvent.click(screen.getByText(zh.diagnosticsLevelProblems))
    expect(container.textContent).toContain('http.failure')
    expect(container.textContent).not.toContain('transport.built')
    // And back: the all-levels toggle restores the info entry.
    fireEvent.click(screen.getByText(zh.diagnosticsLevelAll))
    expect(container.textContent).toContain('transport.built')
  })

  it('re-fetches on the refresh button', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.refresh))
    await waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(2))
  })

  it('renders the fetch error instead of the list when the endpoint fails', async () => {
    const diagnostics = vi.fn(
      async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
        ({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'down', {}),
        }) as RemoteResult<ZoteroDiagnosticsView>,
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('down'))
    expect(container.querySelector('[data-zotero-diagnostics]')).toBeTruthy()
  })

  it('copies the diagnostics bundle to the clipboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.diagnosticsCopyBundle))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0]?.[0] ?? ''
    expect(text).toContain('dsh-zotero diagnostics')
    expect(text).toContain('#1')
    expect(text).toContain('transport.built')
    expect(await screen.findByText(zh.copied)).toBeTruthy()
  })

  it('renders the empty state when the ring holds nothing', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => okView())
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain(zh.diagnosticsEmpty))
  })

  it('shows the no-problems note when the filter empties a non-empty record', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.diagnosticsLevelProblems))
    expect(container.textContent).toContain(zh.diagnosticsNoProblems)
    expect(container.textContent).not.toContain(zh.diagnosticsEmpty)
  })

  it('contains a crash in its own boundary and names the failure', async () => {
    // The card's locale lookup is the render throw; the fallback strings still
    // resolve through the stub. Reporting is the slot registry's job now
    // (`ctx.slots.onEntryError`, covered by `slot-crash-intake.spec.ts`), so
    // this case pins what the boundary itself still owes: containment, and a
    // fallback that names the failure without throwing again.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const explodingT: typeof t = (key, params) => {
        if (key === 'diagnosticsTitle') throw new Error('locale exploded')
        return t(key, params)
      }
      const { container } = render(
        <DiagnosticsCard
          subject={targetSubject}
          t={explodingT}
          probe={fakeProbe}
          diagnostics={vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => okView())}
        />,
      )
      await waitFor(() =>
        expect(container.querySelector('[data-zotero-surface-error]')).not.toBeNull(),
      )
      expect(container.textContent).toContain('locale exploded')
      expect(
        errorSpy.mock.calls.some((call) =>
          String(call[0]).includes('dsh-zotero: the Zotero panel failed to render'),
        ),
      ).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('returns null for an item subject', () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => okView())
    const itemSubject: PluginsSubject = { kind: 'item', id: 'dsh-zotero' }
    const { container } = render(
      <DiagnosticsCard subject={itemSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    expect(container.innerHTML).toBe('')
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it('leaves the copy button inert when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    expect(() => fireEvent.click(screen.getByText(zh.diagnosticsCopyBundle))).not.toThrow()
    expect(container.textContent).not.toContain(zh.copied)
  })

  it('keeps the button state when the clipboard refuses', async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.diagnosticsCopyBundle))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(container.textContent).not.toContain(zh.copied)
  })

  it('renders entry detail blocks and count badges in the list', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [
          { ...entry(2, 'warn', 'degraded.unobservable', 3), detail: { kind: 'trashed' } },
          entry(1, 'info', 'transport.built'),
        ],
        total: 2,
      }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('×3'))
    expect(container.querySelector('details')).toBeTruthy()
    expect(container.textContent).toContain('"kind": "trashed"')
    expect(container.textContent).toContain(zh.diagnosticsDetail)
  })

  it('renders the verbose-diagnostics footer when the host flag is on', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1, debug: true }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain(zh.diagnosticsDebugOn))
  })

  it('copies the bundle with disconnected probe facts and repeated entries', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [
          { ...entry(2, 'error', 'http.failure', 3), detail: { errorCode: 'ZOTERO_TIMEOUT' } },
          entry(1, 'info', 'transport.built'),
        ],
        total: 2,
        debug: true,
      }),
    )
    const probe = vi.fn(
      async (): Promise<RemoteResult<ZoteroStatusView>> =>
        ({
          ok: true as const,
          value: {
            providerId: 'local',
            connected: false,
            zoteroVersion: '7.0',
            diagnosis: 'ZOTERO_NOT_RUNNING: down',
          },
        }) as RemoteResult<ZoteroStatusView>,
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={probe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('http.failure'))
    fireEvent.click(screen.getByText(zh.diagnosticsCopyBundle))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0]?.[0] ?? ''
    // The disconnected probe facts and the on-flag ride the header; repeated
    // entries and detail JSON ride the body.
    expect(text).toContain('disconnected')
    expect(text).toContain('zotero: 7.0')
    // The header names the one matching verbosity, not both labels.
    expect(text).toContain(zh.diagnosticsDebugOn)
    expect(text).not.toContain(zh.diagnosticsDebugOff)
    expect(text).toContain('(×3)')
    expect(text).toContain('{"errorCode":"ZOTERO_TIMEOUT"}')
    expect(container.textContent).toContain(zh.copied)
  })

  it('leaves the copy click inert while the first fetch is still in flight', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const pending: Deferred<void> = deferred()
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      await pending.promise
      return okView()
    })
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    // No entries yet (fetch pending): the click is a safe no-op.
    expect(() => fireEvent.click(screen.getByText(zh.diagnosticsCopyBundle))).not.toThrow()
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve()
    })
    expect(container.querySelector('[data-zotero-diagnostics]')).toBeTruthy()
  })

  it('notes the served slice when more entries exist than it renders', async () => {
    // Zero-padded messages: a plain `m12` plus a `08:00:00` time would spell
    // `m120` by substring accident.
    const entries = Array.from({ length: 120 }, (_, index) => ({
      ...entry(index + 1, 'info' as const, 'e'),
      message: `m${String(index + 1).padStart(4, '0')}`,
    }))
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries, total: 120 }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('m0100'))
    expect(container.textContent).toContain(
      zh.diagnosticsShowLatest.replace('{shown}', '100').replace('{total}', '120'),
    )
    expect(container.textContent).not.toContain('m0120')
  })
})
