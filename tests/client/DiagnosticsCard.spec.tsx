// @vitest-environment jsdom
/**
 * Tests for the DiagnosticsCard nested in the service status section: the
 * first-answer gate, newest-first entries with the level filter and count
 * badge, the fetch-error line, the latest-N note, and the card's own crash
 * boundary. The copy bundle lives in `.copy`.
 * @module tests/client/DiagnosticsCard
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { DiagnosticsCard } from '../../src/client/components/DiagnosticsCard.tsx'
import type { ZoteroDiagnosticsView } from '../../src/client/remote.ts'
import { zh } from '../../src/client/locales.ts'
import { deferred, type Deferred } from '../helpers/sync.js'
import { entry, okView } from './helpers/diagnostics-fixtures.ts'
import { mockT } from './helpers/mock-translate.ts'
import { zoteroClientStub } from './helpers/zotero-client.ts'

afterEach(cleanup)

const t = mockT
const report = zoteroClientStub().reportClientError

function card(diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>) {
  return <DiagnosticsCard t={t} diagnostics={diagnostics} report={report} />
}

describe('DiagnosticsCard', () => {
  it('stays empty until the first diagnostics answer arrives', async () => {
    const pending: Deferred<void> = deferred()
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      await pending.promise
      return okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 })
    })
    const { container } = render(card(diagnostics))
    expect(container.innerHTML).toBe('')
    await act(async () => {
      pending.resolve()
    })
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
  })

  it('returns null once the answer says diagnostics is disabled (debug: false)', async () => {
    const diagnostics = vi.fn(async () => okView({ debug: false }))
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(diagnostics).toHaveBeenCalled())
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(container.querySelector('[data-zotero-diagnostics]')).toBeNull()
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
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('tool.result'))
    expect(container.textContent).toContain('×3')
    expect(container.textContent).toContain('transport.built')
    // Newest first: the tool outcome appears before the transport line.
    const text = container.textContent ?? ''
    expect(text.indexOf('tool.result')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('tool.result')).toBeLessThan(text.indexOf('transport.built'))
    expect(container.textContent).toContain(zh.diagnosticsDebugOn)
    // One card title: the section owns the only heading above it.
    expect(container.textContent).toContain(zh.diagnosticsLogLabel)
  })

  it('filters to problems when the level toggle is pressed', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({
        entries: [entry(3, 'error', 'http.failure'), entry(2, 'info', 'transport.built')],
        total: 2,
      }),
    )
    const { container } = render(card(diagnostics))
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
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.refresh))
    await waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(2))
  })

  it('renders the fetch error when the endpoint fails', async () => {
    const diagnostics = vi.fn(
      async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
        ({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'down', {}),
        }) as RemoteResult<ZoteroDiagnosticsView>,
    )
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('down'))
    expect(container.querySelector('[data-zotero-diagnostics]')).toBeTruthy()
  })

  it('renders the empty state when the ring holds nothing', async () => {
    const diagnostics = vi.fn(async () => okView())
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain(zh.diagnosticsEmpty))
  })

  it('shows the no-problems note when the filter empties a non-empty record', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1 }),
    )
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    fireEvent.click(screen.getByText(zh.diagnosticsLevelProblems))
    expect(container.textContent).toContain(zh.diagnosticsNoProblems)
    expect(container.textContent).not.toContain(zh.diagnosticsEmpty)
  })

  it('contains a crash in its own boundary and names the failure', async () => {
    // The card's locale lookup is the render throw; the fallback strings still
    // resolve through the stub. Reporting is the boundary's job, so this case
    // pins containment and a fallback that names the failure without throwing
    // again.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const explodingT: typeof t = (key, params) => {
        if (key === 'diagnosticsLogLabel') throw new Error('locale exploded')
        return t(key, params)
      }
      const { container } = render(
        <DiagnosticsCard
          t={explodingT}
          report={report}
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
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('×3'))
    fireEvent.click(screen.getByRole('button', { name: zh.diagnosticsDetail }))
    expect(container.querySelector('[data-open]')).toBeTruthy()
    expect(container.textContent).toContain('kind:"trashed"')
    expect(container.textContent).toContain(zh.diagnosticsDetail)
  })

  it('renders the verbose-diagnostics footer when the host flag is on', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ entries: [entry(1, 'info', 'transport.built')], total: 1, debug: true }),
    )
    const { container } = render(card(diagnostics))
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
    const { container } = render(card(diagnostics))
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
    const { container } = render(card(diagnostics))
    await waitFor(() => expect(container.textContent).toContain('string.event'))
    fireEvent.click(screen.getByRole('button', { name: zh.diagnosticsDetail }))
    expect(container.querySelector('[data-open]')).toBeTruthy()
    expect(container.textContent).toContain('value')
    expect(container.textContent).toContain('"plain string detail"')
  })
})
