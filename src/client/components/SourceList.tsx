/**
 * The sources list: the filter bar (a subset of the stable union — clearing
 * a filter restores every source) above one expandable row per source.
 * @module dsh-zotero/client/components/SourceList
 */

import { useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../sources/model.ts'
import { filterSources, type SourceFilter } from '../sources/selectors.ts'
import { SourceRow } from './SourceRow.tsx'
import css from './SourcesList.module.css'

/** The filter bar's entries: filter id plus its locale key. */
const FILTERS: readonly {
  readonly id: SourceFilter
  readonly key:
    'filterAll' | 'filterEvidence' | 'filterExported' | 'filterAttachment' | 'filterFailed'
}[] = [
  { id: 'all', key: 'filterAll' },
  { id: 'evidence', key: 'filterEvidence' },
  { id: 'exported', key: 'filterExported' },
  { id: 'attachment', key: 'filterAttachment' },
  { id: 'failed', key: 'filterFailed' },
]

export interface SourceListProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** The sources list: filter bar plus the filtered rows. */
export function SourceList({ workspace, t, setDraft }: SourceListProps) {
  const [filter, setFilter] = useState<SourceFilter>('all')
  const visible = filterSources(workspace.sources, filter)
  return (
    <div className={css.wrap}>
      <div className={css.filterBar} role="group">
        {FILTERS.map((entry) => (
          <Pill
            key={entry.id}
            active={filter === entry.id}
            aria-pressed={filter === entry.id}
            onClick={() => {
              setFilter(entry.id)
            }}
          >
            {t(entry.key)}
          </Pill>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className={css.emptyNote}>
          {workspace.sources.length === 0 ? t('sourcesEmptyNote') : t('filterEmptyNote')}
        </p>
      ) : (
        visible.map((item) => <SourceRow key={item.key} item={item} t={t} setDraft={setDraft} />)
      )}
    </div>
  )
}
