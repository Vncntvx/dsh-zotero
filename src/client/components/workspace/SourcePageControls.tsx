/**
 * The control that appends the next page of a bounded literature-trail list.
 * @module dsh-zotero/client/components/workspace/SourcePageControls
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourcePager } from './useSourcePage.ts'
import css from './workspace.module.css'

interface SourcePageControlsProps {
  readonly pager: SourcePager
  /** The accessible name of the group the control belongs to. */
  readonly label: string
  readonly t: TranslateNS<'zotero'>
}

/** The "show more" control of one bounded list. */
export function SourcePageControls({ pager, label, t }: SourcePageControlsProps) {
  if (!pager.hasMore && pager.error === undefined) return null
  return (
    <div role="group" aria-label={label} className={css.actionRow}>
      {pager.loading && <span role="status">{t('libraryLoading')}</span>}
      {pager.error !== undefined && (
        <>
          <span role="alert">{pager.error}</span>
          <Button variant="outline" size="sm" onClick={pager.retry}>
            {t('sourcePageRetry')}
          </Button>
        </>
      )}
      {pager.hasMore && (
        <Button variant="outline" size="sm" disabled={pager.loading} onClick={pager.loadMore}>
          {t('sourcePageMore')}
        </Button>
      )}
    </div>
  )
}
