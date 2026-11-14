/**
 * One seq-keyed transient toast per surface: `notify` re-arms the primitive
 * `Toast` by bumping the sequence, and the toast clears itself when done.
 * @module dsh-zotero/client/use-transient-toast
 */
import { useCallback, useRef, useState } from 'react'

export interface TransientToast {
  readonly seq: number
  readonly text: string
  readonly tone?: 'success'
}

/** One transient toast per surface; see ParsedManagerTab and ParsedDocumentTab. */
export function useTransientToast(): {
  readonly toast: TransientToast | null
  readonly notify: (text: string, tone?: 'success') => void
  readonly clear: () => void
} {
  const [toast, setToast] = useState<TransientToast | null>(null)
  const seq = useRef(0)
  const notify = useCallback((text: string, tone?: 'success') => {
    seq.current += 1
    setToast({ seq: seq.current, text, tone })
  }, [])
  const clear = useCallback(() => setToast(null), [])
  return { toast, notify, clear }
}
