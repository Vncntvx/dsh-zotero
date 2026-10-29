// @vitest-environment jsdom
/** Child-page writeback, retry offsets, per-kind request races, and the selection/failure guards. */

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroChildPageView } from '../../../src/contract.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function selectItem(result: ReturnType<typeof setup>['result']) {
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  act(() => result.current.selectItem(ITEM_DETAIL.ref))
  await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
}

describe('library child feed', () => {
  it('writes a successful child page into the selected inspector detail', async () => {
    const { result, face } = setup()
    await selectItem(result)
    const page = { total: 51, returned: 1, offset: 50, limit: 50, items: [] }
    const childPage: ZoteroChildPageView = { kind: 'notes', page }
    vi.mocked(face.childPage).mockResolvedValueOnce({ ok: true, value: childPage })

    act(() => result.current.pageChild('notes', 50))

    await waitFor(() =>
      expect(result.current.inspector).toEqual({
        phase: 'ready',
        detail: { ...ITEM_DETAIL, notes: page },
      }),
    )
    expect(result.current.childStates.notes).toBeUndefined()
  })

  it('retries from the first page when no child offset has been recorded', async () => {
    const { result, face } = setup()
    await selectItem(result)

    act(() => result.current.retryChild('notes'))

    await waitFor(() => expect(face.childPage).toHaveBeenCalled())
    expect(face.childPage).toHaveBeenCalledWith({
      ref: ITEM_DETAIL.ref,
      kind: 'notes',
      offset: 0,
      limit: 50,
    })
  })

  it('ignores an older page when a newer request for the same child kind wins', async () => {
    const older = deferred<Awaited<ReturnType<LibraryFeedFace['childPage']>>>()
    const newer = deferred<Awaited<ReturnType<LibraryFeedFace['childPage']>>>()
    const { result, face } = setup()
    await selectItem(result)
    vi.mocked(face.childPage)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    act(() => {
      result.current.pageChild('notes', 50)
      result.current.pageChild('notes', 100)
    })
    await act(async () => {
      older.resolve({
        ok: true,
        value: {
          kind: 'notes',
          page: { total: 151, returned: 1, offset: 50, limit: 50, items: [] },
        },
      })
      newer.resolve({
        ok: true,
        value: {
          kind: 'notes',
          page: { total: 151, returned: 1, offset: 100, limit: 50, items: [] },
        },
      })
    })

    expect(result.current.inspector).toMatchObject({ detail: { notes: { offset: 100 } } })
  })
})

describe('child feed selection, failures, and guards', () => {
  it('keeps child pages independent and ignores child replies from a previously selected item', async () => {
    const notes = deferred<any>()
    const attachments = deferred<any>()
    const item = vi.fn(async (request: any) =>
      request.include.length === 3
        ? { ok: true, value: ITEM_DETAIL }
        : request.include[0] === 'notes'
          ? notes.promise
          : attachments.promise,
    )
    const { result } = setup({ item })
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    act(() => {
      result.current.pageChild('notes', 50)
      result.current.pageChild('attachments', 50)
    })
    await act(async () =>
      attachments.resolve({
        ok: true,
        value: { ...ITEM_DETAIL, attachments: { ...ITEM_DETAIL.attachments, offset: 50 } },
      }),
    )
    await act(async () =>
      notes.resolve({
        ok: true,
        value: { ...ITEM_DETAIL, notes: { ...ITEM_DETAIL.notes, offset: 50 } },
      }),
    )
    expect(result.current.inspector).toMatchObject({
      detail: {
        notes: { offset: 50 },
        attachments: { offset: 50 },
        annotations: ITEM_DETAIL.annotations,
      },
    })
    const late = deferred<any>()
    item.mockImplementationOnce(() => late.promise)
    act(() => result.current.pageChild('notes', 100))
    act(() => result.current.selectItem(undefined))
    await act(async () => late.resolve({ ok: true, value: ITEM_DETAIL }))
    expect(result.current.inspector).toBeUndefined()
  })

  it('keeps inspector detail through failed child pages and retries the failed offset', async () => {
    const { result, face } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    vi.mocked(face.childPage).mockRejectedValueOnce(new Error('child disconnected'))
    act(() => result.current.pageChild('notes', 50))
    await waitFor(() =>
      expect(result.current.childStates.notes).toEqual({
        phase: 'error',
        message: 'child disconnected',
      }),
    )
    expect(result.current.inspector).toEqual({ phase: 'ready', detail: ITEM_DETAIL })
    act(() => result.current.retryChild('notes'))
    await waitFor(() => expect(result.current.childStates.notes).toBeUndefined())
    expect(face.childPage).toHaveBeenLastCalledWith({
      ref: ITEM_DETAIL.ref,
      kind: 'notes',
      offset: 50,
      limit: 50,
    })
    vi.mocked(face.childPage).mockResolvedValueOnce({
      ok: false as const,
      error: new RemoteError('zotero/domain', 'child denied', { code: 'ZOTERO_NOT_FOUND' }),
    })
    act(() => result.current.pageChild('attachments', 0))
    await waitFor(() =>
      expect(result.current.childStates.attachments).toEqual({
        phase: 'error',
        message: 'child denied',
      }),
    )
    expect(result.current.inspector?.phase).toBe('ready')
  })

  it('reports a child reply that answers a different kind as a child error', async () => {
    const { result, face } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    vi.mocked(face.childPage).mockResolvedValueOnce({
      ok: true,
      value: {
        kind: 'annotations',
        page: { total: 0, returned: 0, offset: 0, limit: 50, items: [] },
      },
    })
    act(() => result.current.pageChild('notes', 0))
    await waitFor(() =>
      expect(result.current.childStates.notes).toEqual({
        phase: 'error',
        message: 'The child page answered a different kind.',
      }),
    )
    // The inspector keeps its detail; the mismatch never patches the state.
    expect(result.current.inspector).toEqual({ phase: 'ready', detail: ITEM_DETAIL })
  })

  it('drops late child rejections after another item is selected', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['childPage']>>>()
    const { result, face } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    vi.mocked(face.childPage).mockImplementationOnce(() => pending.promise)
    act(() => result.current.pageChild('notes', 50))
    act(() => result.current.selectItem(undefined))
    await act(async () => pending.reject(new Error('old child failure')))
    expect(result.current.inspector).toBeUndefined()
    expect(result.current.childStates).toEqual({})
  })

  it('ignores child paging before a row is selected', () => {
    const { result, face } = setup()
    result.current.pageChild('notes', 0)
    expect(face.childPage).not.toHaveBeenCalled()
  })

  it('keeps the detail state when a child page answers before the detail is ready', async () => {
    const item = deferred<{ ok: true; value: typeof ITEM_DETAIL }>()
    const child = deferred<never>()
    const { result } = setup({
      item: vi.fn(() => item.promise),
      childPage: vi.fn(() => child.promise),
    })
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    expect(result.current.inspector?.phase).toBe('loading')

    act(() => result.current.pageChild('notes', 0))
    await act(async () => {
      child.resolve({
        ok: true,
        value: {
          kind: 'notes',
          page: { total: 0, returned: 0, offset: 0, limit: 50, items: [] },
        },
      } as never)
    })

    // The detail is still loading; the child answer must not fabricate one.
    expect(result.current.inspector?.phase).toBe('loading')
    expect(result.current.childStates.notes).toBeUndefined()
    await act(async () => {
      item.resolve({ ok: true, value: ITEM_DETAIL })
    })
  })
})
