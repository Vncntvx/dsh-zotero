// @vitest-environment jsdom
/**
 * Tests for useDiagnosticsFeed: the on-mount fetch, the visible-only poll,
 * the in-flight guard, and the error arm. Time is advanced with fake timers
 * and settlements ride owned deferreds, never sleeps.
 * @module tests/client/useDiagnosticsFeed
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  useDiagnosticsFeed,
  type DiagnosticsFeedState,
} from '../../src/client/components/useDiagnosticsFeed.ts'
import type { ZoteroDiagnosticsView } from '../../src/client/remote.ts'
import { deferred, type Deferred } from '../helpers/sync.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

interface FeedBox {
  current: DiagnosticsFeedState | undefined
}

function Probe({
  diagnostics,
  pollMs,
  box,
}: {
  readonly diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>
  readonly pollMs?: number
  readonly box: FeedBox
}): null {
  const { state } = useDiagnosticsFeed(diagnostics, { pollMs })
  box.current = state
  return null
}

function okView(total: number): RemoteResult<ZoteroDiagnosticsView> {
  return { ok: true as const, value: { entries: [], total, truncated: false, debug: false } }
}

describe('useDiagnosticsFeed', () => {
  it('fetches once on mount and settles into the view', async () => {
    const pending: Deferred<void> = deferred()
    let calls = 0
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      calls += 1
      await pending.promise
      return okView(calls)
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} box={box} />)
    expect(box.current?.loading).toBe(true)
    await act(async () => {
      pending.resolve()
    })
    expect(box.current?.loading).toBe(false)
    expect(box.current?.data?.total).toBe(1)
    expect(calls).toBe(1)
  })

  it('polls while the document is visible and pauses while hidden', async () => {
    vi.useFakeTimers()
    let calls = 0
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      calls += 1
      return okView(calls)
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} pollMs={2000} box={box} />)
    await act(async () => {})
    expect(calls).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls).toBe(2)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(calls).toBe(2)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {})
    // The visibility return refreshes immediately instead of waiting out the
    // interval, and the guard keeps it to one call.
    expect(calls).toBe(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls).toBe(4)
  })

  it('never stacks calls while one is in flight', async () => {
    vi.useFakeTimers()
    const pending: Deferred<void> = deferred()
    let calls = 0
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      calls += 1
      await pending.promise
      return okView(calls)
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} pollMs={100} box={box} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls).toBe(1)
    await act(async () => {
      pending.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(calls).toBe(2)
  })

  it('stays idle when no diagnostics face is provided', async () => {
    const box: FeedBox = { current: undefined }
    render(
      <Probe
        diagnostics={undefined as unknown as () => Promise<RemoteResult<ZoteroDiagnosticsView>>}
        box={box}
      />,
    )
    await act(async () => {})
    expect(box.current?.loading).toBe(false)
    expect(box.current?.data).toBeUndefined()
    expect(box.current?.error).toBeUndefined()
  })

  it('reports a throwing endpoint into the error arm', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      throw new Error('transport exploded')
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} box={box} />)
    await act(async () => {})
    expect(box.current?.error).toBe('transport exploded')
  })

  it('ignores a settlement that arrives after unmount', async () => {
    const pending: Deferred<void> = deferred()
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      await pending.promise
      return okView(7)
    })
    const box: FeedBox = { current: undefined }
    const view = render(<Probe diagnostics={diagnostics} box={box} />)
    view.unmount()
    await act(async () => {
      pending.resolve()
    })
    // The late settlement must not touch state (the guard returns before it).
    expect(box.current?.loading).toBe(true)
    expect(box.current?.data).toBeUndefined()
  })

  it('ignores a rejection that arrives after unmount', async () => {
    const pending: Deferred<void> = deferred()
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      await pending.promise
      throw new Error('late boom')
    })
    const box: FeedBox = { current: undefined }
    const view = render(<Probe diagnostics={diagnostics} box={box} />)
    view.unmount()
    await act(async () => {
      pending.reject(new Error('late boom'))
    })
    expect(box.current?.loading).toBe(true)
    expect(box.current?.error).toBeUndefined()
  })

  it('stringifies a non-Error throw into the error arm', async () => {
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch under test
      throw 'bare feed failure'
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} box={box} />)
    await act(async () => {})
    expect(box.current?.error).toBe('bare feed failure')
  })

  it('does not refresh when the visibility event fires while hidden', async () => {
    vi.useFakeTimers()
    let calls = 0
    const diagnostics = vi.fn(async (): Promise<RemoteResult<ZoteroDiagnosticsView>> => {
      calls += 1
      return okView(calls)
    })
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} pollMs={60000} box={box} />)
    await act(async () => {})
    expect(calls).toBe(1)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {})
    expect(calls).toBe(1)
  })

  it('reports a rejected endpoint into the error arm', async () => {
    const diagnostics = vi.fn(
      async (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
        ({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'down', {}),
        }) as RemoteResult<ZoteroDiagnosticsView>,
    )
    const box: FeedBox = { current: undefined }
    render(<Probe diagnostics={diagnostics} box={box} />)
    await act(async () => {})
    expect(box.current?.error).toBe('down')
    expect(box.current?.data).toBeUndefined()
  })
})
