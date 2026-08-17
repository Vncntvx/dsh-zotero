/**
 * The sources lens header: the neutral count strip (candidates, inspected,
 * evidence-bearing, exported — item counts per provable stage, no funnel),
 * the snapshot scope note, and the honest omission note for search rows the
 * bounded projections did not itemize.
 * @module dsh-zotero/client/components/SourcesHeader
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../presenters.ts'
import type { SourceWorkspace } from '../sources/model.ts'
import { countsOf } from '../sources/selectors.ts'
import css from './SourcesList.module.css'

export interface SourcesHeaderProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The Sources lens header: neutral counts plus scope and omission notes. */
export function SourcesHeader({ workspace, t }: SourcesHeaderProps) {
  const counts = countsOf(workspace)
  const chips: string[] = []
  if (counts.candidates > 0)
    chips.push(interpolate(t('countCandidates'), { count: counts.candidates }))
  if (counts.inspected > 0)
    chips.push(interpolate(t('countInspected'), { count: counts.inspected }))
  if (counts.evidence > 0) chips.push(interpolate(t('countEvidence'), { count: counts.evidence }))
  if (counts.exported > 0) chips.push(interpolate(t('countExported'), { count: counts.exported }))
  return (
    <header className={css.header}>
      {chips.length > 0 && (
        <div className={css.counts} role="group">
          {chips.map((chip) => (
            <span key={chip} className={css.countChip}>
              {chip}
            </span>
          ))}
        </div>
      )}
      {counts.candidates > 0 && <p className={css.note}>{t('sourcesScopeNote')}</p>}
      {workspace.omittedRows > 0 && (
        <p className={css.note}>
          {interpolate(t('omittedRowsNote'), { count: workspace.omittedRows })}
        </p>
      )}
    </header>
  )
}
