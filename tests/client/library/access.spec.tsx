// @vitest-environment jsdom
/**
 * The library panel is a global-resource reader and a session-resource writer:
 * a peer without the global browse action gets one notice and no wire reads,
 * and the write drawer follows the session action.
 * @module tests/client/library/access
 */

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { CONNECTED, mountPanel } from '../helpers/library-panel-harness.tsx'

afterEach(cleanup)

describe('the library panel access gate', () => {
  it('pauses browsing and reports the refusal without issuing a read', async () => {
    const browse = vi.fn(async () => ({ ok: true, value: undefined }))
    mountPanel({ browse }, undefined, { useRemoteAccess: () => false })
    expect(await screen.findByText(zh.remoteAccessDenied)).toBeDefined()
    expect(browse).not.toHaveBeenCalled()
  })

  it('states the refusal inside the drawer when the session action is refused', async () => {
    mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
        })),
      },
      undefined,
      { useAccess: () => false },
    )
    expect(await screen.findByText(zh.libraryConnected)).toBeDefined()
    // The drawer is a controlled DisclosureRow: open it before reading its
    // body, as a reader would.
    fireEvent.click(screen.getByRole('button', { name: zh.libraryWriteActions }))
    // The drawer stays mounted with the summary visible, but main's write
    // plumbing states the refusal and disables the form instead of hiding it.
    expect(await screen.findByText(zh.libraryWriteNeedsAccess)).toBeDefined()
  })

  it('shows the write drawer when the session action is allowed', async () => {
    mountPanel(
      {
        status: vi.fn(async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
        })),
      },
      undefined,
      { useAccess: () => true },
    )
    expect(await screen.findByText(zh.libraryWriteActions)).toBeTruthy()
  })
})
