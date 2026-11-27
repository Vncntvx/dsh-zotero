/**
 * Return focus to the control that opened a transient panel when it closes.
 * The panel records the focused element at mount, so the trigger does not have
 * to thread a ref through every action button.
 * @module dsh-zotero/client/reader/return-focus
 */

import { useEffect, useRef } from 'react'

export function useReturnFocus(): void {
  const previous = useRef<HTMLElement | null>(null)
  useEffect(() => {
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const target = previous.current
      if (!target) return
      // The trigger may be inert or still unmounted in this commit; focus on
      // the next frame, once the panel that replaced it has gone.
      requestAnimationFrame(() => {
        if (target.isConnected) target.focus()
      })
    }
  }, [])
}
