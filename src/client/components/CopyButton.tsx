/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards. The visible text is
 * the caller's own label — switching to `copiedLabel` while the feedback
 * window is open — so two copy buttons in one card never both read "Copy";
 * `label` doubles as the accessible name.
 * @module dsh-zotero/client/components/CopyButton
 */

import { useEffect, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SourcesList.module.css'

export interface CopyButtonProps {
  readonly value: string
  /** The visible (and accessible) name of the action, e.g. "Copy ref". */
  readonly label: string
  /** The visible text while the copied-feedback window is open. */
  readonly copiedLabel: string
}

export function CopyButton({ value, label, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
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
      className={css.lineAction}
      aria-label={label}
      onClick={() => {
        void writeClipboard(value)
        setCopied(true)
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
