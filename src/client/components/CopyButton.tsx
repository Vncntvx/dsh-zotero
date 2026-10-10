/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards. The visible text is
 * the caller's own label, switching to `copiedLabel` while the feedback
 * window is open, so two copy buttons in one card never both read "Copy";
 * `label` doubles as the accessible name.
 * @module dsh-zotero/client/components/CopyButton
 */

import { useEffect, useRef, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './cards.module.css'

export interface CopyButtonProps {
  readonly value: string
  /** The visible (and accessible) name of the action, e.g. "Copy ref". */
  readonly label: string
  /** The visible text while the copied-feedback window is open. */
  readonly copiedLabel: string
  /**
   * Placement class from the caller's own surface. Defaults to the row/card
   * text button; the inspector's action row passes its bordered pill so a copy
   * beside the other actions keeps the row's rhythm.
   */
  readonly className?: string
}

export function CopyButton({ value, label, copiedLabel, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  // A click epoch: a slow clipboard promise resolving after a newer click
  // (or after unmount) must not flip the flag for a value it did not write.
  const epoch = useRef(0)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])
  return (
    <button
      type="button"
      className={className ?? css.lineAction}
      aria-label={label}
      onClick={() => {
        const mine = (epoch.current += 1)
        void writeClipboard(value).then((ok) => {
          // Only a successful write earns the feedback; a denial (iframe
          // permissions, insecure context) stays on the action label.
          if (ok && epoch.current === mine) setCopied(true)
        })
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
