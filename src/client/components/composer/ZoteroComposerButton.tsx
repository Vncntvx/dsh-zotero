/**
 * Toolbar shortcut button mounted into the chat composer's `conversation.input.left` slot.
 * Clicking opens/focuses the personal Zotero library in the right sidebar.
 * @module dsh-zotero/client/components/composer/ZoteroComposerButton
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZoteroLibraryIcon } from '../library/ZoteroLibraryIcon.tsx'
import css from './composer.module.css'

export interface ZoteroComposerButtonProps {
  readonly t: TranslateNS<'zotero'>
  readonly onClick?: () => void
}

export function ZoteroComposerButton({ t, onClick }: ZoteroComposerButtonProps) {
  const label = t('tabLibrary')
  return (
    <Tooltip label={label} side="top" delayMs={400}>
      <button
        type="button"
        className={css.composerButton}
        onClick={onClick}
        aria-label={label}
        title={label}
      >
        <ZoteroLibraryIcon size={16} />
      </button>
    </Tooltip>
  )
}

export interface ZoteroComposerSlotProps {
  readonly t: TranslateNS<'zotero'>
  readonly onOpen?: () => void
}

export function ZoteroComposerSlot({ t, onOpen }: ZoteroComposerSlotProps) {
  return <ZoteroComposerButton t={t} onClick={onOpen} />
}
