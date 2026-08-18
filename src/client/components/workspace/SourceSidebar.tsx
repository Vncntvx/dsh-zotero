/**
 * The source sidebar: the master list of the workspace surface. The filter
 * bar (a subset of the stable union — clearing restores every source) sits
 * above a listbox of source rows; rows carry no actions, only identification
 * and selection, so the whole row is the option. Selection follows the fixed
 * invariants: first visible row by default, kept across filter switches
 * (a hidden selection stays in the inspector with a note), and session
 * switches reset through the parent's `key`. The keyboard contract is
 * listbox semantics — ArrowUp/ArrowDown move and select, Home/End jump, and
 * the focused row keeps tabIndex 0 (roving tabindex).
 * @module dsh-zotero/client/components/workspace/SourceSidebar
 */

import { useRef } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceItem, SourceWorkspace } from '../../sources/model.ts'
import type { SourceFilterCounts } from '../../sources/selectors.ts'
import { SourcesHeader } from '../SourcesHeader.tsx'
import { FILTERS, type MobilePane, type SelectionState } from './ZoteroWorkspaceView.tsx'
import { SourceListItem } from './SourceListItem.tsx'
import css from './workspace.module.css'

export interface SourceSidebarProps {
  readonly workspace: SourceWorkspace
  readonly filter: 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues'
  readonly counts: SourceFilterCounts
  readonly visible: readonly SourceItem[]
  readonly selection: SelectionState
  readonly selectedKey: string | undefined
  readonly setFilter: (
    filter: 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues',
  ) => void
  readonly setSelection: (selection: SelectionState) => void
  readonly setMobilePane: (pane: MobilePane) => void
  readonly listRef: React.Ref<HTMLElement>
  readonly t: TranslateNS<'zotero'>
}

/** The source sidebar: filter bar with counts plus the listbox. */
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
  listRef,
  t,
}: SourceSidebarProps) {
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const listRefLocal = listRef

  const focusVisible = (index: number): void => {
    const el = optionRefs.current[index]
    if (el !== undefined) el?.focus()
  }

  const moveSelection = (nextIndex: number): void => {
    if (visible.length === 0) return
    const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex))
    setSelection({ key: visible[clamped]!.key, focusIndex: clamped })
    focusVisible(clamped)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (visible.length === 0) return
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
      <SourcesHeader workspace={workspace} t={t} />
      <div className={css.filterBar} role="group">
        {FILTERS.map((entry) => {
          const count = counts[entry.id]
          return (
            <Pill
              key={entry.id}
              active={filter === entry.id}
              aria-pressed={filter === entry.id}
              disabled={count === 0}
              onClick={() => {
                setFilter(entry.id)
              }}
            >
              {`${t(entry.key)} ${count}`}
            </Pill>
          )
        })}
      </div>
      {visible.length === 0 ? (
        workspace.sources.length === 0 ? (
          <p className={css.emptyNote}>{t('sourcesEmptyNote')}</p>
        ) : (
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
        )
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
