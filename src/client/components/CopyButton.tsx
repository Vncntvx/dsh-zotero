/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards. The visible text is
 * the caller's own label, switching to `copiedLabel` while the feedback
 * window is open, so two copy buttons in one card never both read "Copy";
 * `label` doubles as the accessible name. The feedback lane itself lives in
 * {@link useCopyFeedback}, so the citation action row and this button share
 * one stale-answer rule.
 * @module dsh-zotero/client/components/CopyButton
 */

import { type MouseEvent, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCopyFeedback } from './useCopyFeedback.ts'
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
  const { phase, copyText } = useCopyFeedback(value)
  const copied = phase === 'done'

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    copyText(value)
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
