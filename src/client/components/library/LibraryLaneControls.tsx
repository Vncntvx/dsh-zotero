/** Continuous navigation prefix controls; item and inspector pagers are separate. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { lanePageOf, type LibraryLaneState } from './library-model.ts'
import css from './library.module.css'

export function LibraryLaneControls<T>({
  t,
  label,
  lane,
  page,
  retry,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly label: string
  readonly lane: LibraryLaneState<T> | undefined
  readonly page: (offset: number) => void
  readonly retry: () => void
}): ReactNode {
  const current = lanePageOf(lane)
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={lane?.phase === 'loading'}
      className={css.laneControls}
    >
      {current && (
        <span>
          {t('libraryLoadedCount', { loaded: current.rows.length, total: current.total })}
        </span>
      )}
      {lane?.phase === 'loading' && <span role="status">{t('libraryLoading')}</span>}
      {lane?.phase === 'error' && (
        <div role="alert">
          {lane.message}
          <button type="button" aria-label={`${label}: ${t('libraryRetry')}`} onClick={retry}>
            {t('libraryRetry')}
          </button>
        </div>
      )}
      {current?.nextOffset !== undefined && lane?.phase === 'ready' && (
        <button type="button" onClick={() => page(current.nextOffset!)}>
          {t('libraryLoadMore')}
        </button>
      )}
    </div>
  )
}
