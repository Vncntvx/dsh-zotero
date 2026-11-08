/** Explicit recovery for URL PDF tabs after their temporary bytes expire. */
import { useState } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export function ZoteroPdfRecoveryMenu(props: {
  tab: { id: string; contentId?: string }
  sessionId: string
  dismiss(): void
  t: TranslateNS<'zotero'>
  source(address: string): string | undefined
  recoveryError(): unknown
  reload(sessionId: string, tabId: string, address: string): Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const address = props.tab.contentId ?? ''
  if (!props.source(address) && !address.includes('/dsh-zotero-pdf-')) return null
  return (
    <>
      <MenuItemButton
        disabled={loading}
        onSelect={() => {
          setLoading(true)
          setError(undefined)
          void Promise.resolve()
            .then(() => {
              const failure = props.recoveryError()
              if (failure) throw failure
              return props.reload(props.sessionId, props.tab.id, address)
            })
            .then(
              () => props.dismiss(),
              (failure: unknown) => {
                setLoading(false)
                setError(failure instanceof Error ? failure.message : String(failure))
              },
            )
        }}
      >
        {props.t(loading ? 'libraryLoading' : 'libraryPdfReload')}
      </MenuItemButton>
      {error && <p role="alert">{props.t('libraryPdfDownloadError', { message: error })}</p>}
    </>
  )
}
