/**
 * The one rendering of a listing's recovery row: a loading note or an error
 * with its retry action, plus the numeric pager when the listing carries one.
 * The lane controls render the recovery row alone; the inspector's child
 * listings render it with their pager.
 * @module dsh-zotero/client/components/library/ListingPager
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListingStatus } from './library-feed-types.ts'
import { LibraryPager } from './LibraryPager.tsx'
import css from './library.module.css'

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
}: {
  readonly t: TranslateNS<'zotero'>
  readonly status: ListingStatus | undefined
  readonly retry: () => void
  /** The retry action's accessible name; the lane spells `label: retry`. */
  readonly retryAriaLabel?: string
  /** `lane` wraps the error in the lane's alert block; `inline` is a bare line. */
  readonly errorVariant?: 'lane' | 'inline'
  /** The served page and its paging action; omitted when the listing cannot page. */
  readonly pager?: { readonly page: ListingPage; readonly onPage: (offset: number) => void }
}): ReactNode {
  const page = pager?.page
  const paging = page !== undefined && (page.offset > 0 || page.nextOffset !== undefined)
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
        <span role="status" className={clsx(css.caption, css.treeNote)}>
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
      {paging && pager !== undefined && page !== undefined && (
        <LibraryPager
          t={t}
          label={page.label}
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          returned={page.returned}
          nextOffset={page.nextOffset}
          busy={status?.phase === 'loading'}
          onPage={pager.onPage}
        />
      )}
    </>
  )
}
