/** Independent navigation pagination and recovery controls. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { lanePageOf, type LibraryLaneState } from './library-model.ts'
import { ListingPager } from './ListingPager.tsx'
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
  const status =
    lane?.phase === 'loading'
      ? ({ phase: 'loading' } as const)
      : lane?.phase === 'error'
        ? ({ phase: 'error', message: lane.message } as const)
        : undefined
  const pager =
    current === undefined
      ? undefined
      : {
          label,
          offset: current.offset,
          limit: current.limit,
          total: current.total,
          returned: current.rows.length,
          nextOffset: current.nextOffset,
        }
  return (
    <div role="group" aria-label={label} className={css.laneControls}>
      <ListingPager
        t={t}
        status={status}
        retry={retry}
        retryAriaLabel={`${label}: ${t('libraryRetry')}`}
        errorVariant="lane"
        pager={pager}
        onPage={page}
        pagerClassName={css.lanePager}
      />
    </div>
  )
}
