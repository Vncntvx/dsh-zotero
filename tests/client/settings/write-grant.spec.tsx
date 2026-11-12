// @vitest-environment jsdom
/**
 * The write-grant revoke row: it appears only while a grant is stored, asks
 * for an explicit acknowledgement, calls the host, and disappears once the
 * refreshed probe reports no stored key.
 * @module tests/client/settings/write-grant
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { WriteGrantAction } from '../../../src/client/components/WriteGrantAction.tsx'
import { zh } from '../../../src/client/locales.ts'
import { CONNECTED } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

afterEach(cleanup)

describe('the write-grant revoke row', () => {
  it('confirms, revokes, and disappears once no grant remains', async () => {
    let authorized = true
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...CONNECTED,
        write: { enabled: true, authorized },
      },
    }))
    const revoke = vi.fn(async () => {
      authorized = false
      return { ok: true as const, value: { removed: true } }
    })
    const view = render(<WriteGrantAction t={mockT} probe={probe} revoke={revoke} />)

    fireEvent.click(await screen.findByRole('button', { name: zh.writeGrantRevoke }))
    fireEvent.click(await screen.findByLabelText(zh.writeGrantRevokeAcknowledge))
    fireEvent.click(screen.getByRole('button', { name: zh.writeGrantRevokeConfirm }))

    await waitFor(() => {
      expect(revoke).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: zh.writeGrantRevoke })).toBeNull()
    })
    expect(probe.mock.calls.length).toBeGreaterThan(1)
    view.unmount()
  })

  it('renders nothing when no grant is stored', async () => {
    render(
      <WriteGrantAction
        t={mockT}
        probe={async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, authorized: false } },
        })}
        revoke={async () => ({ ok: true, value: { removed: false } })}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: zh.writeGrantRevoke })).toBeNull()
    })
  })

  it('still offers revoke while writes are disabled', async () => {
    // A grant outlives the write surface: disabling writes leaves the stored
    // key in place, so the row must key on the grant, not on the capability.
    render(
      <WriteGrantAction
        t={mockT}
        probe={async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: false, authorized: true } },
        })}
        revoke={async () => ({ ok: true, value: { removed: true } })}
      />,
    )
    expect(await screen.findByRole('button', { name: zh.writeGrantRevoke })).toBeDefined()
  })

  it('shows the host error and keeps the action when revoke fails', async () => {
    const revoke = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('zotero/domain', 'denied', { code: 'ZOTERO_CAPABILITY_UNAVAILABLE' }),
    }))
    render(
      <WriteGrantAction
        t={mockT}
        probe={async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, authorized: true } },
        })}
        revoke={revoke}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: zh.writeGrantRevoke }))
    fireEvent.click(await screen.findByLabelText(zh.writeGrantRevokeAcknowledge))
    fireEvent.click(screen.getByRole('button', { name: zh.writeGrantRevokeConfirm }))
    await waitFor(() => {
      expect(screen.getByText('denied')).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: zh.writeGrantRevoke })).not.toBeNull()
  })

  it('closes the confirmation on cancel without calling the host', async () => {
    const revoke = vi.fn(async () => ({ ok: true as const, value: { removed: true } }))
    render(
      <WriteGrantAction
        t={mockT}
        probe={async () => ({
          ok: true,
          value: { ...CONNECTED, write: { enabled: true, authorized: true } },
        })}
        revoke={revoke}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: zh.writeGrantRevoke }))
    fireEvent.click(await screen.findByRole('button', { name: zh.writeRiskCancel }))
    await waitFor(() => {
      expect(screen.queryByLabelText(zh.writeGrantRevokeAcknowledge)).toBeNull()
    })
    expect(revoke).not.toHaveBeenCalled()
  })
})
