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
 * label.
 *
 * Two keys are ordered by what they describe, because they must be treated
 * differently. `subjectKey` is the identity of the thing being copied (a ref,
 * a row's key): when it changes the lane resets and the old answer can no
 * longer land. `contentKey` is only that subject's current text: when it
 * changes while a write is in flight the answer still belongs to the click the
 * user made, so the epoch is left alone and the label may land; a `done` label
 * that is already showing returns to `idle`, because it no longer describes
 * what is on screen. Passing a streaming value as `subjectKey` is the mistake
 * this split exists to prevent: every new chunk would cancel the copy the user
 * just asked for.
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
 * @param subjectKey - the copied subject's identity; a change resets the lane.
 * @param contentKey - the subject's current text; a change only clears a
 *   settled `done` label and never invalidates a write already in flight.
 * @returns the current phase, the thrown value (when `error`), and the controls.
 */
export function useCopyFeedback(subjectKey?: unknown, contentKey?: unknown): CopyFeedback {
  const [state, setState] = useState<CopyFeedbackState>(idleState)
  // Monotonic click identity: only the newest attempt may settle the lane, and
  // a reset or unmount invalidates every attempt that started before it.
  const epoch = useRef(0)
  const timer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined)
  // The latest reported phase, read by the content effect without subscribing
  // it to every transition of the lane.
  const phase = useRef<CopyPhase>('idle')
  phase.current = state.phase

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
  }, [subjectKey, reset])

  // The subject's text moved on. A landed label no longer describes the
  // control, but an attempt still waiting on the clipboard belongs to the
  // click the user made: leave its epoch alone so its answer may still land.
  const seenContent = useRef(contentKey)
  useEffect(() => {
    if (Object.is(seenContent.current, contentKey)) return
    seenContent.current = contentKey
    if (phase.current !== 'done') return
    clearTimer()
    setState(idleState())
  }, [contentKey, clearTimer])

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
