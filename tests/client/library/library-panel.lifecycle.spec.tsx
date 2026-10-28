// @vitest-environment jsdom
/**
 * Probe-driven chrome and the session view's lifecycle: the diagnostics menu
 * facts, the offline note with and without a diagnosis, and the per-session
 * cache a removed session drops.
 * @module tests/client/library/library-panel.lifecycle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { CONNECTED, ITEM_DETAIL, mountPanel } from '../helpers/library-panel-harness.tsx'
import {
  readLibrarySessionMemory,
  writeLibrarySessionView,
} from '../../../src/client/components/library/library-storage.ts'
import { deferred } from '../../helpers/sync.js'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(cleanup)

describe('probe-driven chrome', () => {
  it('lists the probe facts in the diagnostics menu', async () => {
    mountPanel({
      status: vi.fn(async () => ({
        ok: true as const,
        value: { ...CONNECTED, zoteroVersion: '7.0.15', apiVersion: '3' },
      })),
    })
    await screen.findByText(zh.libraryConnected)
    fireEvent.click(screen.getByRole('button', { name: zh.detailsLabel }))
    expect(await screen.findByText(/7\.0\.15/)).toBeTruthy()
  })

  it('omits the diagnosis line when the offline answer carries none', async () => {
    mountPanel({
      status: vi.fn(async () => ({
        ok: true as const,
        value: { ...CONNECTED, connected: false },
      })),
    })
    await screen.findByText(zh.libraryOffline)
    expect(screen.getByRole('note').textContent).toBe(zh.libraryOfflineNote)
  })

  it('holds every lane until the mount own probe answers, cached snapshot or not', async () => {
    writeLibrarySessionView('s1', { lastProbeData: CONNECTED })
    const probe = deferred<{ ok: true; value: typeof CONNECTED }>()
    const { face } = mountPanel({ status: vi.fn(() => probe.promise) })

    // The cached snapshot paints the workspace; it never opens the library
    // lanes and never flashes the offline note while the probe is in flight.
    // (The write form's item-type vocabulary is a separate, ungated read.)
    const browsed = () => face.browse.mock.calls.map(([request]) => request.kind)
    expect(screen.queryByText(zh.libraryOfflineNote)).toBeNull()
    expect(browsed()).not.toContain('libraries')
    expect(browsed()).not.toContain('collections')
    expect(face.search).not.toHaveBeenCalled()
    expect(face.item).not.toHaveBeenCalled()

    await act(async () => {
      probe.resolve({ ok: true, value: CONNECTED })
    })
    await waitFor(() => expect(browsed()).toContain('libraries'))
  })
})

describe('session view lifecycle', () => {
  it('drops the session view when the session is removed', async () => {
    writeLibrarySessionView('s1', { inspector: { phase: 'ready', detail: ITEM_DETAIL } })
    const probe = deferred<{ ok: true; value: typeof CONNECTED }>()
    mountPanel(
      { status: vi.fn(() => probe.promise) },
      {
        ids: ['s1'],
        byId: { s1: { cwd: '/tmp/ws', running: false, removed: true } },
        paneId: 's1',
      },
    )
    await waitFor(() => expect(readLibrarySessionMemory('s1')).toBeUndefined())
  })
})
