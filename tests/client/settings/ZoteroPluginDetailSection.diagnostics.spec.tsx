// @vitest-environment jsdom
/**
 * Diagnostics integration in ZoteroPluginDetailSection: the log card lives
 * inside the one service status section, follows the section's single probe
 * answer, and keeps its own crash boundary.
 * @module tests/client/settings/ZoteroPluginDetailSection.diagnostics
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroPluginDetailSection } from '../../../src/client/components/plugin/ZoteroPluginDetailSection.tsx'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroDiagnosticsView, ZoteroStatusView } from '../../../src/client/remote.ts'
import { zh } from '../../../src/client/locales.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import { entry, okView } from '../helpers/diagnostics-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { statusView } from '../../helpers/status-view.ts'

const t = mockT
const client = () => zoteroClientStub()

afterEach(cleanup)

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

function connectedProbe(version = '7.0.5') {
  return async (): Promise<RemoteResult<ZoteroStatusView>> => ({
    ok: true,
    value: statusView({ connected: true, zoteroVersion: version }),
  })
}

function enabledDiagnostics() {
  return vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
    okView({ entries: [entry(1, 'info', 'transport.built')], total: 1, debug: true }),
  )
}

describe('ZoteroPluginDetailSection diagnostics', () => {
  it('keeps the log card inside the one service status section when debug is on', async () => {
    const { container } = render(
      <ZoteroPluginDetailSection
        subject={targetSubject}
        t={t}
        useZoteroClient={client}
        probe={connectedProbe()}
        diagnostics={enabledDiagnostics()}
      />,
    )

    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    const sections = container.querySelectorAll('[data-zotero-plugin-section]')
    expect(sections).toHaveLength(1)
    const section = sections[0]!
    expect(section.querySelector('[data-zotero-status-card]')).not.toBeNull()
    expect(section.querySelector('[data-zotero-diagnostics]')).not.toBeNull()
    // One heading for the whole section: the log card adds no section title.
    const headings = section.querySelectorAll('h4')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.textContent).toBe(t('detailSectionTitle'))
  })

  it('hides the log card when diagnostic mode is off', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
      okView({ debug: false }),
    )
    const { container } = render(
      <ZoteroPluginDetailSection
        subject={targetSubject}
        t={t}
        useZoteroClient={client}
        probe={connectedProbe()}
        diagnostics={diagnostics}
      />,
    )
    await waitFor(() => expect(diagnostics).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('[data-zotero-diagnostics]')).toBeNull())
  })

  it('probes connectivity only once for the whole section', async () => {
    const probe = vi.fn(connectedProbe())
    const { container } = render(
      <ZoteroPluginDetailSection
        subject={targetSubject}
        t={t}
        useZoteroClient={client}
        probe={probe}
        diagnostics={enabledDiagnostics()}
      />,
    )
    await waitFor(() => expect(container.textContent).toContain('transport.built'))
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('copies the section probe answer and follows its refresh', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    let callCount = 0
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => {
      callCount += 1
      return {
        ok: true,
        value:
          callCount === 1
            ? statusView({ connected: false, zoteroVersion: '7.0' })
            : statusView({ connected: true, zoteroVersion: '7.1' }),
      }
    })
    render(
      <ZoteroPluginDetailSection
        subject={targetSubject}
        t={t}
        useZoteroClient={client}
        probe={probe}
        diagnostics={enabledDiagnostics()}
      />,
    )

    await waitFor(() => expect(screen.getByText(t('statusUnavailable'))).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: zh.diagnosticsCopyBundle }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toContain('disconnected')
    expect(writeText.mock.calls[0]?.[0]).toContain('zotero: 7.0')

    fireEvent.click(screen.getAllByText(t('refresh'))[0]!)
    await waitFor(() => expect(screen.getByText(t('statusConnectedNote'))).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: zh.diagnosticsCopyBundle }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1]?.[0]).toContain('connected')
    expect(writeText.mock.calls[1]?.[0]).toContain('zotero: 7.1')
  })

  it('contains a log-card crash without taking down the connection card', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const explodingT: typeof t = (key, params) => {
        if (key === 'diagnosticsLogLabel') throw new Error('locale exploded')
        return t(key, params)
      }
      const { container } = render(
        <ZoteroPluginDetailSection
          subject={targetSubject}
          t={explodingT}
          useZoteroClient={client}
          probe={connectedProbe()}
          diagnostics={vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
            okView({ debug: true }),
          )}
        />,
      )
      await waitFor(() =>
        expect(container.querySelector('[data-zotero-surface-error]')).not.toBeNull(),
      )
      expect(container.textContent).toContain('locale exploded')
      expect(screen.getByText(t('statusConnectedNote'))).toBeDefined()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
