// @vitest-environment jsdom
/**
 * The shared clipboard feedback lane: the phases it reports, the refusal and
 * failure arms, and the stale-answer guard that keeps a superseded attempt
 * from painting a label.
 *
 * The host primitive reports a refusal by returning false, but a clipboard
 * writer may also reject outright; the lane answers both, and the rejection
 * is the arm a refusing host never reaches.
 * @module tests/client/components/use-copy-feedback
 */

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCopyFeedback } from '../../../src/client/components/useCopyFeedback.ts'
import { CopyButton } from '../../../src/client/components/CopyButton.tsx'
import { deferred } from '../../helpers/sync.ts'

// The real primitives bundle, with the one seam this lane exists to answer: a
// clipboard writer that refuses, or that rejects outright. The host helper maps
// a rejection to `false`, so a throwing writer is only reachable by replacing
// the export itself.
const { writeClipboard } = vi.hoisted(() => ({
  writeClipboard: vi.fn<(text: string) => Promise<boolean>>(async () => true),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the clipboard feedback lane', () => {
  it('reports the done phase for an accepted write', async () => {
    writeClipboard.mockResolvedValueOnce(true)
    const { result } = renderHook(() => useCopyFeedback('ref-1'))
    await act(async () => {
      result.current.copyText('copied text')
    })
    expect(result.current.phase).toBe('done')
    expect(writeClipboard).toHaveBeenCalledWith('copied text')
  })

  it('reports the rejected phase when the host refuses the write', async () => {
    writeClipboard.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useCopyFeedback('ref-1'))
    await act(async () => {
      result.current.copyText('copied text')
    })
    expect(result.current.phase).toBe('rejected')
    expect(result.current.error).toBeUndefined()
  })

  it('keeps a rejected write as the error arm, with the thrown value', async () => {
    const failure = new Error('clipboard exploded')
    writeClipboard.mockRejectedValueOnce(failure)
    const { result } = renderHook(() => useCopyFeedback('ref-1'))
    await act(async () => {
      result.current.copyText('copied text')
    })
    expect(result.current.phase).toBe('error')
    expect(result.current.error).toBe(failure)
  })

  it('drops a rejection that belongs to a superseded attempt', async () => {
    const pending = deferred<boolean>()
    writeClipboard.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useCopyFeedback('ref-1'))
    act(() => {
      result.current.copyText('copied text')
    })
    // The subject moved on: the lane is idle again, and the late answer of
    // the superseded attempt must not paint a label on the new subject.
    act(() => {
      result.current.reset()
    })
    await act(async () => {
      pending.reject(new Error('too late'))
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.error).toBeUndefined()
  })

  it('drops a load that fails after the subject changed', async () => {
    const pending = deferred<string>()
    const { result, rerender } = renderHook(({ key }) => useCopyFeedback(key), {
      initialProps: { key: 'ref-1' },
    })
    act(() => {
      result.current.copy(() => pending.promise)
    })
    rerender({ key: 'ref-2' })
    await act(async () => {
      pending.reject(new Error('too late'))
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.error).toBeUndefined()
  })

  it('lets an in-flight write settle when only the content moved on', async () => {
    const pending = deferred<boolean>()
    writeClipboard.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(
      ({ key, text }: { key: string; text: string }) => useCopyFeedback(key, text),
      { initialProps: { key: 'ref-1', text: 'first' } },
    )
    act(() => {
      result.current.copyText('first')
    })
    // The copied subject is the same ref; its text kept growing while the
    // write was in flight. The answer still belongs to this control.
    rerender({ key: 'ref-1', text: 'second' })
    await act(async () => {
      pending.resolve(true)
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('done')
  })

  it('clears a settled done label when the content moves on', async () => {
    writeClipboard.mockResolvedValueOnce(true)
    const { result, rerender } = renderHook(
      ({ key, text }: { key: string; text: string }) => useCopyFeedback(key, text),
      { initialProps: { key: 'ref-1', text: 'first' } },
    )
    await act(async () => {
      result.current.copyText('first')
    })
    expect(result.current.phase).toBe('done')
    rerender({ key: 'ref-1', text: 'second' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('idle')
  })

  it('keeps the copied label on a copy button whose text changes mid-flight', async () => {
    const pending = deferred<boolean>()
    writeClipboard.mockReturnValueOnce(pending.promise)
    const { rerender } = render(<CopyButton value="first" label="Copy ref" copiedLabel="Copied" />)
    fireEvent.click(screen.getByText('Copy ref'))
    rerender(<CopyButton value="second" label="Copy ref" copiedLabel="Copied" />)
    await act(async () => {
      pending.resolve(true)
      await Promise.resolve()
    })
    expect(screen.getByText('Copied')).toBeTruthy()
  })
})
