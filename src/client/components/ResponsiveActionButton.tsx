/** A labelled host action that uses the icon adapter's seat in a narrow container. */
import type { ComponentProps, ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './IconButton.module.css'

export function ResponsiveActionButton({
  label,
  icon,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'icon'> & {
  readonly label: string
  readonly icon: ReactNode
}) {
  return (
    <Button
      {...props}
      aria-label={label}
      icon={icon}
      className={clsx(css.responsiveButton, className)}
    >
      <span className={css.responsiveLabel}>{label}</span>
    </Button>
  )
}
