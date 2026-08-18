/**
 * The passage overview: the cross-source board — every passage of the session
 * grouped by literature, reached from the sidebar's aggregate entry ("片段总览
 * N"). This is the plugin's comparative value over a plain Zotero list:
 * passages from many items side by side, to weigh conflicting claims. The
 * default workflow stays on the master-detail sources view; this board is the
 * aggregation surface. One card per evidence-bearing source, and the cards
 * carry their own facts — no scope note is needed on the page itself.
 * @module dsh-zotero/client/components/workspace/EvidenceOverview
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../../sources/model.ts'
import { filterSources } from '../../sources/selectors.ts'
import { EvidenceCard } from '../EvidenceCard.tsx'
import css from './workspace.module.css'

export interface EvidenceOverviewProps {
  readonly workspace: SourceWorkspace
  readonly onBack: () => void
  readonly t: TranslateNS<'zotero'>
}

/** The evidence overview: one card per evidence-bearing source. */
export function EvidenceOverview({ workspace, onBack, t }: EvidenceOverviewProps) {
  const sources = filterSources(workspace.sources, 'evidence')
  return (
    <div className={css.evidencePage}>
      <button type="button" className={css.backAction} onClick={onBack}>
        {t('backToSources')}
      </button>
      {sources.length === 0 ? (
        <p className={css.emptyNote}>{t('evidenceEmptyNote')}</p>
      ) : (
        <>
          {sources.map((item) => (
            <EvidenceCard key={item.key} item={item} t={t} />
          ))}
        </>
      )}
    </div>
  )
}
