/**
 * The evidence lens: the session's evidence passages grouped by source —
 * one card per literature item that has any. The intro note states the
 * honest scope: gathered evidence, not proven answer support.
 * @module dsh-zotero/client/components/EvidenceLens
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../sources/model.ts'
import { filterSources } from '../sources/selectors.ts'
import { EvidenceCard } from './EvidenceCard.tsx'
import css from './SourcesList.module.css'

export interface EvidenceLensProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The evidence lens: scope note plus one card per evidence-bearing source. */
export function EvidenceLens({ workspace, t }: EvidenceLensProps) {
  const sources = filterSources(workspace.sources, 'evidence')
  if (sources.length === 0) {
    return <p className={css.emptyNote}>{t('evidenceEmptyNote')}</p>
  }
  return (
    <div className={css.wrap}>
      <p className={css.note}>{t('evidenceScopeNote')}</p>
      {sources.map((item) => (
        <EvidenceCard key={item.key} item={item} t={t} />
      ))}
    </div>
  )
}
