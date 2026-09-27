import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../../contract.ts'

export interface ZoteroProbeState {
  readonly loading: boolean
  readonly data?: ZoteroStatusView
  readonly error?: string
}

export interface UseZoteroProbeOptions {
  readonly initialAutoRun?: boolean
}

export interface UseZoteroProbeReturn {
  readonly state: ZoteroProbeState
  readonly runProbe: () => Promise<void>
}

/**
 * Shared hook to manage live Zotero connectivity probe state.
 *
 * Provides:
 * - An in-flight guard, so rapid clicks never stack probes. It is the only
 *   concurrency mechanism here: a second call returns before it can start, so
 *   there is never a second response to race the first.
 * - Unmount safety, so an asynchronous probe resolution never calls setState on
 *   an unmounted component. This one cannot be pinned by a test: React 18
 *   removed the setState-on-unmounted warning, so a late resolution is
 *   unobservable from outside the component. The guard is kept because it is
 *   right, not because a spec proves it.
 * - Full ZoteroStatusView data preservation so all telemetry fields can update live.
 */
export function useZoteroProbe(
  probe?: () => Promise<RemoteResult<ZoteroStatusView>>,
  options?: UseZoteroProbeOptions,
): UseZoteroProbeReturn {
  const [state, setState] = useState<ZoteroProbeState>({
    loading: options?.initialAutoRun ?? false,
  })

  const inFlightRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const runProbe = useCallback(async (): Promise<void> => {
    if (!probe || inFlightRef.current) return
    inFlightRef.current = true
    setState((prev) => ({ ...prev, loading: true }))

    try {
      const res = await probe()
      if (unmountedRef.current) return
      if (res.ok) {
        setState({
          loading: false,
          data: res.value,
          error: res.value.connected ? undefined : res.value.diagnosis,
        })
      } else {
        setState({
          loading: false,
          error: res.error.message,
        })
      }
    } catch (err) {
      if (unmountedRef.current) return
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      inFlightRef.current = false
    }
  }, [probe])

  useEffect(() => {
    if (options?.initialAutoRun && probe) {
      void runProbe()
    }
  }, [options?.initialAutoRun, probe, runProbe])

  return { state, runProbe }
}
