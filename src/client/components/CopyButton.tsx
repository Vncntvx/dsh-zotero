/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards.
 * @module dsh-zotero/client/components/CopyButton
 */

import { useEffect, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SourcesList.module.css'

export function CopyButton({
  value,
  label,
  t,
}: {
  readonly value: string
  readonly label: string
  readonly t: TranslateNS<'zotero'>
}) {
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
      {copied ? t('copied') : t('copy')}
    </button>
  )
}
