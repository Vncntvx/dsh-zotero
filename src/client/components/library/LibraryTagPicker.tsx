/**
 * The tag filter: an anchored portal panel that searches tags server-side
 * (`browse({ kind: 'tags', q })`) instead of enumerating the library, so a
 * large tag vocabulary costs one request per search rather than one request
 * per page of a full walk. It renders via portal into document.body to avoid
 * being clipped by the filter rail's horizontal overflow, and dismisses on
 * outside pointerdown or Escape.
 * @module dsh-zotero/client/components/library/LibraryTagPicker
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconCheckOutlineRegular,
  IconChevronDownOutlineMedium,
  IconSearchOutlineMedium,
  Input,
  Pill,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import type { LibraryFeedFace } from './library-feed-types.ts'
import { LIBRARY_PAGE_SIZE, sameLibrary, type LibraryFilters as Filters } from './library-model.ts'
import { messageOf } from '../../error-text.ts'
import css from './library.module.css'

const TAG_SEARCH_DEBOUNCE_MS = 200
/** Space between the trigger and its panel, and between the panel and the viewport. */
const PANEL_GAP = 4
const VIEWPORT_MARGIN = 8

export function LibraryTagPicker({
  t,
  face,
  library,
  value,
  change,
  enabled,
  onError,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly face: LibraryFeedFace
  readonly library: SupportedLocalLibrary
  readonly value: Filters
  readonly change: (filters: Filters) => void
  readonly enabled: boolean
  readonly onError: (message: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<readonly string[]>([])
  const [nextOffset, setNextOffset] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const selected = useMemo(() => new Set(value.tags ?? []), [value.tags])
  const seq = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** The library the current rows were loaded for; a switch invalidates them. */
  const rowsLibrary = useRef<SupportedLocalLibrary>()
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const requestPage = (search: string, offset: number, append: boolean): void => {
    const ticket = seq.current + 1
    seq.current = ticket
    setLoading(true)
    void face
      .browse({
        kind: 'tags',
        library,
        offset,
        limit: LIBRARY_PAGE_SIZE,
        ...(search !== '' ? { q: search, match: 'contains' } : {}),
      })
      .then((result) => {
        if (seq.current !== ticket) return
        setLoading(false)
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        rowsLibrary.current = library
        const tags = result.value.items.flatMap((row) => (row.kind === 'tag' ? [row.tag] : []))
        setRows((previous) => (append ? [...previous, ...tags] : tags))
        setNextOffset(result.value.nextOffset)
      })
      .catch((error: unknown) => {
        if (seq.current !== ticket) return
        setLoading(false)
        onError(messageOf(error))
      })
  }

  // A library switch invalidates the loaded page: the next open re-queries.
  useEffect(() => {
    rowsLibrary.current = undefined
    setRows([])
    setNextOffset(undefined)
    setQuery('')
    setLoading(false)
    return () => {
      seq.current += 1
      if (debounce.current !== undefined) clearTimeout(debounce.current)
    }
  }, [library.type, library.id])

  // The shared anchored-position hook measures the panel itself (no width
  // constant of ours), clamps it to both viewport edges, and re-places it on
  // resize, any scroll, and its own size changes.
  const position = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: PANEL_GAP,
    margin: VIEWPORT_MARGIN,
  })
  // The panel is portaled, so it must be named as an inside target explicitly.
  useDismissOnOutsidePointer(triggerRef, open, setOpen, panelRef)

  // Escape is ours: the shared dismiss hook only watches pointerdown.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const active = document.activeElement
      const inside =
        active instanceof Node &&
        (panelRef.current?.contains(active) === true ||
          triggerRef.current?.contains(active) === true)
      setOpen(false)
      if (inside) triggerRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const toggleOpen = (): void => {
    const next = !open
    if (!next && debounce.current !== undefined) {
      // A search typed a moment before closing must not fire after it.
      clearTimeout(debounce.current)
      debounce.current = undefined
    }
    setOpen(next)
    if (
      next &&
      enabled &&
      (rows.length === 0 ||
        rowsLibrary.current === undefined ||
        !sameLibrary(rowsLibrary.current, library))
    ) {
      requestPage('', 0, false)
    }
  }

  const search = (text: string): void => {
    setQuery(text)
    if (debounce.current !== undefined) clearTimeout(debounce.current)
    if (!enabled) return
    debounce.current = setTimeout(() => requestPage(text.trim(), 0, false), TAG_SEARCH_DEBOUNCE_MS)
  }

  // The panel re-renders whenever the anchored hook re-measures; the rows are
  // memoized against a stable toggle so a scroll never rebuilds every option.
  const latest = useRef({ selected, value, change })
  latest.current = { selected, value, change }
  const toggleTag = useCallback((tag: string): void => {
    const current = latest.current
    const next = new Set(current.selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    current.change({ ...current.value, tags: Array.from(next) })
  }, [])

  const options = useMemo(
    () =>
      rows.map((tag) => (
        <li key={tag}>
          <button
            type="button"
            role="option"
            aria-selected={selected.has(tag)}
            className={clsx(css.tagOption, selected.has(tag) && css.tagOptionSelected)}
            onClick={() => toggleTag(tag)}
          >
            <span className={css.tagOptionLabel}>{tag}</span>
            {selected.has(tag) && (
              <IconCheckOutlineRegular size={14} className={css.tagCheckIcon} />
            )}
          </button>
        </li>
      )),
    [rows, selected, toggleTag],
  )

  return (
    <div className={css.tagPickerWrap} ref={triggerRef}>
      <Pill
        active={selected.size > 0}
        onClick={toggleOpen}
        aria-label={t('libraryFilterTags')}
        aria-expanded={open}
      >
        <span>{t('libraryFilterTags')}</span>
        {selected.size > 0 && <span>({selected.size})</span>}
        <IconChevronDownOutlineMedium className={css.chevronIcon} />
      </Pill>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={css.tagPanel}
            role="group"
            aria-label={t('libraryFilterTags')}
            style={{
              position: 'fixed',
              zIndex: 1100,
              // The first measure runs after mount; until then the panel is
              // placed but invisible, so it can read its own size.
              ...(position ?? { visibility: 'hidden' }),
            }}
          >
            <Input
              type="search"
              className={css.tagSearchInput}
              icon={<IconSearchOutlineMedium size={14} className={css.searchIcon} />}
              placeholder={t('librarySearchTags')}
              aria-label={t('librarySearchTags')}
              value={query}
              onChange={(event) => search(event.target.value)}
              autoFocus
            />
            <ul className={css.tagOptions}>
              {options}
              {rows.length === 0 && !loading && (
                <li className={css.tagPanelNote}>{t('libraryEmptyList')}</li>
              )}
            </ul>
            <div className={css.tagPanelFoot}>
              {loading && <span className={css.tagPanelNote}>{t('libraryLoading')}</span>}
              {!loading && nextOffset !== undefined && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestPage(query.trim(), nextOffset, true)}
                >
                  {t('libraryLoadMore')}
                </Button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
