/**
 * The feedback lane every clipboard control shares: one copy at a time, a
 * brief `done` window, a `rejected` arm the caller labels, and an `error` arm
 * that keeps the thrown value for the caller's own message. The hook owns the
 * epoch, the timer, and the clipboard write so a second control cannot copy
 * the same surface with a second implementation.
 *
 * `copy` settles asynchronously (the text is produced first); `copyText` is
 * the fast path for a value already in hand, so a plain copy button still
 * writes on the click itself. Both bump the epoch and clear the window before
 * they start: a late answer from a superseded click, a moved selection, or an
 * unmounted control is dropped by comparison instead of painting a stale
 * label. `resetKey` is the caller's identity for the copied subject (a ref, a
 * value): when it changes, the lane returns to `idle` and the old answer can
 * no longer land.
 * @module dsh-zotero/client/components/useCopyFeedback
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

/** How long a `done` phase stays visible before the lane returns to `idle`. */
export const COPY_FEEDBACK_MS = 1500

/** One clipboard attempt at a time: pending, succeeded, refused, or failed. */
export type CopyPhase = 'idle' | 'pending' | 'done' | 'rejected' | 'error'

/** What the hook exposes: the phase, the thrown value, and the copy controls. */
export interface CopyFeedback {
  readonly phase: CopyPhase
  readonly error: unknown
  readonly copy: (load: () => Promise<string>) => void
  readonly copyText: (text: string) => void
  readonly reset: () => void
}

interface CopyFeedbackState {
  readonly phase: CopyPhase
  readonly error: unknown
}

/** The idle state every reset lands on; a fresh object per transition. */
function idleState(): CopyFeedbackState {
  return { phase: 'idle', error: undefined }
}

/**
 * Share one clipboard-feedback lane across copy controls of the same subject.
 * @param resetKey - the copied subject's identity; a change resets the lane.
 * @returns the current phase, the thrown value (when `error`), and the controls.
 */
export function useCopyFeedback(resetKey?: unknown): CopyFeedback {
  const [state, setState] = useState<CopyFeedbackState>(idleState)
  // Monotonic click identity: only the newest attempt may settle the lane, and
  // a reset or unmount invalidates every attempt that started before it.
  const epoch = useRef(0)
  const timer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined)

  const clearTimer = useCallback((): void => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [])

  const reset = useCallback((): void => {
    epoch.current += 1
    clearTimer()
    setState(idleState())
  }, [clearTimer])

  // The caller's subject changed: the previous answer belongs to it, not to
  // what is on screen now.
  useEffect(() => {
    reset()
  }, [resetKey, reset])

  // Unmount invalidates in-flight answers and releases the feedback window.
  useEffect(
    () => () => {
      epoch.current += 1
      clearTimer()
    },
    [clearTimer],
  )

  /** Start one attempt: it owns the lane until a newer one or a reset. */
  const begin = useCallback((): number => {
    const mine = (epoch.current += 1)
    clearTimer()
    setState({ phase: 'pending', error: undefined })
    return mine
  }, [clearTimer])

  /**
   * Settle an attempt with the clipboard write. The write is issued
   * synchronously where the caller already has the text; `writeClipboard`
   * reports a refusal as `false` and never rejects for a host that withholds
   * the clipboard.
   */
  const settle = useCallback((mine: number, write: () => Promise<boolean>): void => {
    void (async () => {
      try {
        const accepted = await write()
        if (epoch.current !== mine) return
        if (!accepted) {
          setState({ phase: 'rejected', error: undefined })
          return
        }
        setState({ phase: 'done', error: undefined })
        timer.current = window.setTimeout(() => {
          timer.current = undefined
          // The window belongs to this attempt; a newer click already reset
          // the lane and this late arm must not.
          if (epoch.current !== mine) return
          setState(idleState())
        }, COPY_FEEDBACK_MS)
      } catch (error) {
        if (epoch.current !== mine) return
        setState({ phase: 'error', error })
      }
    })()
  }, [])

  const copyText = useCallback(
    (text: string): void => {
      const mine = begin()
      settle(mine, () => writeClipboard(text))
    },
    [begin, settle],
  )

  const copy = useCallback(
    (load: () => Promise<string>): void => {
      const mine = begin()
      void (async () => {
        try {
          const text = await load()
          if (epoch.current !== mine) return
          settle(mine, () => writeClipboard(text))
        } catch (error) {
          if (epoch.current !== mine) return
          setState({ phase: 'error', error })
        }
      })()
    },
    [begin, settle],
  )

  return { phase: state.phase, error: state.error, copy, copyText, reset }
}
