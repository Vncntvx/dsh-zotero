/**
 * The `Menu` stubs: a display-only face for specs that only read the rows, and
 * an interactive variant that forwards row activation and Escape so the owning
 * component's own callbacks stay exercised without the real portal.
 * @module tests/client/helpers/menu-stub
 */

import { createElement, type ReactElement } from 'react'

/** One selectable row of the `Menu` stub, as the workspace specs declare it. */
export interface MenuStubItem {
  readonly id: string
  readonly label?: unknown
  readonly disabled?: boolean
}

/** Props the `Menu` stub reads: the subset of the primitive's surface in play. */
export interface MenuStubProps {
  readonly anchor?: unknown
  readonly items?: readonly MenuStubItem[]
  readonly open?: boolean
  /** Row activation; the interactive variant forwards it. */
  readonly onSelect?: (id: string) => void
  /** Escape and outside-click close; the interactive variant forwards it. */
  readonly onClose?: () => void
}

/** The display-only `Menu`: the trigger plus the open rows, without callbacks. */
export function staticMenu({ anchor, items, open }: MenuStubProps): ReactElement {
  return createElement(
    'div',
    { 'data-menu': open === true ? 'open' : undefined },
    anchor as never,
    open === true
      ? items?.map((item) =>
          createElement('span', { key: item.id, 'data-menu-item': item.id }, item.label as never),
        )
      : undefined,
  )
}

/** The `Menu` variant that keeps the primitive's callback contract. */
export function interactiveMenu({
  anchor,
  items,
  open,
  onSelect,
  onClose,
}: MenuStubProps): ReactElement {
  return createElement(
    'div',
    {
      'data-menu': open === true ? 'open' : undefined,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') onClose?.()
      },
    },
    anchor as never,
    open === true
      ? items?.map((item) =>
          createElement(
            'span',
            {
              key: item.id,
              'data-menu-item': item.id,
              onClick: () => {
                onSelect?.(item.id)
              },
            },
            item.label as never,
          ),
        )
      : undefined,
  )
}
