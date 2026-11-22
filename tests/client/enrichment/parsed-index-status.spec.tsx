// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { en } from '../../../src/client/locales.ts'
import { ParsedIndexStatus } from '../../../src/client/enrichment/parsed-manager/ParsedIndexStatus.tsx'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { maintenance } from './support/document-maintenance.ts'
import { SESSION, world } from './support/parsed-manager-world.tsx'

afterEach(cleanup)

it('shows searchable coverage and emits a completion toast once across refresh and reopen', async () => {
  const remote = maintenance()
  const first = world({ maintenance: remote })
  await screen.findByText('Full-text search · 2 of 4 documents searchable')
  expect(screen.queryByText('Unreadable documents (1)')).not.toBeNull()
  expect(remote.rebuildParsedIndex).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.indexRebuild }))
  await screen.findByText('Full-text search · 4 of 4 documents searchable')
  expect(remote.rebuildParsedIndex).toHaveBeenCalledWith({ sessionId: SESSION })
  await vi.waitFor(() => expect(first.notify).toHaveBeenCalledWith(en.indexRebuilt, 'success'))
  fireEvent.click(screen.getByRole('button', { name: en.parsedManagerRefresh }))
  await vi.waitFor(() => expect(remote.parsedIndexStatus).toHaveBeenCalledTimes(3))
  expect(screen.queryByText(en.indexRebuilt)).toBeNull()
  expect(first.notify).toHaveBeenCalledTimes(1)
  first.unmount()
  const reopened = world({ maintenance: remote })
  await screen.findByText('Full-text search · 4 of 4 documents searchable')
  expect(screen.queryByText(en.indexRebuilt)).toBeNull()
  expect(reopened.notify).not.toHaveBeenCalled()
})

it('explains how to enable full-text search in an empty library without showing a rebuild', async () => {
  const remote = maintenance()
  remote.parsedIndexStatus.mockResolvedValue({
    ok: true,
    value: { indexed: 0, total: 0, unreadable: 0, obsolete: 0 },
  })
  world({ maintenance: remote })
  await screen.findByText(en.indexEmpty)
  expect(screen.queryByRole('button', { name: en.indexRebuild })).toBeNull()
})

it('shows real rebuild progress and cancels the owning job', async () => {
  const remote = maintenance()
  let cancelled = false
  remote.parsedIndexStatus.mockImplementation(async () => ({
    ok: true,
    value: {
      indexed: 2,
      total: 4,
      unreadable: 0,
      obsolete: 1,
      rebuild: { jobId: 'zotero-index-1', state: cancelled ? 'cancelled' : 'running' },
      ...(cancelled ? {} : { progress: { done: 3, total: 4 } }),
    },
  }))
  const kill = vi.fn(async () => {
    cancelled = true
    return { ok: true, value: 'requested' } as const
  })
  const notify = vi.fn()
  render(
    <ParsedIndexStatus
      remote={remote}
      jobs={{ kill } as never}
      sessionId={SESSION}
      revision={0}
      rebuildAllowed
      cancelAllowed
      connected
      notify={notify}
      t={makeTranslate(en)}
    />,
  )
  await screen.findByText('Rebuilding full-text search · 3/4')
  expect(screen.queryByText('Stale search entries (1)')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.indexCancel }))
  await vi.waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith(en.indexCancelled))
  expect(screen.queryByText(en.indexCancelled)).toBeNull()
  expect(kill).toHaveBeenCalledWith(SESSION, 'zotero-index-1')
})

it('keeps previous coverage visible when a rebuild reports a failure', async () => {
  const remote = maintenance()
  const failure = new RemoteError('gateway/internal', 'Index unavailable', {})
  remote.parsedIndexStatus.mockResolvedValueOnce({ ok: false, error: failure })
  remote.rebuildParsedIndex.mockResolvedValueOnce({ ok: false, error: failure })
  remote.parsedIndexStatus.mockResolvedValueOnce({
    ok: true,
    value: {
      indexed: 2,
      total: 2,
      unreadable: 0,
      obsolete: 0,
      rebuild: { state: 'failed', jobId: 'index-failed', error: 'Invalid artifact digest' },
    },
  })
  world({ maintenance: remote })
  await screen.findByText('Index unavailable')
  fireEvent.click(screen.getByRole('button', { name: en.indexRebuild }))
  await vi.waitFor(() => expect(remote.rebuildParsedIndex).toHaveBeenCalledTimes(1))
  await screen.findByText('Index unavailable')
  fireEvent.click(screen.getByRole('button', { name: en.indexRebuild }))
  await screen.findByText('Invalid artifact digest')
  expect(screen.queryByText('Full-text search · 2 of 2 documents searchable')).not.toBeNull()
})

it('aborts an obsolete status read when offline and follows the rebuild through stopping', async () => {
  const remote = maintenance()
  const outdated = deferred<Awaited<ReturnType<typeof remote.parsedIndexStatus>>>()
  remote.parsedIndexStatus
    .mockReturnValueOnce(outdated.promise)
    .mockResolvedValueOnce({
      ok: true,
      value: {
        indexed: 2,
        total: 2,
        unreadable: 0,
        obsolete: 1,
        rebuild: { jobId: 'index-1', state: 'running' },
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: {
        indexed: 2,
        total: 2,
        unreadable: 0,
        obsolete: 1,
        rebuild: { jobId: 'index-1', state: 'stopping' },
      },
    })
    .mockResolvedValue({
      ok: true,
      value: {
        indexed: 2,
        total: 2,
        unreadable: 0,
        obsolete: 0,
        rebuild: { jobId: 'index-1', state: 'completed' },
      },
    })
  const props = {
    remote,
    jobs: {} as never,
    sessionId: SESSION,
    rebuildAllowed: false,
    cancelAllowed: false,
    notify: vi.fn(),
    t: makeTranslate(en),
  }
  const { rerender } = render(<ParsedIndexStatus {...props} connected revision={0} />)
  rerender(<ParsedIndexStatus {...props} connected={false} revision={0} />)
  expect(remote.parsedIndexStatus.mock.calls[0]?.[1]?.aborted).toBe(true)
  expect(screen.getByText(en.indexOffline)).toBeTruthy()
  await act(async () => {
    outdated.resolve({ ok: true, value: { indexed: 0, total: 3, unreadable: 0, obsolete: 0 } })
    await outdated.promise
  })
  rerender(<ParsedIndexStatus {...props} connected revision={1} />)
  await screen.findByText(en.indexWaiting)
  expect(screen.queryByRole('button')).toBeNull()
  rerender(<ParsedIndexStatus {...props} connected rebuildAllowed revision={2} />)
  await screen.findByText(en.indexStopping)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.indexRebuild }).disabled).toBe(
    true,
  )
  rerender(<ParsedIndexStatus {...props} connected rebuildAllowed revision={3} />)
  await screen.findByText('Full-text search · 2 of 2 documents searchable')
  expect(props.notify).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.indexRebuild }).disabled).toBe(
    false,
  )
})

it('keeps a running job visible while cancellation is pending and reports a refused stop', async () => {
  const remote = maintenance()
  remote.parsedIndexStatus.mockResolvedValue({
    ok: true,
    value: {
      indexed: 1,
      total: 1,
      unreadable: 0,
      obsolete: 0,
      rebuild: { jobId: 'index-1', state: 'running' },
    },
  })
  const stop = deferred<{ ok: false; error: Error }>()
  const kill = vi.fn(() => stop.promise)
  render(
    <ParsedIndexStatus
      remote={remote}
      jobs={{ kill } as never}
      sessionId={SESSION}
      revision={0}
      rebuildAllowed
      cancelAllowed
      connected
      notify={vi.fn()}
      t={makeTranslate(en)}
    />,
  )
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: en.indexCancel })
  fireEvent.click(button)
  expect(button.disabled).toBe(true)
  stop.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Cannot stop job', {}) })
  await screen.findByText('Cannot stop job')
  expect(button.disabled).toBe(false)
})
