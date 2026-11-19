/**
 * Overflow entry for an action row: an icon-only ellipsis whose portaled menu
 * carries secondary actions. The trigger has an accessible label and tooltip.
 * @module dsh-zotero/client/components/MoreActionsMenu
 */

import { useState, type ReactNode } from 'react'
import {
  IconEllipsisOutlineMedium,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from './IconButton.tsx'

export interface MoreActionsMenuProps {
  /** The accessible name and tooltip of the trigger, localized by the caller. */
  readonly label: string
  /** Data-driven rows (including separators and submenu parents). */
  readonly items?: readonly MenuEntry[]
  /** Data-row activation; ids are the ones declared in `items`. */
  readonly onSelect?: (id: string) => void
  /** Component rows for actions that need their own stateful UI. */
  readonly children?: ReactNode
  /** Disables the trigger while a row action runs. */
  readonly disabled?: boolean
  /** Layout class applied to the trigger. */
  readonly className?: string
}

/** Render the row's overflow menu. */
export function MoreActionsMenu({
  label,
  items,
  onSelect,
  children,
  disabled = false,
  className,
}: MoreActionsMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      align="end"
      onClose={() => setOpen(false)}
      {...(onSelect === undefined ? {} : { onSelect })}
      {...(items === undefined ? {} : { items })}
      anchor={
        <Tooltip label={label} side="bottom" delayMs={500}>
          <IconButton
            shape="square"
            className={className}
            icon={<IconEllipsisOutlineMedium />}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen((value) => !value)}
          />
        </Tooltip>
      }
    >
      {children}
    </Menu>
  )
}
