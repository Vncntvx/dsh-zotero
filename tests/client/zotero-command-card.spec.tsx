// @vitest-environment jsdom
/**
 * Test suite for ZoteroCommandCard (conversation.chat.commandview slot).
 * Validates running, connected, disconnected, error, and probe re-check flows.
 * @module tests/client/zotero-command-card
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ZoteroCommandCard } from '../../src/client/ZoteroCommandCard.tsx'
import { zh } from '../../src/client/locales.ts'
import { mockT } from './helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeCommandNode(data: Partial<CommandNode> = {}): CommandNode {
  return {
    kind: 'command',
    seq: 1,
    time: 1_700_000_000_000,
    commandId: 'cmd-zotero' as never,
    name: 'zotero',
    args: ' status',
    outcome: null,
    ...data,
  }
}

describe('ZoteroCommandCard', () => {
  it('renders running state with shimmer and non-expandable disclosure', () => {
    const node = makeCommandNode({ outcome: null })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    const card = container.querySelector('[data-zotero-command-card]')
    expect(card).toBeTruthy()
    expect(screen.getByText(zh.commandChecking)).toBeTruthy()
    expect(container.querySelector('[data-disclosure-trigger]')).toBeTruthy()
  })

  it('renders error state and expands to show error details', () => {
    const node = makeCommandNode({
      outcome: { kind: 'error', text: 'Usage: /zotero [status]' },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    expect(screen.getByText(zh.commandFailed)).toBeTruthy()

    // Trigger expansion
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(screen.getByText('Usage: /zotero [status]')).toBeTruthy()
  })

  it('renders connected status with full structured details', () => {
    const rawText = [
      'Zotero local API: connected',
      'Zotero version: 7.0.11',
      'API version: 3',
      'Schema version: 1',
      'Server ID: 0123456789abcdef',
      'Write: enabled (key stored)',
    ].join('\n')

    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    // Collapsed summary checks
    expect(screen.getByText('/zotero status')).toBeTruthy()
    expect(screen.getAllByText('7.0.11').length).toBeGreaterThanOrEqual(1)

    // Expand
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
    expect(screen.getByText(`3 (${zh.schemaVersionLabel}: 1)`)).toBeTruthy()
    expect(screen.getByText('0123456789abcdef')).toBeTruthy()
    expect(screen.getByText(zh.writeAuthorizedLabel)).toBeTruthy()
  })

  it('renders connected status with unreported Server ID and write variations', () => {
    const rawText = [
      'Zotero local API: connected',
      'Zotero version: 6.0.30',
      'API version: 3',
      'Schema version: 1',
      'Server ID: not reported — this build does not identify its database',
      'Write: disabled',
    ].join('\n')

    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(screen.getByText(zh.statusServerIdUnreported)).toBeTruthy()
    expect(screen.getByText(zh.writeDisabledLabel)).toBeTruthy()
  })

  it('renders write unauthorized label when key is not stored yet', () => {
    const rawText = ['Zotero local API: connected', 'Write: enabled (no key yet)'].join('\n')

    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(screen.getByText(zh.writeUnauthorizedLabel)).toBeTruthy()
  })

  it('renders disconnected status with localized diagnosis code and message', () => {
    const rawText = [
      'Zotero local API: not connected',
      'ZOTERO_NOT_RUNNING: Zotero is offline',
    ].join('\n')

    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(screen.getByText('ZOTERO_NOT_RUNNING')).toBeTruthy()
    expect(screen.getByText(zh.diagnosisNotRunning)).toBeTruthy()
  })

  it('renders unrecognized raw text if output does not match connected/disconnected format', () => {
    const rawText = 'Some unexpected console output from plugin'
    const node = makeCommandNode({
      name: 'zotero',
      outcome: { kind: 'success', text: rawText },
    })
    const { container } = render(<ZoteroCommandCard node={node} t={mockT} />)

    expect(screen.getByText(rawText)).toBeTruthy()

    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    expect(container.querySelector('pre')?.textContent).toBe(rawText)
  })

  it('supports interactive re-check when probe is provided and guards in-flight clicks', async () => {
    const rawText = ['Zotero local API: not connected', 'ZOTERO_NOT_RUNNING: offline'].join('\n')

    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })

    let probeCalls = 0
    let resolveProbe: ((val: unknown) => void) | undefined
    const probePromise = new Promise((resolve) => {
      resolveProbe = resolve
    })

    const probe = vi.fn(async () => {
      probeCalls++
      return probePromise as Promise<never>
    })

    const { container } = render(<ZoteroCommandCard node={node} t={mockT} probe={probe} />)

    // Expand to reveal actions
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    expect(refreshBtn).toBeTruthy()

    // Click re-check
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(probeCalls).toBe(1)
    expect(screen.getByText(zh.checking)).toBeTruthy()

    // Rapid second click during in-flight should be ignored
    await act(async () => {
      fireEvent.click(refreshBtn)
    })
    expect(probeCalls).toBe(1)

    // Resolve probe as now connected with full metrics
    await act(async () => {
      resolveProbe?.({
        ok: true,
        value: {
          connected: true,
          zoteroVersion: '7.0.15',
          apiVersion: '3',
          schemaVersion: '2',
          serverId: 'probed-server-id',
          write: { enabled: true, authorized: true },
        },
      })
    })

    // Now card reflects updated live probe state across all metrics
    expect(screen.getAllByText('7.0.15').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(`3 (${zh.schemaVersionLabel}: 2)`)).toBeTruthy()
    expect(screen.getByText('probed-server-id')).toBeTruthy()
    expect(screen.getByText(zh.writeAuthorizedLabel)).toBeTruthy()
  })

  it('handles probe errors during interactive re-check', async () => {
    const rawText = 'Zotero local API: connected\nZotero version: 7.0.11'
    const node = makeCommandNode({
      outcome: { kind: 'success', text: rawText },
    })

    const probe = vi.fn(async () => {
      throw new Error('Network error during probe')
    })

    const { container } = render(<ZoteroCommandCard node={node} t={mockT} probe={probe} />)

    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(screen.getAllByText('Network error during probe').length).toBeGreaterThanOrEqual(1)
  })

  it('handles probe throwing a non-Error object during re-check', async () => {
    const rawText = 'Zotero local API: connected\nZotero version: 7.0.11'
    const node = makeCommandNode({ outcome: { kind: 'success', text: rawText } })

    const probe = vi.fn(async () => {
      throw 'Raw probe string failure'
    })

    const { container } = render(<ZoteroCommandCard node={node} t={mockT} probe={probe} />)
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(screen.getAllByText('Raw probe string failure').length).toBeGreaterThanOrEqual(1)
  })

  it('handles probe returning ok: false with error message', async () => {
    const rawText = 'Zotero local API: connected\nZotero version: 7.0.11'
    const node = makeCommandNode({ outcome: { kind: 'success', text: rawText } })

    const probe = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Remote service unavailable' } as never,
    }))

    const { container } = render(<ZoteroCommandCard node={node} t={mockT} probe={probe} />)
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(screen.getAllByText('Remote service unavailable').length).toBeGreaterThanOrEqual(1)
  })

  it('renders "-" when live probe succeeds without zoteroVersion rather than falling back to parsed version', async () => {
    const rawText = [
      'Zotero local API: connected',
      'Zotero version: 7.0.11',
      'API version: 3',
      'Schema version: 1',
    ].join('\n')

    const node = makeCommandNode({ outcome: { kind: 'success', text: rawText } })

    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        diagnosis: '',
        connected: true,
        zoteroVersion: undefined,
        apiVersion: undefined,
        schemaVersion: undefined,
        serverId: undefined,
      },
    }))

    const { container } = render(<ZoteroCommandCard node={node} t={mockT} probe={probe} />)
    const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    // Should NOT show the old '7.0.11' in the version metric cell anymore
    expect(screen.queryByText('7.0.11')).toBeNull()
    // Should show '-' for unprovided version and api/schema
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })
})
