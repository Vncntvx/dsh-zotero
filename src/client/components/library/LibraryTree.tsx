/**
 * The library panel's navigation column: the fixed scopes (all items, My
 * Publications, trash), the lazily expanding collection tree, and the saved
 * searches. Rows are buttons; the collection expander is a separate button so
 * keyboard users can walk the tree without selecting.
 * @module dsh-zotero/client/components/library/LibraryTree
 */

import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronRightOutlineMedium,
  IconDeliverDocMedium,
  IconFolderCloseMedium,
  IconFolderOpenMedium,
  IconSearchOutlineMedium,
  IconTrashOutlineMedium,
  IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FlatCollectionRow,
  LibraryLaneState,
  LibrarySelection,
  SavedSearchRowView,
} from './library-model.ts'
import { lanePageOf } from './library-model.ts'
import css from './library.module.css'
import { LibraryLaneControls } from './LibraryLaneControls.tsx'

/** The fixed scope rows, in display order; the label keys live in locales. */
type FixedScopeLabelKey = 'libraryAllItems' | 'libraryPublications' | 'libraryTrash'
const FIXED_SCOPES: readonly {
  selection: LibrarySelection
  labelKey: FixedScopeLabelKey
  icon: (props?: unknown) => ReactNode
}[] = [
  {
    selection: { kind: 'library' },
    labelKey: 'libraryAllItems',
    icon: () => <IconDeliverDocMedium className={css.treeRowIcon} />,
  },
  {
    selection: { kind: 'publications' },
    labelKey: 'libraryPublications',
    icon: () => <IconUserOutlineMedium className={css.treeRowIcon} />,
  },
  {
    selection: { kind: 'trash' },
    labelKey: 'libraryTrash',
    icon: () => <IconTrashOutlineMedium className={css.treeRowIcon} />,
  },
]

interface LibraryTreeProps {
  readonly t: TranslateNS<'zotero'>
  readonly flatTree: readonly FlatCollectionRow[]
  readonly expanded: ReadonlySet<string>
  readonly toggleCollection: (ref: string) => void
  readonly selection: LibrarySelection
  readonly selectScope: (selection: LibrarySelection) => void
  readonly savedSearches: LibraryLaneState<SavedSearchRowView>
  readonly rootLane: LibraryLaneState<FlatCollectionRow['row']> | undefined
  readonly treeLane: (
    ref: string | undefined,
  ) => LibraryLaneState<FlatCollectionRow['row']> | undefined
  readonly pageTree: (ref: string | undefined, offset: number) => void
  readonly retryTree: (ref: string | undefined) => void
  readonly pageSavedSearches: (offset: number) => void
  readonly retrySavedSearches: () => void
}

/** Whether a selection names one of the fixed scopes; those rows carry no ref. */
function sameFixedScope(selection: LibrarySelection, fixed: LibrarySelection): boolean {
  return selection.kind === fixed.kind
}

export function LibraryTree({
  t,
  flatTree,
  expanded,
  toggleCollection,
  selection,
  selectScope,
  savedSearches,
  rootLane,
  treeLane,
  pageTree,
  retryTree,
  pageSavedSearches,
  retrySavedSearches,
}: LibraryTreeProps) {
  const savedPage = lanePageOf(savedSearches)
  const [focused, setFocused] = useState<string>()
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const focus = (ref: string | undefined) => {
    if (ref === undefined) return
    setFocused(ref)
    buttons.current.get(ref)?.focus()
  }
  const focusRef = flatTree.some(({ row }) => row.ref === focused) ? focused : flatTree[0]?.row.ref
  useEffect(() => {
    if (focused !== undefined && focusRef !== focused) setFocused(focusRef)
  }, [focusRef, focused])

  const keyDown = (event: React.KeyboardEvent, index: number) => {
    const entry = flatTree[index]
    if (entry === undefined) return
    const { row, depth } = entry
    switch (event.key) {
      case 'ArrowDown':
        focus(flatTree[index + 1]?.row.ref)
        break
      case 'ArrowUp':
        focus(flatTree[index - 1]?.row.ref)
        break
      case 'Home':
        focus(flatTree[0]?.row.ref)
        break
      case 'End':
        focus(flatTree.at(-1)?.row.ref)
        break
      case 'ArrowRight':
        if (!expanded.has(row.ref)) toggleCollection(row.ref)
        else if (flatTree[index + 1]?.depth === depth + 1) focus(flatTree[index + 1]?.row.ref)
        break
      case 'ArrowLeft':
        if (expanded.has(row.ref)) toggleCollection(row.ref)
        else
          focus(
            flatTree
              .slice(0, index)
              .reverse()
              .find((entry) => entry.depth < depth)?.row.ref,
          )
        break
      case 'Enter':
        selectScope({ kind: 'collection', ref: row.ref, name: row.name })
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <nav className={css.tree} aria-label={t('libraryPanel')}>
      {/* Fixed System Scopes */}
      <ul className={css.treeList}>
        {FIXED_SCOPES.map(({ selection: fixed, labelKey, icon: Icon }) => (
          <li key={fixed.kind}>
            <div
              className={clsx(
                css.treeRowWrap,
                sameFixedScope(selection, fixed) && css.treeRowWrapActive,
              )}
            >
              <span className={css.treeExpanderPlaceholder} />
              <button
                type="button"
                className={clsx(css.treeRow, sameFixedScope(selection, fixed) && css.treeRowActive)}
                aria-current={sameFixedScope(selection, fixed) ? 'page' : undefined}
                onClick={() => selectScope(fixed)}
              >
                <Icon />
                <span className={css.treeRowLabel}>{t(labelKey)}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Collections Section */}
      <div className={css.treeSectionHeader}>
        <p className={css.treeSection}>{t('libraryCollections')}</p>
      </div>
      <LibraryLaneControls
        t={t}
        label={t('libraryCollections')}
        lane={rootLane}
        page={(offset) => pageTree(undefined, offset)}
        retry={() => retryTree(undefined)}
      />
      {rootLane?.phase === 'ready' && flatTree.length === 0 && (
        <p className={css.treeNote}>{t('libraryNoCollections')}</p>
      )}

      <ul
        className={css.treeList}
        role="tree"
        aria-label={t('libraryCollections')}
        onKeyDownCapture={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest('[role=treeitem]') === null &&
            flatTree.length > 0
          ) {
            if (event.key === 'ArrowDown' || event.key === 'Home') {
              focus(flatTree[0]?.row.ref)
              event.preventDefault()
            } else if (event.key === 'End') {
              focus(flatTree.at(-1)?.row.ref)
              event.preventDefault()
            }
          }
        }}
      >
        {flatTree.map(({ row, depth, setSize, posInSet }, index) => {
          const isExpanded = expanded.has(row.ref)
          const isSelected = selection.kind === 'collection' && selection.ref === row.ref

          return (
            <li key={row.ref} role="none">
              <div
                className={clsx(css.treeRowWrap, isSelected && css.treeRowWrapActive)}
                style={{ '--tree-depth': depth } as React.CSSProperties}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={clsx(css.treeExpander, isExpanded && css.treeExpanderOpen)}
                  aria-expanded={isExpanded}
                  aria-label={row.name}
                  onClick={() => toggleCollection(row.ref)}
                >
                  <IconChevronRightOutlineMedium className={css.chevronSvg} />
                </button>
                <button
                  type="button"
                  role="treeitem"
                  ref={(element) => {
                    if (element) buttons.current.set(row.ref, element)
                    else buttons.current.delete(row.ref)
                  }}
                  tabIndex={focusRef === row.ref ? 0 : -1}
                  aria-level={depth + 1}
                  aria-expanded={isExpanded}
                  aria-selected={isSelected}
                  aria-setsize={setSize}
                  aria-posinset={posInSet}
                  onFocus={() => setFocused(row.ref)}
                  onKeyDown={(event) => keyDown(event, index)}
                  className={clsx(css.treeRow, isSelected && css.treeRowActive)}
                  title={row.path.length > 0 ? row.path.join(' / ') : row.name}
                  onClick={() => selectScope({ kind: 'collection', ref: row.ref, name: row.name })}
                >
                  {isExpanded ? (
                    <IconFolderOpenMedium className={css.treeRowIcon} />
                  ) : (
                    <IconFolderCloseMedium className={css.treeRowIcon} />
                  )}
                  <span className={css.treeRowLabel}>{row.name}</span>
                </button>
              </div>
              {isExpanded && (
                <LibraryLaneControls
                  t={t}
                  label={row.name}
                  lane={treeLane(row.ref)}
                  page={(offset) => pageTree(row.ref, offset)}
                  retry={() => retryTree(row.ref)}
                />
              )}
            </li>
          )
        })}
      </ul>

      {/* Saved Searches Section */}
      <div className={css.treeSectionHeader}>
        <p className={css.treeSection}>{t('librarySavedSearches')}</p>
      </div>
      <LibraryLaneControls
        t={t}
        label={t('librarySavedSearches')}
        lane={savedSearches}
        page={pageSavedSearches}
        retry={retrySavedSearches}
      />
      {savedPage?.rows.length === 0 && (
        <p className={css.treeNote}>{t('libraryNoSavedSearches')}</p>
      )}
      <ul className={css.treeList}>
        {savedPage?.rows.map((row) => {
          const isSelected = selection.kind === 'savedSearch' && selection.ref === row.ref
          return (
            <li key={row.ref}>
              <div className={clsx(css.treeRowWrap, isSelected && css.treeRowWrapActive)}>
                <span className={css.treeExpanderPlaceholder} />
                <button
                  type="button"
                  className={clsx(css.treeRow, isSelected && css.treeRowActive)}
                  aria-current={isSelected ? 'page' : undefined}
                  onClick={() => selectScope({ kind: 'savedSearch', ref: row.ref, name: row.name })}
                >
                  <IconSearchOutlineMedium className={css.treeRowIcon} />
                  <span className={css.treeRowLabel}>{row.name}</span>
                </button>
              </div>
              {row.conditions.length > 0 && (
                <details className={css.searchConditions}>
                  <summary>{t('librarySearchConditions')}</summary>
                  <ol>
                    {row.conditions.map((condition, index) => (
                      <li key={index}>
                        {condition.condition} · {condition.operator} · {condition.value}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
