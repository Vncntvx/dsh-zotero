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
  readonly initialLoading?: boolean
}

export interface UseZoteroProbeReturn {
  readonly state: ZoteroProbeState
  readonly runProbe: () => Promise<void>
}

/**
 * Shared hook to manage live Zotero connectivity probe state.
 *
 * Provides:
 * - In-flight guard to prevent multiple concurrent probes on rapid clicks.
 * - Monotonic sequence token so slow responses cannot overwrite newer ones.
 * - Unmount safety so asynchronous probe resolution never calls setState on an unmounted component.
 * - Full ZoteroStatusView data preservation so all telemetry fields can update live.
 */
export function useZoteroProbe(
  probe?: () => Promise<RemoteResult<ZoteroStatusView>>,
  options?: UseZoteroProbeOptions,
): UseZoteroProbeReturn {
  const [state, setState] = useState<ZoteroProbeState>({
    loading: options?.initialLoading ?? options?.initialAutoRun ?? false,
  })

  const inFlightRef = useRef(false)
  const unmountedRef = useRef(false)
  const probeSeq = useRef(0)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const runProbe = useCallback(async (): Promise<void> => {
    if (!probe || inFlightRef.current) return
    inFlightRef.current = true
    const seq = ++probeSeq.current
    setState((prev) => ({ ...prev, loading: true }))

    try {
      const res = await probe()
      if (unmountedRef.current || seq !== probeSeq.current) return
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
      if (unmountedRef.current || seq !== probeSeq.current) return
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
