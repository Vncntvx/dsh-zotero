/**
 * Tab actions menu items contributed to `sidebar.right.tab.menu.item`.
 * @module dsh-zotero/client/components/library/ZoteroLibraryMenu
 */

import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { launchZoteroProtocol } from '../../actions/open-zotero.ts'

export interface ZoteroLibraryMenuProps {
  readonly tab?: { readonly kind?: string; readonly id?: string }
  readonly sessionId?: string
  readonly dismiss?: () => void
  readonly t: TranslateNS<'zotero'>
  readonly onRefresh?: (sessionId: string, tabId: string) => void
}

export function ZoteroLibraryMenu({
  tab,
  sessionId,
  dismiss,
  onRefresh,
  t,
}: ZoteroLibraryMenuProps) {
  if (tab?.kind !== 'zotero-library') return null
  return (
    <>
      <MenuItemButton
        onSelect={() => {
          dismiss?.()
          if (sessionId && tab?.id) onRefresh?.(sessionId, tab.id)
        }}
      >
        {t('libraryMenuRefresh')}
      </MenuItemButton>
      <MenuItemButton
        onSelect={() => {
          dismiss?.()
          launchZoteroProtocol('zotero://select/')
        }}
      >
        {t('openInZotero')}
      </MenuItemButton>
    </>
  )
}
