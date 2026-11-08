/** Menu selection boundary used by staged settings form tests. */
import { createElement, type ReactNode } from 'react'
export function MenuItemButtonStub({
  children,
  onSelect,
  separatorBefore: _separator,
  ...props
}: Record<string, unknown>) {
  return createElement(
    'button',
    { ...props, role: 'menuitem', onClick: onSelect },
    children as ReactNode,
  )
}
