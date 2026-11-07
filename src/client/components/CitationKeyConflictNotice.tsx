/**
 * The one citation-key conflict notice the toolviews render: the same
 * sentence, in the same notice-chip style, wherever a row or a candidate
 * carries a conflict. The document row's title-area variant stays in
 * `ExportDocumentRow`, whose `<p>` sits in a different styling module.
 * @module dsh-zotero/client/components/CitationKeyConflictNotice
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CitationKeyConflict } from '../../citation-key.ts'
import css from '../toolviews/toolviews.module.css'

export interface CitationKeyConflictNoticeProps {
  /**
   * Present when the row's citation key disagrees with the native one. The
   * decoders' partial shapes (`null`, or fields that may be absent) degrade
   * to no notice, as they did before the shared component.
   */
  readonly conflict: CitationKeyConflict | null | undefined
  readonly t: TranslateNS<'zotero'>
}

export function CitationKeyConflictNotice({ conflict, t }: CitationKeyConflictNoticeProps) {
  if (conflict?.native === undefined || conflict?.extra === undefined) return null
  return (
    <div className={css.coverageNotice}>
      {t('toolCitationKeyConflict', { native: conflict.native, extra: conflict.extra })}
    </div>
  )
}
