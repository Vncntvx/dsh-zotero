/**
 * The browser's literature-trail pager.
 *
 * The projection's wire view is windowed, so the rows behind that window are
 * fetched one page at a time and appended to what the view already shows.
 * A page belongs to one session, list, instance and revision: when any of
 * them changes, the accepted pages are retired rather than continued against
 * a different fold.
 * @module dsh-zotero/client/components/workspace/useSourcePage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroSourcePageRequestView,
  ZoteroSourcePageResultView,
  ZoteroSourcePageTarget,
} from '../../../contract.ts'
import { messageOf } from '../../error-text.ts'

/** The wire call one page needs. */
export type SourcePageCall = (
  request: ZoteroSourcePageRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroSourcePageResultView>>

/** The pages one list has accepted so far. */
export interface SourcePager {
  /** The accepted pages, oldest first; their rows are appended to the view's. */
  readonly pages: readonly ZoteroSourcePageResultView[]
  readonly loading: boolean
  readonly error?: string
  /** The revision the host reported; the next request fences on it. */
  readonly revision?: number
  /** Whether rows remain behind the ones already shown. */
  readonly hasMore: boolean
  /** How many rows the caller shows once the accepted pages are appended. */
  readonly shown: number
  readonly loadMore: () => void
  readonly retry: () => void
}

/** One accepted page with the offset it served. */
interface PagerState {
  readonly key: string
  readonly pages: readonly ZoteroSourcePageResultView[]
  readonly revision?: number
  readonly loading: boolean
  readonly error?: string
  readonly attempt: number
}

const EMPTY_STATE: PagerState = { key: '', pages: [], loading: false, attempt: 0 }

/**
 * The pages of one bounded list, appended as the user asks for more.
 *
 * The caller states how many rows it already shows (the projection view's
 * head) and how many the list holds in total; the pager asks the host for the
 * rows behind the shown ones and keeps the accepted pages. The first request
 * carries no revision — the caller has none yet — and every later one is
 * fenced on the revision the host reported. A click is one request: the
 * in-flight work runs outside the effect cycle, so its own settle write can
 * never re-trigger it, and only a change of list identity aborts it.
 * @param call - the wire call; absent disables the pager.
 * @param options - the list identity, the shown count, and the total.
 * @returns the pager state.
 */
export function useSourcePage(
  call: SourcePageCall | undefined,
  options: {
    readonly sessionId?: string
    readonly target: ZoteroSourcePageTarget
    readonly currentServerId?: string
    /** The rows the caller already shows; the host continues from there. */
    readonly offset: number
    /** The list's exact total; the pager reports whether rows remain. */
    readonly total: number
    readonly enabled?: boolean
  },
): SourcePager {
  const { sessionId, target, currentServerId, offset, total } = options
  const enabled = call !== undefined && sessionId !== undefined && options.enabled !== false
  // The list identity a page belongs to: the caller's list plus the count of
  // rows already accepted. An offset change means the view's head grew or the
  // filter moved, so the accepted pages no longer continue that list.
  const key = JSON.stringify([sessionId, target, currentServerId, offset])
  const [state, setState] = useState<PagerState>(EMPTY_STATE)
  const [click, setClick] = useState(0)
  const revisionRef = useRef<number>()
  const pagesRef = useRef<readonly ZoteroSourcePageResultView[]>([])
  /** The abort of the one in-flight request; the identity change owns it. */
  const inflightRef = useRef<AbortController>()
  const current = state.key === key ? state : EMPTY_STATE
  const pages = current.pages
  // The rows the caller shows once the accepted pages are appended: the last
  // page names the offset it served, and its size is the host's page bound.
  const shown =
    pages.length === 0
      ? offset
      : Math.max(
          offset,
          (pages[pages.length - 1]?.offset ?? 0) + (pages[pages.length - 1]?.limit ?? 0),
        )

  // The settled state is mirrored during render: the click effect must read
  // what this list has already accepted, not the previous commit's value.
  revisionRef.current = current.revision
  pagesRef.current = pages

  const loadMore = useCallback(() => {
    if (!enabled) return
    setClick((value) => value + 1)
  }, [enabled])

  const retry = useCallback(() => {
    if (!enabled) return
    setClick((value) => value + 1)
  }, [enabled])

  // One click is one request. The effect reads the settled state through the
  // refs and writes only into refs and the single `click` counter, so no
  // state write inside the cycle can re-enter it. A click the identity has
  // left behind never fires: the counter's own key ref guards it below.
  const clickKeyRef = useRef<string>(key)
  if (clickKeyRef.current !== key) {
    // Render-time reset: the accepted pages and the pending click belong to
    // the previous identity, and aborting here cannot race a commit.
    clickKeyRef.current = key
    if (click !== 0) setClick(0)
  }
  useEffect(() => {
    inflightRef.current?.abort()
    inflightRef.current = undefined
    if (!enabled || call === undefined || sessionId === undefined || click === 0) return
    const controller = new AbortController()
    inflightRef.current = controller
    const revision = revisionRef.current
    const accepted = pagesRef.current
    // The next request continues behind the rows the caller already shows,
    // whether they came from the view's head or the accepted pages.
    const nextOffset = Math.max(
      offset,
      accepted.length === 0
        ? offset
        : (accepted[accepted.length - 1]?.offset ?? 0) +
            (accepted[accepted.length - 1]?.limit ?? 0),
    )
    setState((previous) => ({ ...previous, key, loading: true, error: undefined }))
    void (async () => {
      try {
        const result = await call(
          {
            sessionId,
            target,
            offset: nextOffset,
            ...(currentServerId === undefined ? {} : { currentServerId }),
            ...(revision === undefined ? {} : { revision }),
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (!result.ok) throw result.error
        if (result.value.sessionId !== sessionId) {
          throw new Error('The source page belongs to another session.')
        }
        inflightRef.current = undefined
        setState((previous) =>
          previous.key === key
            ? {
                key,
                pages: [...previous.pages, result.value],
                revision: result.value.revision,
                loading: false,
                error: undefined,
                attempt: click,
              }
            : previous,
        )
      } catch (error) {
        if (controller.signal.aborted) return
        inflightRef.current = undefined
        setState((previous) =>
          previous.key === key
            ? { ...previous, key, loading: false, error: messageOf(error), attempt: click }
            : previous,
        )
      }
    })()
    return () => {
      controller.abort()
      if (inflightRef.current === controller) inflightRef.current = undefined
    }
    // The refs carry the settled state, so the cycle stays click-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, click, currentServerId, enabled, key, sessionId, offset, total])

  return {
    pages,
    loading: current.loading,
    ...(current.error === undefined ? {} : { error: current.error }),
    ...(current.revision === undefined ? {} : { revision: current.revision }),
    hasMore: enabled && shown < total,
    shown,
    loadMore,
    retry,
  }
}
