// @vitest-environment jsdom
/**
 * Unit tests for ZoteroPluginDetailSection component (plugins.detail.section slot).
 * @module tests/client/ZoteroPluginDetailSection
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroPluginDetailSection } from '../../src/client/components/plugin/ZoteroPluginDetailSection.tsx'
import type { PluginsSubject } from '../../src/client/components/plugin/types.ts'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../../src/client/remote.ts'

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

afterEach(cleanup)

const targetSubject: PluginsSubject = {
  kind: 'bundle',
  pkg: {
    name: 'dsh-zotero',
    version: '0.1.0',
    installed: true,
    enabled: true,
    rows: [],
  },
}

const otherSubject: PluginsSubject = {
  kind: 'bundle',
  pkg: {
    name: 'other-plugin',
    installed: true,
    enabled: true,
    rows: [],
  },
}

const rowSubject: PluginsSubject = {
  kind: 'row',
  pkg: {
    name: 'dsh-zotero',
    installed: true,
    enabled: true,
    rows: [],
  },
  row: {
    rowId: 'row-1',
    moduleName: 'zotero',
    enabled: true,
  },
}

describe('ZoteroPluginDetailSection', () => {
  it('returns null when subject is not bundle dsh-zotero', () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true as const,
      value: { providerId: 'local', connected: true, diagnosis: 'ok' },
    }))

    const { container: c1 } = render(
      <ZoteroPluginDetailSection subject={otherSubject} t={t} probe={probe} />,
    )
    expect(c1.innerHTML).toBe('')

    const { container: c2 } = render(
      <ZoteroPluginDetailSection subject={rowSubject} t={t} probe={probe} />,
    )
    expect(c2.innerHTML).toBe('')
    expect(probe).not.toHaveBeenCalled()
  })

  it('renders connected status and version when probe succeeds and connected is true', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        providerId: 'local',
        connected: true,
        zoteroVersion: '7.0.5',
        diagnosis: 'Zotero is running and responsive',
      },
    }))

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    expect(screen.getByText(t('detailSectionTitle'))).toBeDefined()
    expect(screen.getByText(t('tipsLabel'))).toBeDefined()
    expect(screen.getByText(t('tipNoKey'))).toBeDefined()
    expect(screen.getByText(t('tipFulltext'))).toBeDefined()
    expect(screen.getByText(t('tipSettingsNav'))).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText(`● ${t('statusConnectedNote')}`)).toBeDefined()
    })
    expect(screen.getByText(`${t('zoteroVersionLabel')}: 7.0.5`)).toBeDefined()
  })

  it('renders disconnected status and diagnosis when connected is false', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        providerId: 'local',
        connected: false,
        diagnosis: 'Zotero is not running on 127.0.0.1:23119',
      },
    }))

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(`○ ${t('statusUnavailable')}`)).toBeDefined()
    })
    expect(screen.getByText(`${t('diagnosisLabel')}:`)).toBeDefined()
    expect(screen.getByText('Zotero is not running on 127.0.0.1:23119')).toBeDefined()
  })

  it('localizes a coded diagnosis and keeps the technical code visible', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        providerId: 'local',
        connected: false,
        diagnosis: 'ZOTERO_NOT_RUNNING: Zotero is not running or unreachable.',
      },
    }))

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(`○ ${t('statusUnavailable')}`)).toBeDefined()
    })
    expect(screen.getByText('ZOTERO_NOT_RUNNING')).toBeDefined()
    expect(screen.getByText(t('diagnosisNotRunning'))).toBeDefined()
  })

  it('renders disconnected status when probe returns an error result', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'Failed to connect to local gateway', {}),
    }))

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(`○ ${t('statusUnavailable')}`)).toBeDefined()
    })
    expect(screen.getByText(`${t('diagnosisLabel')}:`)).toBeDefined()
    expect(screen.getByText('Failed to connect to local gateway')).toBeDefined()
  })

  it('handles probe throwing an exception', async () => {
    const probe = vi.fn(async () => {
      throw new Error('Network fatal')
    })

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(`○ ${t('statusUnavailable')}`)).toBeDefined()
    })
    expect(screen.getByText(`${t('diagnosisLabel')}:`)).toBeDefined()
    expect(screen.getByText('Network fatal')).toBeDefined()
  })

  it('allows manual refresh via refresh button', async () => {
    let callCount = 0
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => {
      callCount += 1
      if (callCount === 1) {
        return {
          ok: true,
          value: { providerId: 'local', connected: false, diagnosis: 'not ready' },
        }
      }
      return {
        ok: true,
        value: { providerId: 'local', connected: true, zoteroVersion: '7.1.0', diagnosis: 'ok' },
      }
    })

    render(<ZoteroPluginDetailSection subject={targetSubject} t={t} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(`○ ${t('statusUnavailable')}`)).toBeDefined()
    })

    const refreshBtn = screen.getByText(t('refresh'))
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(screen.getByText(`● ${t('statusConnectedNote')}`)).toBeDefined()
    })
    expect(screen.getByText(`${t('zoteroVersionLabel')}: 7.1.0`)).toBeDefined()
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
