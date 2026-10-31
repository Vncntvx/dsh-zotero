/** Continuous navigation prefix controls; item and inspector pagers are separate. */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { lanePageOf, type LibraryLaneState } from './library-model.ts'
import { ListingPager } from './ListingPager.tsx'
import type { ListingStatus } from './library-feed-types.ts'
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
  /** Append the next page of this lane; the lane owns where the next page starts. */
  readonly page: () => void
  readonly retry: () => void
}): ReactNode {
  const current = lanePageOf(lane)
  const status: ListingStatus | undefined =
    lane?.phase === 'loading'
      ? { phase: 'loading' }
      : lane?.phase === 'error'
        ? { phase: 'error', message: lane.message }
        : undefined
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={lane?.phase === 'loading'}
      className={css.laneControls}
    >
      {current !== undefined && current.nextOffset !== undefined && (
        <span className={clsx(css.caption, css.laneCount)}>
          {t('libraryLoadedCount', { loaded: current.rows.length, total: current.total })}
        </span>
      )}
      <ListingPager
        t={t}
        status={status}
        retry={retry}
        retryAriaLabel={`${label}: ${t('libraryRetry')}`}
        errorVariant="lane"
      />
      {current?.nextOffset !== undefined && lane?.phase === 'ready' && (
        <div className={css.lanePager}>
          <Button variant="outline" size="sm" onClick={page}>
            {t('libraryLoadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
