/**
 * The library panel's item list: one page of the current scope's hits, the
 * scope's live name in the header, and the offset paginator under the rows.
 * Selecting a row hands its ref to the inspector.
 * @module dsh-zotero/client/components/library/LibraryItemList
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconWorkspaceTreeOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { isPdfContentType } from '../../../media-types.ts'
import { pageRangeOf, type LibraryListState, type LibrarySelection } from './library-model.ts'
import { LibraryPager } from './LibraryPager.tsx'
import css from './library.module.css'

interface LibraryItemListProps {
  readonly returnToLibrary?: () => void
  readonly filtered?: boolean
  /** Reveals the current scope's row in the collection tree; absent for fixed scopes. */
  readonly locate?: () => void
  readonly locateError?: string
  readonly t: TranslateNS<'zotero'>
  readonly list: LibraryListState
  readonly selection: LibrarySelection
  readonly offset: number
  readonly gotoOffset: (offset: number) => void
  readonly selectedRef: string | undefined
  readonly selectItem: (ref: string | undefined) => void
  readonly retry: () => void
}

/** The header a selection shows; collection/search rows carry their own name. */
function selectionLabelOf(selection: LibrarySelection, t: TranslateNS<'zotero'>): string {
  switch (selection.kind) {
    case 'library':
      return t('libraryAllItems')
    case 'publications':
      return t('libraryPublications')
    case 'trash':
      return t('libraryTrash')
    case 'collection':
      return selection.path?.join(' / ') || selection.name
    case 'savedSearch':
      return selection.name
  }
}

export function LibraryItemList({
  t,
  filtered,
  returnToLibrary,
  locate,
  locateError,
  list,
  selection,
  offset,
  gotoOffset,
  selectedRef,
  selectItem,
  retry,
}: LibraryItemListProps) {
  const range = list.phase === 'ready' ? pageRangeOf(list, list.items.length) : undefined

  return (
    <section
      className={css.list}
      aria-busy={list.phase === 'loading'}
      aria-label={t('libraryItemList')}
    >
      <header className={css.listHeader}>
        <h2 className={css.listTitle}>{selectionLabelOf(selection, t)}</h2>
        <div className={css.listHeaderMeta}>
          {list.phase === 'ready' && range !== undefined && (
            <span className={css.listCount}>
              {t('libraryRangeOfTotal', { start: range.start, end: range.end, total: range.total })}
            </span>
          )}
          {locate !== undefined && (
            <button
              type="button"
              className={clsx(css.toolButton, css.listLocate)}
              aria-label={t('libraryLocate')}
              title={t('libraryLocate')}
              onClick={locate}
            >
              <IconWorkspaceTreeOutlineMedium className={css.actionIcon} />
            </button>
          )}
        </div>
      </header>

      {locate !== undefined && locateError !== undefined && (
        <p role="alert" className={clsx(css.treeError, css.listLocateError)}>
          {locateError}
        </p>
      )}

      <div className={css.listScrollArea}>
        {list.phase === 'loading' && (
          <p className={css.listNote} role="status">
            {t('libraryLoading')}
          </p>
        )}

        {list.phase === 'error' && (
          <div role="alert" className={css.listErrorWrap}>
            <p className={css.listError}>{list.message}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              {t('libraryRetry')}
            </Button>
            {'ref' in selection && returnToLibrary && (
              <Button variant="outline" size="sm" onClick={returnToLibrary}>
                {t('libraryAllItems')}
              </Button>
            )}
          </div>
        )}

        {list.phase === 'ready' && list.items.length === 0 && (
          <p className={css.listNote}>{t(filtered ? 'libraryNoMatches' : 'libraryEmptyList')}</p>
        )}

        {list.phase === 'ready' && list.items.length > 0 && (
          <ul className={css.listRows}>
            {list.items.map((item) => {
              const isSelected = selectedRef === item.ref
              const hasPdf = isPdfContentType(item.bestAttachmentType)
              return (
                <li key={item.ref}>
                  <button
                    type="button"
                    className={clsx(
                      css.itemRow,
                      isSelected && css.itemRowActive,
                      hasPdf && css.itemRowHasPdf,
                    )}
                    onClick={() => selectItem(isSelected ? undefined : item.ref)}
                  >
                    <span className={css.itemTitle}>
                      {item.title}
                      {item.year !== undefined && (
                        <span className={css.itemYear}> ({item.year})</span>
                      )}
                    </span>
                    <span className={css.itemMeta}>
                      <span className={css.itemType}>{item.itemType}</span>
                      {item.creatorSummary !== '' && (
                        <span className={css.itemCreator}>{item.creatorSummary}</span>
                      )}
                    </span>
                    {/* A detection badge, not an absence claim: the search
                     * index's best-attachment pick names a PDF when one is
                     * indexed; rows without it may still carry files. */}
                    {hasPdf && <span className={css.pdfBadge}>PDF</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {list.phase === 'ready' && (list.items.length > 0 || offset > 0) && (
        <footer>
          <LibraryPager
            t={t}
            label={t('libraryItemList')}
            offset={offset}
            limit={list.limit}
            total={list.total}
            returned={list.items.length}
            nextOffset={list.nextOffset}
            onPage={gotoOffset}
            // The header count already carries the range line.
            showRange={false}
          />
        </footer>
      )}
    </section>
  )
}
