import { useCallback, useEffect, useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroItemDetailView, ZoteroRemoteContract } from '../../contract.ts'
import { LibraryCitationActions } from '../components/library/LibraryCitationActions.tsx'
import {
  LibraryPreferencesContext,
  useLibraryPreferenceSource,
  type LibraryPreferenceSource,
} from '../library-preferences.tsx'

export interface ReaderCitationOptions {
  readonly preferences?: LibraryPreferenceSource
  readonly read: ZoteroRemoteContract['export']
  readonly translate: TranslateNS<'zotero'>
}

export function ReaderCitationCopy({
  options,
  item,
  enabled,
  tabSignal,
}: {
  readonly options: ReaderCitationOptions
  readonly item: ZoteroItemDetailView
  readonly enabled?: boolean
  readonly tabSignal: AbortSignal
}) {
  const preferences = useLibraryPreferenceSource(options.preferences)
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      lifetime.current = undefined
      controller.abort()
    }
  }, [enabled, item.ref, tabSignal])
  const read = useCallback<ZoteroRemoteContract['export']>(
    async (request) => {
      const current = lifetime.current
      if (!current) throw new DOMException('Citation export is unavailable.', 'AbortError')
      const signal = AbortSignal.any([current.signal, tabSignal])
      signal.throwIfAborted()
      const result = await options.read(request, signal)
      signal.throwIfAborted()
      return result
    },
    [options, tabSignal],
  )
  return (
    <LibraryPreferencesContext.Provider value={preferences}>
      <LibraryCitationActions
        key={JSON.stringify([item.ref, Boolean(enabled)])}
        detail={item}
        exportItem={enabled ? read : undefined}
        t={options.translate}
      />
    </LibraryPreferencesContext.Provider>
  )
}
