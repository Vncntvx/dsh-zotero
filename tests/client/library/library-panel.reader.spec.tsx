// @vitest-environment jsdom
/**
 * The library panel's attachment reading: a session-anchored file address in
 * the right sidebar, and inline resolve/refusal errors.
 * @module tests/client/library/library-panel.reader
 */

import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ITEM_DETAIL, mountPanel, type SessionStub } from '../helpers/library-panel-harness.tsx'
import { deferred } from '../../helpers/sync.js'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // Fake timers defeat the automatic cleanup scheduling; drop the tree now.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reading an attachment', () => {
  it('opens a session-anchored file address in the right sidebar', async () => {
    const { face } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const read = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      read.click()
    })
    await waitFor(() => {
      expect(face.resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ATTAC001')
    })
    await waitFor(() => {
      expect(face.openResource).toHaveBeenCalledTimes(1)
    })
    const [address] = face.openResource.mock.calls[0] as unknown as [string]
    expect(address).toContain('s1')
    expect(address).toContain(encodeURIComponent('/storage/paper.pdf').replace(/%2F/g, '/'))
  })

  it('resolves through the wire and shows the resolve error inline', async () => {
    const { face } = mountPanel({
      resolveAttachment: vi.fn(async () => ({ ok: false, error: { message: 'resolve failed' } })),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const read = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      read.click()
    })
    expect(await screen.findByText('resolve failed')).toBeTruthy()
    expect(face.openResource).not.toHaveBeenCalled()
  })

  it('translates the no-on-screen-session refusal into the panel hint', async () => {
    const { face } = mountPanel({
      openResource: vi.fn(() => {
        throw new Error('sidebarRight: no session surface is mounted')
      }),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const read = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      read.click()
    })
    expect(await screen.findByText(zh.libraryNoSessionForOpen)).toBeTruthy()
    // A foreign refusal keeps its own message.
    expect(face.openResource).toHaveBeenCalledTimes(1)
  })

  it('keeps a foreign openResource refusal as its own message', async () => {
    const { face } = mountPanel({
      openResource: vi.fn(() => {
        throw new Error('sidebarRight: no registered tab type claims "x"')
      }),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const read = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      read.click()
    })
    expect(await screen.findByText(/no registered tab type claims/)).toBeTruthy()
    expect(face.openResource).toHaveBeenCalledTimes(1)
  })

  it('anchors file reads to the pane session, not the first host session', async () => {
    const sessions: SessionStub = {
      ids: ['s2', 's1'],
      byId: {
        s1: { cwd: '/tmp/ws', running: true },
        s2: { cwd: '/tmp/other', running: true },
      },
      paneId: 's1',
    }
    const { face } = mountPanel({}, sessions)
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const readOnce = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      readOnce.click()
    })
    // The pane belongs to s1 even though s2 sits first in the host list.
    expect(face.openResource.mock.calls[0]?.[0]).toContain('/session/s1/')
    expect(face.openResource.mock.calls[0]?.[0]).toContain('/storage/paper.pdf')

    // Same session id, moved workspace: the address still spells the pane's
    // session id; the cwd only feeds the address builder.
    sessions.byId.s1 = { cwd: '/tmp/next', running: true }
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    await act(async () => {
      await screen.findByRole('button', { name: zh.readPdf }).then((button) => button.click())
    })
    expect(face.openResource.mock.calls[1]?.[0]).toContain('/session/s1/')
  })

  it('anchors file reads to a different pane when the tab belongs to that session', async () => {
    const sessions: SessionStub = {
      ids: ['s1', 's2'],
      byId: {
        s1: { cwd: '/tmp/ws', running: true },
        s2: { cwd: '/tmp/other', running: true },
      },
      paneId: 's2',
    }
    const { face } = mountPanel({}, sessions)
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const readOnce = await screen.findByRole('button', { name: zh.readPdf })
    await act(async () => {
      readOnce.click()
    })
    expect(face.openResource.mock.calls[0]?.[0]).toContain('/session/s2/')
  })

  it('paints the cached detail on remount while the refetch is still pending', async () => {
    const sessions: SessionStub = {
      ids: ['s1'],
      byId: { s1: { cwd: '/tmp/ws', running: true } },
      paneId: 's1',
    }
    const first = mountPanel({}, sessions)
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    await screen.findByRole('button', { name: zh.readPdf })
    // Switching to the PDF reader unmounts the library tab in the right sidebar.
    first.view.unmount()

    // Returning to the tab must show the detail from the session view cache:
    // the refetch is held open, so only the cached payload can paint the row.
    const refetch = deferred<{ ok: true; value: typeof ITEM_DETAIL }>()
    const { face } = mountPanel({ item: vi.fn(() => refetch.promise) }, sessions)

    expect(await screen.findByRole('button', { name: zh.readPdf })).toBeTruthy()
    expect(face.item).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(zh.libraryNoSelection)).toBeNull()
    expect(screen.getByRole('button', { name: zh.libraryAskInChat })).toBeTruthy()

    await act(async () => {
      refetch.resolve({ ok: true, value: ITEM_DETAIL })
    })
    expect(screen.getByRole('button', { name: zh.readPdf })).toBeTruthy()
  })
})
