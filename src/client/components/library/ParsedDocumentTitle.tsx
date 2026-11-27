import { useMemo } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseParsedTabAddress } from '../../parsed-tab.ts'
import { useParsedTitleMeta, type ParsedDocuments } from '../../parsed-documents.ts'

interface ParsedDocumentTitleFace {
  /** The lease-free title source; the chip never opens the full document. */
  readonly documents: ParsedDocuments
}

export function ParsedDocumentTitle(
  props: PropsRuntime<'sidebar.right.pane.tab.title'> &
    InjectFace<ParsedDocumentTitleFace> &
    PropsLocale<'zotero'>,
) {
  const tab = props.useTabInfo().tab
  const target = useMemo(
    () => parseParsedTabAddress(tab.navigation.address, tab.navigation.params),
    [tab.navigation.address, tab.navigation.params],
  )
  const meta = useParsedTitleMeta(props.documents, tab.navigation.address, target)
  if (target === undefined) return props.t('tabParsedFallback')
  return meta.title || target.title || props.t('tabParsedFallback')
}
