// @vitest-environment jsdom
/**
 * The data-maintenance section: five explicit phases, a confirmation gate
 * before any write, and copy resolved through the dictionary so no server
 * string or enum value reaches the DOM.
 * @module tests/client/ZoteroRemediationSection
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ZoteroRemediationSection } from '../../src/client/components/plugin/ZoteroRemediationSection.tsx'
import type { ZoteroRemediationReport, ZoteroRemediationResult } from '../../src/client/remote.ts'
import { mockT } from './helpers/mock-translate.ts'

afterEach(cleanup)

const t = mockT

/** One report carrying a single repairable session. */
const BROKEN_REPORT: ZoteroRemediationReport = {
  capability: 'available',
  scannedSessions: 3,
  issues: [
    {
      id: 'session-log:session-1aa4e258',
      category: 'session-log',
      severity: 'critical',
      reason: 'unknown-event-vocabulary',
      sessionId: 'session-1aa4e258',
      eventTypes: ['zotero/status'],
    },
  ],
  timestamp: 1_700_000_000_000,
}

/** A healthy scan of two sessions. */
const CLEAN_REPORT: ZoteroRemediationReport = {
  capability: 'available',
  scannedSessions: 2,
  issues: [],
  timestamp: 1_700_000_000_000,
}

/** A backend that stores sessions but exposes no artifact-maintenance seam. */
const SEAMLESS_REPORT: ZoteroRemediationReport = {
  ...BROKEN_REPORT,
  capability: 'unavailable',
}

function reporting(
  value: ZoteroRemediationReport,
): () => Promise<RemoteResult<ZoteroRemediationReport>> {
  return vi.fn(async () => ({ ok: true as const, value }))
}

function repairResult(
  value: ZoteroRemediationResult,
): (request: unknown) => Promise<RemoteResult<ZoteroRemediationResult>> {
  return vi.fn(async () => ({ ok: true as const, value }))
}

describe('ZoteroRemediationSection', () => {
  it('renders the idle phase without inspecting anything', () => {
    const inspect = reporting(CLEAN_REPORT)
    const execute = repairResult({ items: [], timestamp: 0 })

    render(<ZoteroRemediationSection t={t} inspect={inspect} execute={execute} />)

    expect(screen.getByText(t('remediationSectionTitle'))).toBeDefined()
    expect(screen.getByText(t('remediationIdle'))).toBeDefined()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('reports a clean scan after the operator asks for one', async () => {
    const inspect = reporting(CLEAN_REPORT)

    render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationHealthy'))).toBeDefined()
    })
    expect(screen.getByText(t('remediationScannedSummary', { sessions: 2 }))).toBeDefined()
    expect(screen.queryByText(t('remediationIdle'))).toBeNull()
  })

  it('never reports healthy when the deployment has no maintenance capability', async () => {
    const inspect = reporting({
      capability: 'unavailable',
      scannedSessions: 0,
      issues: [],
      timestamp: 0,
    })

    render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationCapabilityUnavailable'))).toBeDefined()
    })
    expect(screen.queryByText(t('remediationHealthy'))).toBeNull()
    expect(screen.queryByText(t('remediationScannedSummary', { sessions: 0 }))).toBeNull()
  })

  it('keeps the findings but withholds repair when the backend has no seam', async () => {
    const execute = repairResult({ items: [], timestamp: 0 })

    render(
      <ZoteroRemediationSection t={t} inspect={reporting(SEAMLESS_REPORT)} execute={execute} />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationCapabilityUnavailable'))).toBeDefined()
    })
    // The scan still measured the stored logs, so the finding stays visible…
    expect(screen.getByText('session-1aa4e258')).toBeDefined()
    expect(screen.getByText(t('remediationReasonUnknownVocabulary'))).toBeDefined()
    // …but an action that can only answer "unsupported" is not offered.
    expect(screen.queryByText(t('remediationRepair'))).toBeNull()
    expect(screen.queryByText(t('remediationConfirmTitle'))).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('lists the session and localizes the reason instead of the enum value', async () => {
    render(
      <ZoteroRemediationSection
        t={t}
        inspect={reporting(BROKEN_REPORT)}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(screen.getByText('session-1aa4e258')).toBeDefined()
    })
    expect(screen.getByText(t('remediationIssuesFound', { count: 1 }))).toBeDefined()
    expect(screen.getByText(t('remediationReasonUnknownVocabulary'))).toBeDefined()
    expect(screen.queryByText('unknown-event-vocabulary')).toBeNull()
    expect(screen.queryByText('session-log')).toBeNull()
  })

  it('confirms before repairing and cancels without writing', async () => {
    const execute = repairResult({ items: [], timestamp: 0 })
    render(<ZoteroRemediationSection t={t} inspect={reporting(BROKEN_REPORT)} execute={execute} />)
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })

    fireEvent.click(screen.getByText(t('remediationRepair')))

    expect(screen.getByText(t('remediationConfirmTitle'))).toBeDefined()
    expect(screen.getByText(t('remediationConfirmIrreversible'))).toBeDefined()
    expect(screen.getByText(t('remediationConfirmBody', { count: 1 }))).toBeDefined()

    fireEvent.click(screen.getByText(t('remediationCancel')))
    expect(screen.queryByText(t('remediationConfirmTitle'))).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('repairs the listed sessions once confirmed and shows what the backend measured', async () => {
    const execute = repairResult({
      items: [
        {
          issueId: 'session-log:session-1aa4e258',
          outcome: 'repaired',
          changedRecords: 4,
          totalRecords: 12,
          droppedTailBytes: 8,
          backupPath: '/store/session-1aa4e258/session.jsonl.zstd.keep',
        },
      ],
      timestamp: 1_700_000_000_000,
    })
    let reportIndex = 0
    const inspect = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationReport>> => {
      reportIndex += 1
      return { ok: true, value: reportIndex === 1 ? BROKEN_REPORT : CLEAN_REPORT }
    })

    render(<ZoteroRemediationSection t={t} inspect={inspect} execute={execute} />)
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationOutcomeRepaired'))).toBeDefined()
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(vi.mocked(execute).mock.calls[0]![0]).toEqual({
      issueIds: ['session-log:session-1aa4e258'],
    })
    expect(
      screen.getByText(t('remediationChangedRecords', { changed: 4, total: 12 })),
    ).toBeDefined()
    expect(screen.getByText(t('remediationDroppedTail', { bytes: 8 }))).toBeDefined()
    expect(screen.getByText(/session\.jsonl\.zstd\.keep/)).toBeDefined()
    // The post-repair scan replaced the issue list with the clean state.
    expect(screen.getByText(t('remediationHealthy'))).toBeDefined()
    expect(screen.queryByText(t('remediationConfirmTitle'))).toBeNull()
  })

  it('localizes a refusal outcome and never renders the enum value', async () => {
    const execute = repairResult({
      items: [{ issueId: 'session-log:session-1aa4e258', outcome: 'refused' }],
      timestamp: 0,
    })

    render(<ZoteroRemediationSection t={t} inspect={reporting(BROKEN_REPORT)} execute={execute} />)
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationOutcomeRefused'))).toBeDefined()
    })
    expect(screen.queryByText('refused')).toBeNull()
  })

  it('surfaces a failed inspection instead of an empty healthy report', async () => {
    const inspect = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationReport>> => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'store unavailable', {}),
    }))

    const { container } = render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(container.querySelector('[data-remediation-error]')).not.toBeNull()
    })
    expect(container.querySelector('[data-remediation-error]')?.textContent).toContain(
      'store unavailable',
    )
    expect(screen.queryByText(t('remediationHealthy'))).toBeNull()
    expect(screen.queryByText(t('remediationIdle'))).toBeNull()
  })

  it('paints a session that merely failed to open as a warning, not an error', async () => {
    const inspect = reporting({
      capability: 'available',
      scannedSessions: 1,
      issues: [
        {
          id: 'session-log:session-9f21',
          category: 'session-log',
          severity: 'warning',
          reason: 'open-failed',
          sessionId: 'session-9f21',
          eventTypes: [],
        },
      ],
      timestamp: 0,
    })

    const { container } = render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationReasonOpenFailed'))).toBeDefined()
    })
    // An open that failed proves nothing about the stored bytes: a red dot
    // would claim damage the scan never established.
    expect(container.querySelector('[data-state="error"]')).toBeNull()
  })

  it('reports a rejected inspection call and releases the controls', async () => {
    const inspect = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationReport>> => {
      throw new Error('carrier dropped')
    })

    const { container } = render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))

    await waitFor(() => {
      expect(container.querySelector('[data-remediation-error]')?.textContent).toContain(
        'carrier dropped',
      )
    })
    const trigger = screen.getByText(t('remediationScan')).closest('button') as HTMLButtonElement
    expect(trigger.disabled).toBe(false)
    expect(screen.queryByText(t('remediationHealthy'))).toBeNull()
  })

  it('reports a refused repair request without claiming any result', async () => {
    const execute = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationResult>> => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'maintenance offline', {}),
    }))

    const { container } = render(
      <ZoteroRemediationSection t={t} inspect={reporting(BROKEN_REPORT)} execute={execute} />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))

    await waitFor(() => {
      expect(container.querySelector('[data-remediation-error]')?.textContent).toContain(
        'maintenance offline',
      )
    })
    expect(container.querySelector('[data-outcome]')).toBeNull()
    // The gate closes again, so the operator can retry after reading why.
    expect(screen.queryByText(t('remediationConfirmTitle'))).toBeNull()
  })

  it('reports a repair that throws instead of leaving the section spinning', async () => {
    const execute = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationResult>> => {
      throw new Error('socket closed')
    })

    const { container } = render(
      <ZoteroRemediationSection t={t} inspect={reporting(BROKEN_REPORT)} execute={execute} />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))

    await waitFor(() => {
      expect(container.querySelector('[data-remediation-error]')?.textContent).toContain(
        'socket closed',
      )
    })
    const trigger = screen.getByText(t('remediationScan')).closest('button') as HTMLButtonElement
    expect(trigger.disabled).toBe(false)
    expect(screen.queryByText(t('remediationConfirmTitle'))).toBeNull()
  })

  it('keeps the pre-repair list when the refresh after a repair fails', async () => {
    let call = 0
    const inspect = vi.fn(async (): Promise<RemoteResult<ZoteroRemediationReport>> => {
      call += 1
      return call === 1
        ? { ok: true, value: BROKEN_REPORT }
        : { ok: false, error: new RemoteError('gateway/internal', 'listing failed', {}) }
    })
    const execute = repairResult({
      items: [
        {
          issueId: 'session-log:session-1aa4e258',
          outcome: 'repaired',
          changedRecords: 2,
          totalRecords: 6,
        },
      ],
      timestamp: 0,
    })

    render(<ZoteroRemediationSection t={t} inspect={inspect} execute={execute} />)
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))

    await waitFor(() => {
      expect(screen.getByText(t('remediationOutcomeRepaired'))).toBeDefined()
    })
    // Stale but true beats blank: the failed refresh must not erase the list
    // the user is about to act on.
    expect(screen.getByText('session-1aa4e258')).toBeDefined()
    expect(screen.queryByText(t('remediationHealthy'))).toBeNull()
  })

  it('drops a scan that resolves after the section is unmounted', async () => {
    let settle: (value: RemoteResult<ZoteroRemediationReport>) => void = () => {}
    const inspect = vi.fn(
      () =>
        new Promise<RemoteResult<ZoteroRemediationReport>>((resolve) => {
          settle = resolve
        }),
    )

    const { unmount } = render(
      <ZoteroRemediationSection
        t={t}
        inspect={inspect}
        execute={repairResult({ items: [], timestamp: 0 })}
      />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))
    unmount()
    settle({ ok: true, value: CLEAN_REPORT })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    // No late state write, so nothing is left behind and nothing throws.
    expect(document.body.textContent).toBe('')
  })

  it('drops a repair that resolves after the section is unmounted', async () => {
    let settle: (value: RemoteResult<ZoteroRemediationResult>) => void = () => {}
    const execute = vi.fn(
      () =>
        new Promise<RemoteResult<ZoteroRemediationResult>>((resolve) => {
          settle = resolve
        }),
    )

    const { unmount } = render(
      <ZoteroRemediationSection t={t} inspect={reporting(BROKEN_REPORT)} execute={execute} />,
    )
    fireEvent.click(screen.getByText(t('remediationScan')))
    await waitFor(() => {
      expect(screen.getByText(t('remediationRepair'))).toBeDefined()
    })
    fireEvent.click(screen.getByText(t('remediationRepair')))
    fireEvent.click(screen.getByText(t('remediationConfirmAction')))
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1)
    })
    unmount()
    settle({ ok: true, value: { items: [], timestamp: 0 } })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(document.body.textContent).toBe('')
  })
})
