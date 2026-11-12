/**
 * A copy button with a brief copied-feedback window (cleared on unmount).
 * The shared copy leaf of the panel's rows and cards. The visible text is
 * the caller's own label, switching to `copiedLabel` while the feedback
 * window is open, so two copy buttons in one card never both read "Copy";
 * `label` doubles as the accessible name. The feedback lane itself lives in
 * {@link useCopyFeedback}, so the citation action row and this button share
 * one stale-answer rule.
 *
 * The control is the host `Button`; `link` renders the shared text-link button
 * because the host has no link-button primitive. `className` carries layout
 * only.
 * @module dsh-zotero/client/components/CopyButton
 */

import { type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCopyFeedback } from './useCopyFeedback.ts'
import linkCss from './link.module.css'

/** Which host control the copy action wears. */
export type CopyButtonVariant = 'outline' | 'ghost' | 'link'

interface CopyButtonProps {
  readonly value: string
  /** The visible (and accessible) name of the action, e.g. "Copy ref". */
  readonly label: string
  /** The visible text while the copied-feedback window is open. */
  readonly copiedLabel: string
  /**
   * The copied subject's identity, when it differs from `value`.
   *
   * `value` is the payload, and most callers derive it from a loaded record,
   * so a changed payload means a different subject and the feedback lane
   * resets. Pass this for a control whose payload keeps growing under one
   * subject (a live log bundle): the in-flight copy then survives the next
   * chunk instead of being cancelled by it.
   */
  readonly identityKey?: unknown
  /** Layout-only placement class; the host Button owns all geometry. */
  readonly className?: string
  /** Optional hover tooltip for extra guidance. */
  readonly title?: string
  /** Whether the copy action is disabled. */
  readonly disabled?: boolean
  /** Which control to render; defaults to the outlined host Button. */
  readonly variant?: CopyButtonVariant
  /** Optional leading icon node. */
  readonly icon?: ReactNode
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  identityKey,
  className,
  title,
  disabled,
  variant = 'outline',
  icon,
}: CopyButtonProps) {
  const { phase, copyText } = useCopyFeedback(identityKey, value)
  const copied = phase === 'done'
  const text = copied ? copiedLabel : label

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    copyText(value)
  }

  const shared = {
    'aria-label': label,
    title: title ?? label,
    disabled,
    onClick: handleClick,
  }

  if (variant === 'link') {
    return (
      <button type="button" className={clsx(linkCss.link, className)} {...shared}>
        {icon}
        <span>{text}</span>
      </button>
    )
  }

  return (
    <Button variant={variant} size="sm" icon={icon} className={className} {...shared}>
      {text}
    </Button>
  )
}
