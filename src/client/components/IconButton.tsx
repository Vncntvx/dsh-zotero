/**
 * Icon-only control built on the host `Button`. `ui-primitives` has no round or
 * square icon-only variant, so this adapter supplies geometry only; fill,
 * hover, focus, disabled state, and typography stay the host's.
 * @module dsh-zotero/client/components/IconButton
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './IconButton.module.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Full round or a small rounded square. */
  readonly shape?: 'round' | 'square'
  /** 28px or 20px square. */
  readonly size?: 'md' | 'sm'
  /** Leading glyph, rendered through the host Button's icon seat. */
  readonly icon: ReactNode
}

/** Render one icon-only button over the official Button primitive. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { shape = 'square', size = 'md', icon, className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      icon={icon}
      className={clsx(css.iconButton, css[shape], css[size], className)}
      {...rest}
    />
  )
})
