/**
 * Tab actions menu items contributed to `sidebar.right.tab.menu.item`.
 * @module dsh-zotero/client/components/library/ZoteroLibraryMenu
 */

import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { LIBRARY_TAB_KIND } from '../../library-tab.ts'

export interface ZoteroLibraryMenuProps {
  readonly tab?: { readonly kind?: string; readonly id?: string }
  readonly sessionId?: string
  readonly dismiss?: () => void
  readonly t: TranslateNS<'zotero'>
  readonly onRefresh?: (sessionId: string, tabId: string) => void
  /** Host-backed protocol launcher from the shared client face. */
  readonly openProtocol?: (url: string) => Promise<boolean>
}

export function ZoteroLibraryMenu({
  tab,
  sessionId,
  dismiss,
  onRefresh,
  openProtocol,
  t,
}: ZoteroLibraryMenuProps) {
  if (tab?.kind !== LIBRARY_TAB_KIND) return null
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
          if (openProtocol !== undefined) void openProtocol('zotero://select/')
        }}
      >
        {t('openInZotero')}
      </MenuItemButton>
    </>
  )
}
