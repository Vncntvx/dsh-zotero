import { useLibraryPreferences, useLibraryScroll } from '../../library-preferences.tsx'
import preferenceCss from '../../library-settings.module.css'
/**
 * The library panel's item list: one page of the current scope's hits, the
 * scope's live name in the header, and the offset paginator under the rows.
 * Selecting a row hands its ref to the inspector.
 * @module dsh-zotero/client/components/library/LibraryItemList
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseContextMenu } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { Button, IconWorkspaceTreeOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from '../IconButton.tsx'
import { isPdfContentType } from '../../../media-types.ts'
import { pageRangeOf, type LibraryListState, type LibrarySelection } from './library-model.ts'
import { LibraryPager } from './LibraryPager.tsx'
import css from './library.module.css'

interface LibraryItemListProps {
  readonly scrollKey?: string
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
  readonly useContextMenu?: UseContextMenu
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
  scrollKey = 'list',
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
  useContextMenu,
}: LibraryItemListProps) {
  const scroll = useLibraryScroll(scrollKey, list.phase === 'ready')
  const { preferences } = useLibraryPreferences()
  const range = list.phase === 'ready' ? pageRangeOf(list, list.items.length) : undefined
  const contextMenu = typeof useContextMenu === 'function' ? useContextMenu() : undefined

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
            <IconButton
              shape="square"
              icon={<IconWorkspaceTreeOutlineMedium className={css.actionIcon} />}
              aria-label={t('libraryLocate')}
              title={t('libraryLocate')}
              onClick={locate}
            />
          )}
        </div>
      </header>

      {locate !== undefined && locateError !== undefined && (
        <p role="alert" className={clsx(css.treeError, css.listLocateError)}>
          {locateError}
        </p>
      )}

      <div className={css.listScrollArea} {...scroll}>
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
              const triggerProps = contextMenu?.getTriggerProps({
                kind: 'zoteroItem',
                value: {
                  ref: item.ref,
                  title: item.title,
                  itemType: item.itemType,
                },
              })
              return (
                <li key={item.ref}>
                  <Button
                    size={preferences?.listDensity === 'compact' ? 'sm' : 'md'}
                    variant={isSelected ? 'outline' : 'ghost'}
                    {...triggerProps}
                    className={clsx(css.itemRow, hasPdf && css.itemRowHasPdf)}
                    onClick={() => selectItem(isSelected ? undefined : item.ref)}
                  >
                    <span
                      data-library-title
                      className={clsx(
                        preferenceCss.rowTitle,
                        preferences?.titleLines === 1
                          ? preferenceCss.oneLine
                          : preferenceCss.twoLines,
                      )}
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    <span className={css.itemMeta}>
                      {item.year !== undefined && <span>{item.year}</span>}
                      <span className={css.itemType}>{item.itemType}</span>
                      {item.creatorSummary !== '' && (
                        <span className={css.itemCreator}>{item.creatorSummary}</span>
                      )}
                    </span>
                    {/* A detection badge, not an absence claim: the search
                     * index's best-attachment pick names a PDF when one is
                     * indexed; rows without it may still carry files. */}
                    {hasPdf && <span className={css.pdfBadge}>{t('badgePdf')}</span>}
                  </Button>
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
