// @vitest-environment jsdom
/**
 * Tests for shared useZoteroProbe hook.
 * @module tests/client/use-zotero-probe
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useZoteroProbe } from '../../src/client/components/useZoteroProbe.ts'

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
    let resolveProbe: ((val: unknown) => void) | undefined
    const probePromise = new Promise((resolve) => {
      resolveProbe = resolve
    })

    const probe = vi.fn(async () => probePromise as Promise<never>)
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
      resolveProbe?.({
        ok: true,
        value: { providerId: 'local', connected: true, diagnosis: '' },
      })
      await p1
      await p2
    })

    expect(result.current.state.loading).toBe(false)
    expect(result.current.state.data?.connected).toBe(true)
  })

  it('discards unmounted updates gracefully', async () => {
    let resolveProbe: ((val: unknown) => void) | undefined
    const probePromise = new Promise((resolve) => {
      resolveProbe = resolve
    })

    const probe = vi.fn(async () => probePromise as Promise<never>)
    const { result, unmount } = renderHook(() => useZoteroProbe(probe))

    act(() => {
      void result.current.runProbe()
    })
    expect(result.current.state.loading).toBe(true)

    unmount()

    await act(async () => {
      resolveProbe?.({
        ok: true,
        value: { providerId: 'local', connected: true, diagnosis: '' },
      })
    })

    // Unmount succeeded without throwing unhandled React state update errors
  })
})
