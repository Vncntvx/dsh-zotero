/**
 * The one rendering of a listing's recovery row and pager: a loading note or
 * an error with its retry action, then the numeric pager when the listing has
 * pages. The lane controls and the inspector's child sections both render
 * this; only their containers differ.
 * @module dsh-zotero/client/components/library/ListingPager
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { LibraryPager } from './LibraryPager.tsx'
import css from './library.module.css'

/** The listing's in-flight or failed state; `undefined` renders neither row. */
export type ListingStatus = { phase: 'loading' } | { phase: 'error'; message: string }

/** The pager window one served page reports. */
export interface ListingPage {
  readonly label: string
  readonly offset: number
  readonly limit: number
  readonly total: number
  readonly returned: number
  readonly nextOffset: number | undefined
}

export function ListingPager({
  t,
  status,
  retry,
  retryAriaLabel,
  errorVariant = 'inline',
  pager,
  onPage,
  pagerClassName,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly status: ListingStatus | undefined
  readonly retry: () => void
  /** The retry action's accessible name; the lane spells `label: retry`. */
  readonly retryAriaLabel?: string
  /** `lane` wraps the error in the lane's alert block; `inline` is a bare line. */
  readonly errorVariant?: 'lane' | 'inline'
  /** The served page; `undefined` renders no pager. */
  readonly pager: ListingPage | undefined
  readonly onPage: (offset: number) => void
  /** The lane wraps its pager in its own spacing block. */
  readonly pagerClassName?: string
}): ReactNode {
  const paging = pager !== undefined && (pager.offset > 0 || pager.nextOffset !== undefined)
  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      aria-label={retryAriaLabel ?? t('libraryRetry')}
      onClick={retry}
    >
      {t('libraryRetry')}
    </Button>
  )
  return (
    <>
      {status?.phase === 'loading' && (
        <span role="status" className={css.treeNote}>
          {t('libraryLoading')}
        </span>
      )}
      {status?.phase === 'error' &&
        (errorVariant === 'lane' ? (
          <div role="alert" className={css.laneError}>
            <p className={css.treeError}>{status.message}</p>
            {retryButton}
          </div>
        ) : (
          <>
            <p role="alert" className={css.treeError}>
              {status.message}
            </p>
            {retryButton}
          </>
        ))}
      {paging && pager !== undefined && (
        <div className={pagerClassName}>
          <LibraryPager
            t={t}
            label={pager.label}
            offset={pager.offset}
            limit={pager.limit}
            total={pager.total}
            returned={pager.returned}
            nextOffset={pager.nextOffset}
            busy={status?.phase === 'loading'}
            onPage={onPage}
          />
        </div>
      )}
    </>
  )
}
