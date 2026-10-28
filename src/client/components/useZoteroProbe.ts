/**
 * The shared live-probe hook behind the `/zotero` command card and the
 * plugin-detail status card. Both read the same `zoteroStatus` endpoint and
 * neither may stack calls on it, so the in-flight and unmount guards live here
 * rather than in each caller.
 *
 * @module dsh-zotero/client/useZoteroProbe
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../../contract.ts'

interface ZoteroProbeState {
  readonly loading: boolean
  readonly data?: ZoteroStatusView
  readonly error?: string
}

interface UseZoteroProbeOptions {
  readonly initialAutoRun?: boolean
  readonly initialData?: ZoteroStatusView
}

interface UseZoteroProbeReturn {
  readonly state: ZoteroProbeState
  /**
   * Whether this mount's probe has answered, successfully or not. Callers that
   * gate side effects on connectivity wait for it: a cached seed only paints.
   */
  readonly settled: boolean
  readonly runProbe: () => Promise<void>
}

/** The single derivation of a probe answer, used by the seed and the answer. */
function probeStateOf(status: ZoteroStatusView): ZoteroProbeState {
  return {
    loading: false,
    data: status,
    error: status.connected ? undefined : status.diagnosis,
  }
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
  const [state, setState] = useState<ZoteroProbeState>(() =>
    options?.initialData !== undefined
      ? probeStateOf(options.initialData)
      : { loading: options?.initialAutoRun === true },
  )
  const [settled, setSettled] = useState(false)

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
        setState(probeStateOf(res.value))
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
      if (!unmountedRef.current) setSettled(true)
    }
  }, [probe])

  useEffect(() => {
    if (options?.initialAutoRun && probe) {
      void runProbe()
    }
  }, [options?.initialAutoRun, probe, runProbe])

  return { state, settled, runProbe }
}
