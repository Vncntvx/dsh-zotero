// @vitest-environment jsdom
/**
 * The diagnostics copy bundle: the text it assembles, the copied feedback, the
 * unavailable/refused clipboard arms, and the in-flight no-op.
 * @module tests/client/DiagnosticsCard.copy
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { DiagnosticsCard } from '../../src/client/components/DiagnosticsCard.tsx'
import type { ZoteroDiagnosticsView, ZoteroStatusView } from '../../src/client/remote.ts'
import { zh } from '../../src/client/locales.ts'
import { deferred, type Deferred } from '../helpers/sync.js'
import { entry, fakeProbe, okView, targetSubject } from './helpers/diagnostics-fixtures.ts'
import { mockT } from './helpers/mock-translate.ts'

afterEach(cleanup)

const t = mockT

describe('DiagnosticsCard copy', () => {
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
})
