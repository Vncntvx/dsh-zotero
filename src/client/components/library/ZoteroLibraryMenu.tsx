/**
 * Tab actions menu items contributed to `sidebar.right.tab.menu.item`.
 * @module dsh-zotero/client/components/library/ZoteroLibraryMenu
 */

import { useState } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroClientFace } from '../../actions/client-face.ts'
import { LIBRARY_TAB_KIND } from '../../library-tab.ts'

export interface ZoteroLibraryMenuProps {
  readonly tab?: { readonly kind?: string; readonly id?: string }
  readonly sessionId?: string
  readonly dismiss?: () => void
  readonly t: TranslateNS<'zotero'>
  readonly onClear?: (sessionId: string, tabId: string) => void | Promise<void>
  readonly onRefresh?: (sessionId: string, tabId: string) => void
  /** Root-provided shared face; the slot framework supplies it like `t`. */
  readonly useZoteroClient: () => ZoteroClientFace
}

export function ZoteroLibraryMenu({
  tab,
  sessionId,
  dismiss,
  onRefresh,
  onClear,
  useZoteroClient,
  t,
}: ZoteroLibraryMenuProps) {
  const [error, setError] = useState<string>()
  if (tab?.kind !== LIBRARY_TAB_KIND) return null
  const { openProtocol } = useZoteroClient()
  return (
    <>
      <MenuItemButton
        onSelect={() => {
          if (!sessionId || !tab?.id) return
          void Promise.resolve()
            .then(() => onClear?.(sessionId, tab.id!))
            .then(
              () => dismiss?.(),
              (failure: unknown) =>
                setError(failure instanceof Error ? failure.message : String(failure)),
            )
        }}
      >
        {t('libraryClearPosition')}
      </MenuItemButton>
      {error && <p role="alert">{t('libraryPositionError', { message: error })}</p>}
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
          void openProtocol('zotero://select/')
        }}
      >
        {t('openInZotero')}
      </MenuItemButton>
    </>
  )
}
