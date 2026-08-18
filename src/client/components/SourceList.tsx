/**
 * The sources list: the filter bar (a subset of the stable union — clearing
 * a filter restores every source) above one expandable row per source.
 * Every filter pill carries its item count and a zero count disables the
 * pill, so an empty result set is never actively reachable; the clear action
 * stays beside the empty note for recovery (and tomorrow's text search).
 * Session switches reset the filter through the parent's `key`, never
 * through an effect racing the render.
 * @module dsh-zotero/client/components/SourceList
 */

import { useMemo, useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../sources/model.ts'
import { filterCountsOf, filterSources, type SourceFilter } from '../sources/selectors.ts'
import { SourceRow } from './SourceRow.tsx'
import css from './SourcesList.module.css'

/** The filter bar's entries: filter id plus its locale key, in bar order. */
const FILTERS: readonly {
  readonly id: SourceFilter
  readonly key:
    | 'filterAll'
    | 'filterPdf'
    | 'filterRetrieved'
    | 'filterEvidence'
    | 'filterExported'
    | 'filterIssues'
}[] = [
  { id: 'all', key: 'filterAll' },
  { id: 'pdf', key: 'filterPdf' },
  { id: 'retrieved', key: 'filterRetrieved' },
  { id: 'evidence', key: 'filterEvidence' },
  { id: 'exported', key: 'filterExported' },
  { id: 'issues', key: 'filterIssues' },
]

export interface SourceListProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** The sources list: filter bar with counts plus the filtered rows. */
export function SourceList({ workspace, t, setDraft }: SourceListProps) {
  const [filter, setFilter] = useState<SourceFilter>('all')
  const counts = useMemo(() => filterCountsOf(workspace.sources), [workspace.sources])
  const visible = filterSources(workspace.sources, filter)
  return (
    <div className={css.wrap}>
      <div className={css.filterBar} role="group">
        {FILTERS.map((entry) => {
          const count = counts[entry.id]
          return (
            <Pill
              key={entry.id}
              active={filter === entry.id}
              aria-pressed={filter === entry.id}
              disabled={count === 0}
              onClick={() => {
                setFilter(entry.id)
              }}
            >
              {`${t(entry.key)} ${count}`}
            </Pill>
          )
        })}
      </div>
      {visible.length === 0 ? (
        workspace.sources.length === 0 ? (
          <p className={css.emptyNote}>{t('sourcesEmptyNote')}</p>
        ) : (
          <div className={css.emptyWrap}>
            <p className={css.emptyNote}>{t('filterEmptyNote')}</p>
            <button
              type="button"
              className={css.filterClear}
              onClick={() => {
                setFilter('all')
              }}
            >
              {t('filterClear')}
            </button>
          </div>
        )
      ) : (
        visible.map((item) => <SourceRow key={item.key} item={item} t={t} setDraft={setDraft} />)
      )}
    </div>
  )
}
