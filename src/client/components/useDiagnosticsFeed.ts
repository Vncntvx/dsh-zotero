/**
 * The diagnostics card's live feed over the `zotero/diagnostics` snapshot
 * endpoint. Polling lives here rather than in the card so the interval, the
 * visibility check, and the in-flight guard have one owner.
 *
 * @module dsh-zotero/client/useDiagnosticsFeed
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroDiagnosticsView } from '../../contract.ts'

export interface DiagnosticsFeedState {
  readonly loading: boolean
  readonly data?: ZoteroDiagnosticsView
  readonly error?: string
}

export interface UseDiagnosticsFeedOptions {
  /** Poll period while the panel is visible, in milliseconds. */
  readonly pollMs?: number
}

export interface UseDiagnosticsFeedReturn {
  readonly state: DiagnosticsFeedState
  readonly refresh: () => Promise<void>
}

/** Default poll period in milliseconds: two seconds trails a reproduced failure without loading the endpoint. */
const DEFAULT_POLL_MS = 2000

/**
 * Live feed over the `zotero/diagnostics` snapshot endpoint.
 *
 * The harness offers a plugin no host-to-client event channel (the forwarded
 * Remote event allowlist is closed to plugins), so the panel keeps current by
 * polling a snapshot: the same on-open-fetch shape the harness's own
 * plugin-inventory tab uses, plus a light interval that runs only while the
 * document is visible and the panel is mounted. One in-flight guard keeps
 * clicks, ticks, and visibility returns from stacking calls; the unmount
 * guard mirrors {@link useZoteroProbe}.
 *
 * This is a foreground UI behavior, not a daemon: the interval exists only
 * while the mounted panel is visible, and it disappears with the component.
 * AGENTS.md's "No background polling daemons" rule governs host-side
 * resident work (the host never polls; every request is user-driven), and
 * `docs/architecture.md` records this panel's polling and its reason.
 */
export function useDiagnosticsFeed(
  diagnostics?: () => Promise<RemoteResult<ZoteroDiagnosticsView>>,
  options?: UseDiagnosticsFeedOptions,
): UseDiagnosticsFeedReturn {
  const [state, setState] = useState<DiagnosticsFeedState>({
    loading: diagnostics !== undefined,
  })
  const inFlightRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!diagnostics || inFlightRef.current) return
    inFlightRef.current = true
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const res = await diagnostics()
      if (unmountedRef.current) return
      setState(
        res.ok ? { loading: false, data: res.value } : { loading: false, error: res.error.message },
      )
    } catch (err) {
      if (unmountedRef.current) return
      setState({ loading: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlightRef.current = false
    }
  }, [diagnostics])

  useEffect(() => {
    if (!diagnostics) return
    void refresh()
    const pollMs = options?.pollMs ?? DEFAULT_POLL_MS
    const tick = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onVisibility = (): void => {
      // Returning to the panel should not wait out the interval.
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = setInterval(tick, pollMs)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [diagnostics, options?.pollMs, refresh])

  return { state, refresh }
}
