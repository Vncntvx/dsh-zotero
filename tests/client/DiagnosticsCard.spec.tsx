// @vitest-environment jsdom
/**
 * Tests for the DiagnosticsCard (plugins.detail.section slot): subject guard,
 * newest-first entries with the level filter and count badge, the fetch-error
 * line, and the latest-N note. The copy bundle lives in `.copy`.
 * @module tests/client/DiagnosticsCard
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { DiagnosticsCard } from '../../src/client/components/DiagnosticsCard.tsx'
import type { ZoteroDiagnosticsView } from '../../src/client/remote.ts'
import { zh } from '../../src/client/locales.ts'
import { entry, fakeProbe, okView, targetSubject } from './helpers/diagnostics-fixtures.ts'
import { mockT } from './helpers/mock-translate.ts'

afterEach(cleanup)

const t = mockT

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

describe('DiagnosticsCard', () => {
  it('returns null when the subject is another plugin', () => {
    const diagnostics = vi.fn(async () => okView())
    const { container } = render(
      <DiagnosticsCard subject={otherSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    expect(container.innerHTML).toBe('')
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it('returns null and does not render when diagnostics is disabled (debug: false)', async () => {
    const diagnostics = vi.fn(async () => okView({ debug: false }))
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(diagnostics).toHaveBeenCalled())
    expect(container.querySelector('[data-zotero-diagnostics]')).toBeNull()
    expect(container.innerHTML).toBe('')
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
    expect(container.textContent).toContain(zh.diagnosticsDebugOn)
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
    expect(container.textContent).toContain('kind:"trashed"')
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

  it('renders string detail wrapped in value object in JsonTree', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [
          {
            ...entry(1, 'info', 'string.event'),
            detail: 'plain string detail' as unknown as Record<string, string | number | boolean>,
          },
        ],
        total: 1,
      }),
    )
    const { container } = render(
      <DiagnosticsCard subject={targetSubject} t={t} probe={fakeProbe} diagnostics={diagnostics} />,
    )
    await waitFor(() => expect(container.textContent).toContain('string.event'))
    expect(container.querySelector('details')).toBeTruthy()
    expect(container.textContent).toContain('value')
    expect(container.textContent).toContain('"plain string detail"')
  })
})
