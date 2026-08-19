/**
 * The source sidebar: the master list of the workspace surface. The filter
 * bar (a subset of the stable union — clearing restores every source) sits
 * above a listbox of source rows; rows carry no actions, only identification
 * and selection, so the whole row is the option. Zero-count filters are not
 * rendered at all (an entry with nothing to show is noise, not navigation),
 * except the active filter, which stays visible so it can be switched away
 * from. When the pills outgrow the rail, the strip scrolls with its bar
 * hidden and edge arrows page it, so overflow is announced by the arrows,
 * not by scrollbar chrome. The passage-overview entry below the bar (its
 * count is the true passage sum, and it appears once two sources carry
 * passages, so the comparative board is not shown for a single doc) opens
 * the cross-source board, and the omitted-rows caption keeps the
 * bounded-projection limit honest. Selection follows the fixed invariants:
 * first visible row by default, kept across filter switches (a hidden
 * selection stays in the inspector with a note), and session switches reset
 * through the parent's `key`. The keyboard contract is listbox semantics —
 * ArrowUp/ArrowDown move and select, Home/End jump, and the focused row
 * keeps tabIndex 0 (roving tabindex).
 * @module dsh-zotero/client/components/workspace/SourceSidebar
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceItem, SourceWorkspace } from '../../sources/model.ts'
import {
  evidencePassageTotalOf,
  type SourceFilter,
  type SourceFilterCounts,
} from '../../sources/selectors.ts'
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
function shownFiltersOf(filter: SourceFilter, counts: SourceFilterCounts): typeof FILTERS {
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
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [filterEdges, setFilterEdges] = useState({ left: false, right: false })

  // The pill strip follows the harness's composer-rail pattern: the
  // scrollbar stays hidden and overflow is announced by edge arrows paging
  // the strip, recomputed from the scroll geometry on scroll, pill changes,
  // and rail size changes (a ResizeObserver on the bar itself, so sidebar or
  // viewport resizes count, not only window resizes). In jsdom there is no
  // layout, so scrollWidth equals clientWidth and no arrow renders.
  const updateFilterEdges = useCallback(() => {
    const el = filterBarRef.current!
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setFilterEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  useLayoutEffect(() => {
    updateFilterEdges()
  }, [counts, filter, updateFilterEdges])

  useEffect(() => {
    const el = filterBarRef.current!
    el.addEventListener('scroll', updateFilterEdges)
    const observer = new ResizeObserver(updateFilterEdges)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', updateFilterEdges)
      observer.disconnect()
    }
  }, [updateFilterEdges])

  // One strip minus a pill keeps the last pill in view as context; the floor
  // keeps a narrow strip paging a useful distance.
  const pageFilters = (direction: -1 | 1): void => {
    const el = filterBarRef.current!
    el.scrollBy({ left: direction * Math.max(el.clientWidth - 60, 120) })
  }

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
      <div className={css.filterBar} ref={filterBarRef} role="group">
        {filterEdges.left && (
          <button
            type="button"
            className={clsx(css.filterArrow, css.filterArrowLeft)}
            aria-label={t('filterScrollLeft')}
            onClick={() => {
              pageFilters(-1)
            }}
          >
            <IconChevronLeftOutline14 />
          </button>
        )}
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
        {filterEdges.right && (
          <button
            type="button"
            className={clsx(css.filterArrow, css.filterArrowRight)}
            aria-label={t('filterScrollRight')}
            onClick={() => {
              pageFilters(1)
            }}
          >
            <IconChevronRightOutline14 />
          </button>
        )}
      </div>
      {/* The aggregate passage board needs at least two evidence-bearing
          sources to be worth the trip: one source reads better in its own
          detail rows, and the entry shows the true passage sum, not the
          source count. */}
      {counts.evidence >= 2 && (
        <button type="button" className={css.evidenceEntry} onClick={onOpenEvidence}>
          {interpolate(t('evidenceEntryLabel'), {
            count: evidencePassageTotalOf(workspace.sources),
          })}
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
