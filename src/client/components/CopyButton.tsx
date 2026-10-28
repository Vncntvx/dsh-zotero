/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards. The visible text is
 * the caller's own label, switching to `copiedLabel` while the feedback
 * window is open, so two copy buttons in one card never both read "Copy";
 * `label` doubles as the accessible name.
 * @module dsh-zotero/client/components/CopyButton
 */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './cards.module.css'

interface CopyButtonProps {
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
  /** Optional hover tooltip for extra guidance. */
  readonly title?: string
  /** Whether the copy action is disabled. */
  readonly disabled?: boolean
  /** Renders as official Button variant="outline" size="sm". */
  readonly asButton?: boolean
  /** Optional leading icon node when rendered as Button. */
  readonly icon?: ReactNode
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  className,
  title,
  disabled,
  asButton = false,
  icon,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  // Click epochs drop a late clipboard answer that a newer click superseded.
  const epoch = useRef(0)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    const mine = (epoch.current += 1)
    void writeClipboard(value).then((ok) => {
      if (ok && epoch.current === mine) setCopied(true)
    })
  }

  if (asButton) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        icon={icon}
        onClick={handleClick}
      >
        {copied ? copiedLabel : label}
      </Button>
    )
  }

  return (
    <button
      type="button"
      className={className ?? css.lineAction}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={handleClick}
    >
      {icon}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  )
}
