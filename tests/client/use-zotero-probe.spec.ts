// @vitest-environment jsdom
/**
 * Tests for shared useZoteroProbe hook.
 * @module tests/client/use-zotero-probe
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { useZoteroProbe } from '../../src/client/components/useZoteroProbe.ts'
import type { ZoteroStatusView } from '../../src/contract.ts'
import { deferred } from '../helpers/sync.ts'

describe('useZoteroProbe', () => {
  it('initializes with loading false by default', () => {
    const { result } = renderHook(() => useZoteroProbe())
    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data).toBeUndefined()
    expect(result.current.state.error).toBeUndefined()
  })

  it('runs automatically on mount when initialAutoRun is true', async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        connected: true,
        zoteroVersion: '7.0.11',
        diagnosis: '',
      },
    }))

    const { result } = renderHook(() => useZoteroProbe(probe, { initialAutoRun: true }))

    await act(async () => {})
    expect(probe).toHaveBeenCalledTimes(1)
    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data?.connected).toBe(true)
    expect(result.current.state.data?.zoteroVersion).toBe('7.0.11')
  })

  it('executes runProbe successfully and sets connected data', async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        connected: true,
        zoteroVersion: '7.0.15',
        diagnosis: '',
      },
    }))

    const { result } = renderHook(() => useZoteroProbe(probe))
    expect(result.current.state.loading).toBe(false)

    await act(async () => {
      await result.current.runProbe()
    })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data?.zoteroVersion).toBe('7.0.15')
    expect(result.current.state.error).toBeUndefined()
  })

  it('sets diagnosis in error when probe answers ok: true but connected: false', async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        providerId: 'local',
        connected: false,
        diagnosis: 'ZOTERO_NOT_RUNNING: offline',
      },
    }))

    const { result } = renderHook(() => useZoteroProbe(probe))

    await act(async () => {
      await result.current.runProbe()
    })

    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data?.connected).toBe(false)
    expect(result.current.state.error).toBe('ZOTERO_NOT_RUNNING: offline')
  })

  it('handles remote error with ok: false', async () => {
    const probe = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Transport error' } as never,
    }))

    const { result } = renderHook(() => useZoteroProbe(probe))

    await act(async () => {
      await result.current.runProbe()
    })

    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.error).toBe('Transport error')
  })

  it('handles probe throwing Error', async () => {
    const probe = vi.fn(async () => {
      throw new Error('Network failure')
    })

    const { result } = renderHook(() => useZoteroProbe(probe))

    await act(async () => {
      await result.current.runProbe()
    })

    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.error).toBe('Network failure')
  })

  it('guards against concurrent in-flight requests', async () => {
    // The in-flight guard is the hook's only concurrency mechanism: a second
    // call returns before it starts, so there is never a second response that
    // could overwrite the first. This is what the removed sequence token used
    // to look like it was protecting.
    const gate = deferred<RemoteResult<ZoteroStatusView>>()

    const probe = vi.fn(async () => gate.promise)
    const { result } = renderHook(() => useZoteroProbe(probe))

    let p1: Promise<void> | undefined
    let p2: Promise<void> | undefined

    act(() => {
      p1 = result.current.runProbe()
      p2 = result.current.runProbe()
    })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(result.current.state.loading).toBe(true)

    await act(async () => {
      gate.resolve({
        ok: true,
        value: { providerId: 'local', connected: true, diagnosis: '' },
      } as RemoteResult<ZoteroStatusView>)
      await p1
      await p2
    })

    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data?.connected).toBe(true)
  })

  it('accepts a fresh probe after the previous one settled', async () => {
    // The guard releases on settle, so a card's Refresh button keeps working
    // across repeated uses rather than latching after the first click.
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: { providerId: 'local', endpoint: '127.0.0.1:23119', connected: true, diagnosis: '' },
    }))
    const { result } = renderHook(() => useZoteroProbe(probe))

    await act(async () => {
      await result.current.runProbe()
    })
    await act(async () => {
      await result.current.runProbe()
    })

    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('survives unmounting mid-flight without throwing', async () => {
    // This is the whole claim, and it is deliberately modest: a probe that
    // outlives its component must not throw while settling. Whether it also
    // avoids a state update afterwards cannot be asserted from here: React 18
    // removed the setState-on-an-unmounted-component warning, so a late
    // resolution is unobservable from outside the component. The guard is kept
    // because it is right, not because this test proves it, which is why
    // `useZoteroProbe`'s docstring records it instead of leaving a test to
    // imply it.
    const gate = deferred<RemoteResult<ZoteroStatusView>>()
    const probe = vi.fn(async () => gate.promise)
    const { result, unmount } = renderHook(() => useZoteroProbe(probe))

    act(() => {
      void result.current.runProbe()
    })
    expect(result.current.state.loading).toBe(true)
    unmount()

    await act(async () => {
      gate.resolve({
        ok: true,
        value: { providerId: 'local', connected: true, diagnosis: '' },
      } as RemoteResult<ZoteroStatusView>)
    })

    expect(probe).toHaveBeenCalledTimes(1)
  })
})
