/**
 * The evidence overview: the cross-source evidence board — every evidence
 * passage of the session grouped by literature, reached from the sidebar's
 * secondary entry ("查看全部证据 N"). This is the plugin's comparative
 * value over a plain Zotero list: passages from many items side by side, to
 * weigh conflicting claims. The default workflow stays on the master-detail
 * sources view; this board is the aggregation surface. v0.4 renders the
 * basic aggregation (one card per evidence-bearing source); richer boards
 * come later.
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

/** The evidence overview: scope note plus one card per evidence-bearing source. */
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
          <p className={css.note}>{t('evidenceScopeNote')}</p>
          {sources.map((item) => (
            <EvidenceCard key={item.key} item={item} t={t} />
          ))}
        </>
      )}
    </div>
  )
}
