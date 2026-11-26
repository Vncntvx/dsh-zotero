/** Resizable, server-paged tag filter below the collection tree. */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconCheckOutlineRegular,
  IconSearchOutlineMedium,
  Input,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import type { LibraryFeedFace } from './library-feed-types.ts'
import { LIBRARY_PAGE_SIZE, type LibraryFilters as Filters } from './library-model.ts'
import { messageOf } from '../../error-text.ts'
import css from './library.module.css'

const TAG_SEARCH_DEBOUNCE_MS = 200
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 112
const RESIZE_STEP = 16

interface TagPickerProps {
  readonly t: TranslateNS<'zotero'>
  readonly face: LibraryFeedFace
  readonly library: SupportedLocalLibrary
  readonly value: Filters
  readonly change: (filters: Filters) => void
  readonly enabled: boolean
  /** Changes when tags may have changed; the pane reloads its vocabulary. */
  readonly tagsRefresh: number
}

export function LibraryTagPicker(props: TagPickerProps): ReactNode {
  const { t, library } = props
  const id = useId()
  const divider = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number; height: number }>()
  const [preferredHeight, setPreferredHeight] = useState(DEFAULT_HEIGHT)
  const [maxHeight, setMaxHeight] = useState<number>()
  const minHeight = Math.min(MIN_HEIGHT, maxHeight ?? MIN_HEIGHT)
  const clamp = (height: number) => Math.min(maxHeight ?? Infinity, Math.max(minHeight, height))
  const height = clamp(preferredHeight)

  useEffect(() => {
    const pane = divider.current?.parentElement
    if (pane == null) return
    const measure = () => {
      if (pane.clientHeight > 0) setMaxHeight(Math.floor(pane.clientHeight * 0.6))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div
        ref={divider}
        className={css.tagDivider}
        role="separator"
        aria-label={t('libraryTagResize')}
        aria-orientation="horizontal"
        aria-controls={id}
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current !== undefined) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointerId: event.pointerId, y: event.clientY, height }
        }}
        onPointerMove={(event) => {
          const origin = drag.current
          if (origin?.pointerId !== event.pointerId) return
          setPreferredHeight(clamp(origin.height + origin.y - event.clientY))
        }}
        onLostPointerCapture={() => {
          drag.current = undefined
        }}
        onKeyDown={(event) => {
          let next: number | undefined
          if (event.key === 'ArrowUp') next = height + RESIZE_STEP
          else if (event.key === 'ArrowDown') next = height - RESIZE_STEP
          else if (event.key === 'Home') next = minHeight
          else if (event.key === 'End') next = maxHeight
          if (next === undefined) return
          event.preventDefault()
          setPreferredHeight(clamp(next))
        }}
      />
      <section
        id={id}
        className={css.collectionTags}
        style={{ height }}
        aria-label={t('libraryFilterTags')}
      >
        <TagOptions key={`${library.type}:${library.id}`} {...props} />
      </section>
    </>
  )
}

function TagOptions({ t, face, library, value, change, enabled, tagsRefresh }: TagPickerProps) {
  const { type, id } = library
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<readonly string[]>([])
  const [nextOffset, setNextOffset] = useState<number>()
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const requestAbort = useRef<AbortController>()
  const optionsRef = useRef<HTMLUListElement>(null)
  const [activeTag, setActiveTag] = useState<string>()
  const typeAhead = useRef({ text: '', at: 0 })
  const selected = useMemo(() => new Set(value.tags ?? []), [value.tags])
  // Selected tags outside the current page stay visible for removal. Tags on
  // the page keep server order so selection does not move keyboard options.
  const optionsRows = useMemo(
    () => [...[...selected].filter((tag) => !rows.includes(tag)), ...rows],
    [rows, selected],
  )
  const search = query.trim()

  const requestPage = useCallback(
    async (text: string, offset: number): Promise<void> => {
      const controller = new AbortController()
      requestAbort.current?.abort()
      requestAbort.current = controller
      setLoading(true)
      setError(undefined)
      try {
        const result = await face.browse(
          {
            kind: 'tags',
            // `type` and `id` are separate dependencies; rebuilding the library
            // here avoids re-querying when an equivalent object arrives.
            library: type === 'user' ? { type, id: 0 } : { type, id },
            offset,
            limit: LIBRARY_PAGE_SIZE,
            ...(text !== '' ? { q: text, match: 'contains' } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        const tags = result.value.items.flatMap((row) => (row.kind === 'tag' ? [row.tag] : []))
        setRows((previous) => (offset > 0 ? [...previous, ...tags] : tags))
        setNextOffset(result.value.nextOffset)
      } catch (error) {
        if (!controller.signal.aborted) setError(messageOf(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [face, type, id],
  )

  useEffect(() => {
    if (!enabled) return
    setRows([])
    setNextOffset(undefined)
    setError(undefined)
    setLoading(true)
    const timer =
      search === ''
        ? undefined
        : setTimeout(() => void requestPage(search, 0), TAG_SEARCH_DEBOUNCE_MS)
    if (timer === undefined) void requestPage('', 0)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      requestAbort.current?.abort()
    }
  }, [enabled, search, requestPage, tagsRefresh, retry])

  const latest = useRef({ selected, value, change })
  latest.current = { selected, value, change }
  const toggleTag = useCallback((tag: string): void => {
    const current = latest.current
    const next = new Set(current.selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    current.change({ ...current.value, tags: Array.from(next) })
  }, [])

  const activeOption = optionsRows.includes(activeTag ?? '')
    ? activeTag
    : (optionsRows.find((tag) => selected.has(tag)) ?? optionsRows[0])
  const focusOption = (index: number): void => {
    if (optionsRows.length === 0) return
    const bounded = (index + optionsRows.length) % optionsRows.length
    setActiveTag(optionsRows[bounded])
    optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[bounded]?.focus()
  }
  const onOptionsKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
    const index = optionsRows.indexOf(activeOption ?? '')
    const target = event.target instanceof Element ? event.target.closest('[role="option"]') : null
    if (!target) return
    let next: number | undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = optionsRows.length - 1
    else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (activeOption !== undefined) toggleTag(activeOption)
      return
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const now = performance.now()
      const previous = typeAhead.current
      const character = event.key.toLocaleLowerCase()
      const text =
        now - previous.at > 700 || [...previous.text].every((letter) => letter === character)
          ? character
          : previous.text + character
      typeAhead.current = { text, at: now }
      for (let step = 1; step <= optionsRows.length; step++) {
        const candidate = (index + step) % optionsRows.length
        if (optionsRows[candidate]?.toLocaleLowerCase().startsWith(text)) {
          next = candidate
          break
        }
      }
    }
    if (next !== undefined) {
      event.preventDefault()
      focusOption(next)
    }
  }

  const options = useMemo(
    () =>
      optionsRows.map((tag) => (
        <li key={tag} role="presentation">
          <Button
            size="sm"
            variant={selected.has(tag) ? 'toolbar' : 'ghost'}
            role="option"
            aria-selected={selected.has(tag)}
            tabIndex={tag === activeOption ? 0 : -1}
            onFocus={() => setActiveTag(tag)}
            className={css.collectionTagOption}
            onClick={() => toggleTag(tag)}
          >
            <span className={css.collectionTagLabel} title={tag}>
              {tag}
            </span>
            {selected.has(tag) && (
              <IconCheckOutlineRegular size={14} className={css.tagCheckIcon} />
            )}
          </Button>
        </li>
      )),
    [optionsRows, selected, toggleTag, activeOption],
  )

  return (
    <>
      <div className={css.tagHeader}>
        <span className={css.caption}>{t('libraryFilterTags')}</span>
        {selected.size > 1 && (
          <Pill
            onClick={() => change({ ...value, tagMatch: value.tagMatch === 'any' ? 'all' : 'any' })}
          >
            {value.tagMatch === 'any' ? t('libraryTagAny') : t('libraryTagAll')}
          </Pill>
        )}
      </div>
      <div className={css.tagScroll}>
        <ul
          ref={optionsRef}
          className={css.collectionTagList}
          role="listbox"
          aria-multiselectable="true"
          onKeyDown={onOptionsKeyDown}
          aria-label={t('libraryFilterTags')}
        >
          {options}
        </ul>
        {enabled && (loading || (optionsRows.length === 0 && error === undefined)) && (
          <div className={css.collectionTagStatus} role="status">
            {t(loading ? 'libraryLoading' : 'libraryNoTags')}
          </div>
        )}
        {enabled && !loading && (error !== undefined || nextOffset !== undefined) && (
          <div className={css.tagPageControls}>
            {error !== undefined && (
              <span className={css.collectionTagStatus} role="alert">
                {error}
              </span>
            )}gi
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (nextOffset === undefined) setRetry((count) => count + 1)
                else void requestPage(search, nextOffset)
              }}
            >
              {t(error === undefined ? 'libraryLoadMore' : 'libraryRetry')}
            </Button>
          </div>
        )}
      </div>
      <Input
        type="search"
        className={css.tagSearchInput}
        icon={<IconSearchOutlineMedium size={14} className={css.searchIcon} />}
        placeholder={t('librarySearchTags')}
        aria-label={t('librarySearchTags')}
        disabled={!enabled}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            focusOption(event.key === 'ArrowDown' ? 0 : optionsRows.length - 1)
          }
        }}
      />
    </>
  )
}
