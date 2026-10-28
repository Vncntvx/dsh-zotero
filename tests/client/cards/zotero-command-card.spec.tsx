// @vitest-environment jsdom
/**
 * Test suite for ZoteroCommandCard (conversation.chat.commandview slot).
 *
 * The card reads structured facts from the `zoteroStatus` session projection the
 * command handler points at with `sourceEventSeq`, and renders the command text
 * verbatim as the human answer. Cases therefore build a projected snapshot
 * (`projected`) rather than a parseable line format; the text is only used to
 * assert what the card shows when there is nothing structured to show.
 * @module tests/client/cards/zotero-command-card
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ZoteroCommandCard } from '../../../src/client/ZoteroCommandCard.tsx'
import { zh } from '../../../src/client/locales.ts'
import type { ZoteroStatusView } from '../../../src/contract.ts'
import { withStandardProps } from '../helpers/command-card-props.ts'
import { mockT } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
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

/** One command outcome carrying the human-readable answer the host formatted. */
function successText(text: string): CommandNode {
  return makeCommandNode({ outcome: { kind: 'success', text } })
}

/** Render the card with the standard slot props and an optional projection. */
function renderCard(
  node: CommandNode,
  options: {
    projected?: ZoteroStatusView
    probe?: () => Promise<never>
    projectionCapability?: boolean
  } = {},
): { container: HTMLElement; rerender: (ui: ReactElement) => void } {
  const { probe, projected, projectionCapability } = options
  const props = withStandardProps(
    { node, t: mockT, ...(probe === undefined ? {} : { probe }) },
    {
      ...(projected === undefined ? {} : { projected }),
      ...(projectionCapability === undefined ? {} : { projectionCapability }),
    },
  )
  const { container, rerender } = render(<ZoteroCommandCard {...props} />)
  return { container, rerender }
}

/** Expand the disclosure row so the body renders. */
function expand(container: HTMLElement): void {
  const trigger = container.querySelector('[data-disclosure-trigger]') as HTMLElement
  fireEvent.click(trigger)
}

describe('ZoteroCommandCard', () => {
  it('renders running state with shimmer and non-expandable disclosure', () => {
    const { container } = renderCard(makeCommandNode({ outcome: null }))

    const card = container.querySelector('[data-zotero-command-card]')
    expect(card).toBeTruthy()
    expect(screen.getByText(zh.commandChecking)).toBeTruthy()
    expect(container.querySelector('[data-disclosure-trigger]')).toBeTruthy()
  })

  it('renders error state and expands to show error details', () => {
    const { container } = renderCard(
      makeCommandNode({ outcome: { kind: 'error', text: 'Usage: /zotero [status]' } }),
    )

    expect(screen.getByText(zh.commandFailed)).toBeTruthy()

    expand(container)
    expect(screen.getByText('Usage: /zotero [status]')).toBeTruthy()
  })

  it('renders command error text when outcome has no sourceEventSeq even if projection exists', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      endpoint: '127.0.0.1:23119',
    }
    const { container } = renderCard(
      makeCommandNode({ outcome: { kind: 'error', text: 'Usage: /zotero [status]' } }),
      { projected },
    )

    expect(screen.getByText(zh.commandFailed)).toBeTruthy()
    expand(container)
    expect(screen.getByText('Usage: /zotero [status]')).toBeTruthy()
  })

  it('shows the projected facts for an error outcome that names its event', () => {
    // The inverse edge: an errored run that still logged a `zotero/status`
    // event (the probe failed after the event was appended) points at real
    // facts, so the body renders them instead of the raw text.
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: false,
      endpoint: '127.0.0.1:23119',
      diagnosis: 'ZOTERO_NOT_RUNNING',
    }
    const { container } = renderCard(
      makeCommandNode({
        outcome: { kind: 'error', text: 'probe failed', sourceEventSeq: 7 },
      }),
      { projected },
    )

    expand(container)
    // The endpoint row is the fact worth reading on a disconnected card.
    expect(screen.queryByText('probe failed')).toBeNull()
    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
    expect(container.querySelector('[data-zotero-command-card-body]')).toBeTruthy()
  })

  it('falls back to the command text when the composition has no projection registry', async () => {
    // `useProjection` answering `undefined` is the upstream's "capability
    // absent" answer (the host unit unmounted), which is not the same as a
    // session that recorded no probe (`null`): with no registry the card has
    // no structured source at all, so the command text is what it renders and
    // the live probe is the only way to facts.
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        connected: true,
        endpoint: '127.0.0.1:23119',
        zoteroVersion: '7.0.11',
      },
    }))
    const { container } = renderCard(successText('Zotero local API: connected'), {
      probe: probe as unknown as () => Promise<never>,
      projectionCapability: false,
    })

    // No structured body before the probe lands: the raw text stands in both
    // the summary and the expanded body.
    expect(container.querySelector('[data-zotero-command-card-body]')).toBeNull()
    expand(container)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('Zotero local API: connected')

    // The re-probe action is still offered, and it reaches the face's probe.
    const button = screen.getByText(zh.refresh)
    await act(async () => {
      fireEvent.click(button)
    })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('names the endpoint the projection recorded, not a configured default', () => {
    // `baseUrl` is a live config field, so a card that hardcoded
    // 127.0.0.1:23119 would send a user of another address to the wrong port.
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: 'localhost:23119',
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: '3',
    }
    const { container } = renderCard(successText('Zotero local API: connected'), { projected })

    expand(container)
    expect(screen.getByText('localhost:23119')).toBeTruthy()
  })

  it('takes the endpoint from a live probe over the projected one', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: true,
      zoteroVersion: '7.0.11',
    }
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: { providerId: 'local', endpoint: '[::1]:23119', connected: true },
    }))

    const { container } = renderCard(successText('Zotero local API: connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await act(async () => {})

    // The probe's own address wins: it is the one that answered.
    expect(screen.getByText('[::1]:23119')).toBeTruthy()
    expect(screen.queryByText('127.0.0.1:23119')).toBeNull()
  })

  it('keeps the endpoint after a live probe reports Zotero offline', async () => {
    // A probe that reaches Zotero and is told it is down sets *both* `data`
    // and `error`, and that answer still carries the address it dialled. Gating
    // the row on "no error" would blank it exactly when the user clicked
    // Refresh to find out what was wrong: the one moment the address matters.
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
    }
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        endpoint: '127.0.0.1:23119',
        connected: false,
        diagnosis: 'ZOTERO_NOT_RUNNING: offline',
      },
    }))

    const { container } = renderCard(successText('Zotero local API: not connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await act(async () => {})

    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
    expect(screen.getByText(zh.diagnosisNotRunning)).toBeTruthy()
  })

  it('prefers a live probe address over the projected one even when it is offline', async () => {
    // The probe reports what it dialled, which need not be the address the
    // command recorded; the probe wins on both the connected and the
    // disconnected arm.
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
    }
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        endpoint: 'localhost:23119',
        connected: false,
        diagnosis: 'ZOTERO_NOT_RUNNING: offline',
      },
    }))

    const { container } = renderCard(successText('Zotero local API: not connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await act(async () => {})

    expect(screen.getByText('localhost:23119')).toBeTruthy()
    expect(screen.queryByText('127.0.0.1:23119')).toBeNull()
  })

  it('names the endpoint on a disconnected card, where it matters most', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
    }
    const { container } = renderCard(successText('Zotero local API: not connected'), { projected })

    expand(container)
    // The address that did not answer is the first thing worth checking, so it
    // is shown on the failure arm too.
    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
    expect(screen.getByText(zh.diagnosisNotRunning)).toBeTruthy()
  })

  it('offers a re-probe on an errored card, which has no facts at all', () => {
    const probe = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'no namespace' } as never,
    }))

    const { container } = renderCard(
      makeCommandNode({ outcome: { kind: 'error', text: 'Usage: /zotero [status]' } }),
      { probe: probe as never },
    )
    expand(container)

    expect(screen.getByText('Usage: /zotero [status]')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.refresh })).toBeTruthy()
  })

  it('shows the command text verbatim when the session recorded no projection', () => {
    const rawText = 'Some unexpected console output from plugin'
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: { providerId: 'local', connected: true },
    }))

    const { container } = renderCard(successText(rawText), { probe: probe as never })
    expand(container)

    // No structured facts and no probe answer yet: the text is all there is.
    expect(container.querySelector('pre')?.textContent).toBe(rawText)
    expect(screen.getByRole('button', { name: zh.refresh })).toBeTruthy()
  })

  it('renders connected status with full structured details', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: '3',
      schemaVersion: '1',
      serverId: '0123456789abcdef',
      write: { enabled: true, authorized: true },
    }
    const { container } = renderCard(successText('Zotero local API: connected'), { projected })

    expect(screen.getByText('/zotero status')).toBeTruthy()
    expect(screen.getAllByText('7.0.11').length).toBeGreaterThanOrEqual(1)

    expand(container)
    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
    expect(screen.getByText(`3 (${zh.schemaVersionLabel}: 1)`)).toBeTruthy()
    expect(screen.getByText('0123456789abcdef')).toBeTruthy()
    expect(screen.getByText(zh.writeAuthorizedLabel)).toBeTruthy()
  })

  it('renders connected status with unreported Server ID and write variations', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      zoteroVersion: '6.0.30',
      apiVersion: '3',
      schemaVersion: '1',
      write: { enabled: false, authorized: false },
    }
    const { container } = renderCard(successText('Zotero local API: connected'), { projected })

    expand(container)
    expect(screen.getByText(zh.statusServerIdUnreported)).toBeTruthy()
    expect(screen.getByText(zh.writeDisabledLabel)).toBeTruthy()
  })

  it('renders write unauthorized label when key is not stored yet', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      write: { enabled: true, authorized: false },
    }
    const { container } = renderCard(successText('Zotero local API: connected'), { projected })

    expand(container)
    expect(screen.getByText(zh.writeUnauthorizedLabel)).toBeTruthy()
  })

  it('renders disconnected status with localized diagnosis code and message', () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      endpoint: '127.0.0.1:23119',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: Zotero is offline',
    }
    const { container } = renderCard(successText('Zotero local API: not connected'), { projected })

    expand(container)
    expect(screen.getByText('ZOTERO_NOT_RUNNING')).toBeTruthy()
    expect(screen.getByText(zh.diagnosisNotRunning)).toBeTruthy()
  })

  it('shows the command text verbatim when the projection is absent', () => {
    const rawText = 'Some unexpected console output from plugin'
    const { container } = renderCard(successText(rawText))

    expect(screen.getByText(rawText)).toBeTruthy()

    expand(container)
    expect(container.querySelector('pre')?.textContent).toBe(rawText)
  })

  it('supports interactive re-check when probe is provided and guards in-flight clicks', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
    }

    let probeCalls = 0
    let resolveProbe: ((val: unknown) => void) | undefined
    const probePromise = new Promise((resolve) => {
      resolveProbe = resolve
    })

    const probe = vi.fn(async () => {
      probeCalls++
      return probePromise as Promise<never>
    })

    const { container } = renderCard(successText('Zotero local API: not connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)

    const refreshBtn = screen.getByRole('button', { name: zh.refresh })
    expect(refreshBtn).toBeTruthy()

    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(probeCalls).toBe(1)
    expect(screen.getByText(zh.checking)).toBeTruthy()

    // Rapid second click during in-flight is ignored.
    await act(async () => {
      fireEvent.click(refreshBtn)
    })
    expect(probeCalls).toBe(1)

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

    expect(screen.getAllByText('7.0.15').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(`3 (${zh.schemaVersionLabel}: 2)`)).toBeTruthy()
    expect(screen.getByText('probed-server-id')).toBeTruthy()
    expect(screen.getByText(zh.writeAuthorizedLabel)).toBeTruthy()
  })

  it('handles probe errors during interactive re-check while keeping projected endpoint', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      endpoint: '127.0.0.1:23119',
      zoteroVersion: '7.0.11',
    }
    const probe = vi.fn(async () => {
      throw new Error('Network error during probe')
    })

    const { container } = renderCard(successText('Zotero local API: connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    })

    expect(screen.getAllByText('Network error during probe').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
  })

  it('handles probe throwing a non-Error object during re-check', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      zoteroVersion: '7.0.11',
    }
    const probe = vi.fn(async () => {
      throw 'Raw probe string failure'
    })

    const { container } = renderCard(successText('Zotero local API: connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    })

    expect(screen.getAllByText('Raw probe string failure').length).toBeGreaterThanOrEqual(1)
  })

  it('handles probe returning ok: false with error message', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      zoteroVersion: '7.0.11',
    }
    const probe = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Remote service unavailable' } as never,
    }))

    const { container } = renderCard(successText('Zotero local API: connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    })

    expect(screen.getAllByText('Remote service unavailable').length).toBeGreaterThanOrEqual(1)
  })

  it('renders "-" when live probe succeeds without a version rather than falling back to the projection', async () => {
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: '3',
      schemaVersion: '1',
    }
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        connected: true,
        zoteroVersion: undefined,
        apiVersion: undefined,
        schemaVersion: undefined,
        serverId: undefined,
      },
    }))

    const { container } = renderCard(successText('Zotero local API: connected'), {
      projected,
      probe: probe as never,
    })
    expand(container)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    })

    // A refreshed probe that reports no version leaves the metric blank.
    expect(screen.queryByText('7.0.11')).toBeNull()
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  it('switches an errored card from raw text to the projected facts when its event lands', async () => {
    // The outcome object is mutable upstream (the conversation record settles
    // in place), so a node can gain `sourceEventSeq` without its identity
    // changing. The body memo reads that field, so it has to sit in the memo's
    // dependency list: without it the expanded body would keep rendering the
    // raw text after the event arrives.
    const projected: ZoteroStatusView = {
      providerId: 'local',
      connected: false,
      endpoint: '127.0.0.1:23119',
      diagnosis: 'ZOTERO_NOT_RUNNING',
    }
    const node = makeCommandNode({
      outcome: { kind: 'error', text: 'probe failed' },
    })
    const { container, rerender } = renderCard(node, { projected })
    expand(container)
    expect(container.querySelector('pre')?.textContent).toBe('probe failed')

    // The handler's event lands on the same record.
    ;(node.outcome as { sourceEventSeq?: number }).sourceEventSeq = 7
    rerender(<ZoteroCommandCard {...withStandardProps({ node, t: mockT }, { projected })} />)

    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('[data-zotero-command-card-body]')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:23119')).toBeTruthy()
  })
})
