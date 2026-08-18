/**
 * The source sidebar: the master list of the workspace surface. The filter
 * bar (a subset of the stable union — clearing restores every source) sits
 * above a listbox of source rows; rows carry no actions, only identification
 * and selection, so the whole row is the option. Zero-count filters are not
 * rendered at all (an entry with nothing to show is noise, not navigation),
 * except the active filter, which stays visible so it can be switched away
 * from. The quiet passages entry below the bar opens the cross-source board,
 * and the omitted-rows caption keeps the bounded-projection limit honest.
 * Selection follows the fixed invariants: first visible row by default, kept
 * across filter switches (a hidden selection stays in the inspector with a
 * note), and session switches reset through the parent's `key`. The keyboard
 * contract is listbox semantics — ArrowUp/ArrowDown move and select, Home/
 * End jump, and the focused row keeps tabIndex 0 (roving tabindex).
 * @module dsh-zotero/client/components/workspace/SourceSidebar
 */

import { useRef } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceItem, SourceWorkspace } from '../../sources/model.ts'
import type { SourceFilter, SourceFilterCounts } from '../../sources/selectors.ts'
import { FILTERS, type MobilePane, type SelectionState } from './ZoteroWorkspaceView.tsx'
import { SourceListItem } from './SourceListItem.tsx'
import css from './workspace.module.css'

export interface SourceSidebarProps {
  readonly workspace: SourceWorkspace
  readonly filter: SourceFilter
  readonly counts: SourceFilterCounts
  readonly visible: readonly SourceItem[]
  readonly selection: SelectionState
  readonly selectedKey: string | undefined
  readonly setFilter: (filter: SourceFilter) => void
  readonly setSelection: (selection: SelectionState) => void
  readonly setMobilePane: (pane: MobilePane) => void
  readonly onOpenEvidence: () => void
  readonly listRef: React.Ref<HTMLElement>
  readonly t: TranslateNS<'zotero'>
}

/**
 * The filter entries the bar renders: every non-empty filter plus "all",
 * with the active filter kept visible even at zero so it can be left.
 */
export function shownFiltersOf(filter: SourceFilter, counts: SourceFilterCounts): typeof FILTERS {
  return FILTERS.filter(
    (entry) => entry.id === 'all' || entry.id === filter || counts[entry.id] > 0,
  )
}

/** The source sidebar: filter bar, passages entry, and the listbox. */
export function SourceSidebar({
  workspace,
  filter,
  counts,
  visible,
  selection,
  selectedKey,
  setFilter,
  setSelection,
  setMobilePane,
  onOpenEvidence,
  listRef,
  t,
}: SourceSidebarProps) {
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const listRefLocal = listRef

  const focusVisible = (index: number): void => {
    optionRefs.current[index]?.focus()
  }

  // The listbox renders only when at least one row is visible, so the key
  // handler and the mover can rely on a non-empty list.
  const moveSelection = (nextIndex: number): void => {
    const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex))
    setSelection({ key: visible[clamped]!.key, focusIndex: clamped })
    focusVisible(clamped)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const currentIndex = Math.max(0, Math.min(selection.focusIndex, visible.length - 1))
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(currentIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(currentIndex - 1)
        break
      case 'Home':
        event.preventDefault()
        moveSelection(0)
        break
      case 'End':
        event.preventDefault()
        moveSelection(visible.length - 1)
        break
      default:
        break
    }
  }

  return (
    <aside className={css.sidebar} ref={listRefLocal}>
      <div className={css.filterBar} role="group">
        {shownFiltersOf(filter, counts).map((entry) => {
          const count = counts[entry.id]
          return (
            <Pill
              key={entry.id}
              active={filter === entry.id}
              aria-pressed={filter === entry.id}
              onClick={() => {
                setFilter(entry.id)
              }}
            >
              {`${t(entry.key)} ${count}`}
            </Pill>
          )
        })}
      </div>
      {counts.evidence > 0 && (
        <button type="button" className={css.evidenceEntry} onClick={onOpenEvidence}>
          {interpolate(t('evidenceEntryLabel'), { count: counts.evidence })}
        </button>
      )}
      {workspace.omittedRows > 0 && (
        <p className={css.emptyNote}>
          {interpolate(t('omittedRowsNote'), { count: workspace.omittedRows })}
        </p>
      )}
      {visible.length === 0 ? (
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
      ) : (
        <div
          className={css.listbox}
          role="listbox"
          aria-label={t('lensSources')}
          onKeyDown={onKeyDown}
        >
          {visible.map((item, index) => (
            <SourceListItem
              key={item.key}
              item={item}
              index={index}
              selected={item.key === selectedKey}
              focused={index === selection.focusIndex}
              optionRef={(el) => {
                optionRefs.current[index] = el
              }}
              onSelect={() => {
                setSelection({ key: item.key, focusIndex: index })
                setMobilePane('detail')
              }}
              t={t}
            />
          ))}
        </div>
      )}
    </aside>
  )
}
