/**
 * The library panel's shared pager: prev/next around the localized range
 * line. Every listing in the panel — the item list, each navigation lane, and
 * the inspector's child collections — steps back by the page size the host
 * actually served (`limit`).
 * @module dsh-zotero/client/components/library/LibraryPager
 */

import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { previousPageOffsetOf } from './library-model.ts'
import css from './library.module.css'

export function LibraryPager({
  t,
  label,
  offset,
  limit,
  total,
  returned,
  nextOffset,
  busy = false,
  onPage,
  showRange = true,
}: {
  readonly t: TranslateNS<'zotero'>
  /** The accessible name of the listing this pager pages. */
  readonly label: string
  readonly offset: number
  /** The page size the host served; the previous page steps back by it. */
  readonly limit: number
  readonly total: number
  readonly returned: number
  readonly nextOffset: number | undefined
  readonly busy?: boolean
  readonly onPage: (offset: number) => void
  /**
   * The item list's header already renders the range line, so its footer
   * pager hides the duplicate; listings without a header count show it here.
   */
  readonly showRange?: boolean
}): ReactNode {
  const range =
    returned > 0
      ? { start: offset + 1, end: offset + returned, total }
      : { start: 0, end: 0, total }
  return (
    <div className={css.paginator} role="group" aria-label={label}>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || offset === 0}
        onClick={() => onPage(previousPageOffsetOf(offset, limit))}
      >
        {t('libraryPagePrev')}
      </Button>
      {showRange && (
        <span className={css.pageInfo} aria-live="polite">
          {t('libraryRangeOfTotal', {
            start: range.start,
            end: range.end,
            total: range.total,
          })}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || nextOffset === undefined}
        onClick={() => {
          if (nextOffset !== undefined) onPage(nextOffset)
        }}
      >
        {t('libraryPageNext')}
      </Button>
    </div>
  )
}
