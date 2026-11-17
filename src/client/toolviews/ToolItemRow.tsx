/** Shared container for a tool card's item heading, metadata and actions. */
import type { HTMLAttributes, ReactNode } from 'react'
import css from './toolviews.module.css'

export function ToolItemRow({
  title,
  leading,
  trailing,
  meta,
  actions,
  children,
  ...attributes
}: Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'className'> & {
  readonly title: ReactNode
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly meta?: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <div {...attributes} className={css.itemCard}>
      <div className={css.itemHeader}>
        {leading}
        <span className={css.itemTitle}>{title}</span>
        {trailing}
      </div>
      {meta !== undefined && <div className={css.itemMeta}>{meta}</div>}
      {children}
      {actions !== undefined && <div className={css.itemActions}>{actions}</div>}
    </div>
  )
}
