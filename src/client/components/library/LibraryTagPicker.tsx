/**
 * The tag filter: an inline panel that searches tags server-side
 * (`browse({ kind: 'tags', q })`) instead of enumerating the library, so a
 * large tag vocabulary costs one request per search rather than one request
 * per page of a full walk. It is not a `Menu`: the menu primitive intercepts
 * Tab and the arrow keys, which a text input cannot live under.
 * @module dsh-zotero/client/components/library/LibraryTagPicker
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutlineMedium, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import type { LibraryFeedFace } from './useLibraryFeed.ts'
import { LIBRARY_PAGE_SIZE, sameLibrary, type LibraryFilters as Filters } from './library-model.ts'
import { messageOf } from '../../error-text.ts'
import css from './library.module.css'

const TAG_SEARCH_DEBOUNCE_MS = 200

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

  const toggleOpen = (): void => {
    const next = !open
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

  const toggleTag = (tag: string): void => {
    const next = new Set(selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    change({ ...value, tags: Array.from(next) })
  }

  return (
    <>
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

      {open && (
        <div className={css.tagPanel} role="group" aria-label={t('libraryFilterTags')}>
          <input
            type="search"
            className={css.tagSearch}
            placeholder={t('librarySearchTags')}
            aria-label={t('librarySearchTags')}
            value={query}
            onChange={(event) => search(event.target.value)}
          />
          <ul className={css.tagOptions}>
            {rows.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected.has(tag)}
                  className={css.tagOption}
                  onClick={() => toggleTag(tag)}
                >
                  <span>{tag}</span>
                  {selected.has(tag) && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
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
        </div>
      )}
    </>
  )
}
