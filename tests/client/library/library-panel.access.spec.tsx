// @vitest-environment jsdom
/**
 * The library panel's per-action access gating: the write drawer, the
 * citation export, the attachment lookup, and the desktop hand-off answer
 * the Host's access answers independently, so a Peer that may read the
 * library but not write it keeps the list and loses the write form.
 * @module tests/client/library/library-panel.access
 */

import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { zh } from '../../../src/client/locales.ts'
import { mountPanel, CONNECTED } from '../helpers/library-panel-harness.tsx'

describe('the library panel access gate', () => {
  it('offers the write form to a peer with the write grant', async () => {
    const { view } = mountPanel({
      status: vi.fn(async () => ({
        ok: true,
        value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
      })),
    })
    expect(await screen.findByText(zh.libraryWriteActions)).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText(zh.libraryWriteNeedsAccess)).toBeNull()
    })
    view.unmount()
  })

  it('states the refusal and disables the form without the write grant', async () => {
    const { view } = mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
        })),
      },
      { ids: ['s1'], byId: { s1: { cwd: '/tmp/ws', running: true } } },
      { useAccess: (() => false) as never },
    )
    expect(await screen.findByText(zh.libraryWriteNeedsAccess)).toBeTruthy()
    const fieldset = document.querySelector('fieldset')
    expect(fieldset?.disabled).toBe(true)
    view.unmount()
  })

  it('keeps the list readable when the export grant is missing', async () => {
    const { view } = mountPanel(
      {},
      { ids: ['s1'], byId: { s1: { cwd: '/tmp/ws', running: true } } },
      { useRemoteAccess: ((action: string) => action !== 'zotero/export') as never },
    )
    expect(await screen.findByText('FlashAttention-2')).toBeTruthy()
    view.unmount()
  })
})
