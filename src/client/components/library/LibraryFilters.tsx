/**
 * The library filter rail: item types (one static listing), the server-side
 * tag picker, attachment presence, and the year range. The year inputs commit
 * through a short debounce so typing `2020` is one search, not four, and a
 * crossed range never reaches the host.
 * @module dsh-zotero/client/components/library/LibraryFilters
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconCloseOutlineRegular,
  IconChevronDownOutlineMedium,
  Menu,
  Pill,
  Tag,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupportedLocalLibrary, ZoteroLibraryBrowseItemView } from '../../../contract.ts'
import { ZOTERO_YEAR_MAX, ZOTERO_YEAR_MIN } from '../../../constants.ts'
import type { LibraryFeedFace } from './useLibraryFeed.ts'
import { LIBRARY_PAGE_SIZE, type LibraryFilters as Filters } from './library-model.ts'
import { LibraryTagPicker } from './LibraryTagPicker.tsx'
import { messageOf } from '../../error-text.ts'
import css from './library.module.css'

const YEAR_COMMIT_DEBOUNCE_MS = 300

export function LibraryFilters({
  t,
  face,
  library,
  value,
  change,
  enabled = true,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly face: LibraryFeedFace
  readonly library: SupportedLocalLibrary
  readonly value: Filters
  readonly change: (filters: Filters) => void
  readonly enabled?: boolean
}): ReactNode {
  const [types, setTypes] = useState<readonly { value: string; label: string }[]>([])
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)

  const [typeMenuOpen, setTypeMenuOpen] = useState(false)

  // Year draft: the inputs own the text, the filter value only moves on
  // commit (debounce, blur, or Enter).
  const [yearOpen, setYearOpen] = useState(false)
  const [yearDraft, setYearDraft] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [yearInvalid, setYearInvalid] = useState(false)
  const yearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Item types are a small static schema listing: one bounded walk on mount.
  useEffect(() => {
    if (!enabled) return
    let active = true
    setError(undefined)
    setTypes([])
    void (async () => {
      const rows: ZoteroLibraryBrowseItemView[] = []
      let offset = 0
      for (;;) {
        const result = await face.browse({ kind: 'itemTypes', offset, limit: LIBRARY_PAGE_SIZE })
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        rows.push(...result.value.items)
        const next = result.value.nextOffset
        if (next === undefined) break
        if (next <= offset) throw new Error(t('libraryInvalidPage'))
        offset = next
      }
      if (active) {
        setTypes(
          rows.flatMap((row) =>
            row.kind === 'itemType'
              ? [{ value: row.itemType, label: row.localized ?? row.itemType }]
              : [],
          ),
        )
      }
    })().catch((cause: unknown) => {
      if (active) setError(messageOf(cause))
    })
    return () => {
      active = false
    }
  }, [face, retry, enabled, t])

  useEffect(
    () => () => {
      if (yearTimer.current !== undefined) clearTimeout(yearTimer.current)
    },
    [],
  )

  const selectedTypes = useMemo(() => new Set(value.itemTypes ?? []), [value.itemTypes])
  const selectedTags = useMemo(() => new Set(value.tags ?? []), [value.tags])

  const typeMenuItems: MenuEntry[] = useMemo(() => {
    return types.map((item) => ({
      id: item.value,
      label: item.label,
    }))
  }, [types])

  const hasFilters = Boolean(
    (value.itemTypes?.length ?? 0) > 0 ||
    (value.tags?.length ?? 0) > 0 ||
    value.hasAttachment !== undefined ||
    value.yearFrom !== undefined ||
    value.yearTo !== undefined,
  )

  const toggleAttachment = () => {
    if (value.hasAttachment === undefined) {
      change({ ...value, hasAttachment: true })
    } else if (value.hasAttachment === true) {
      change({ ...value, hasAttachment: false })
    } else {
      change({ ...value, hasAttachment: undefined })
    }
  }

  const toggleTagMatch = () => {
    change({ ...value, tagMatch: value.tagMatch === 'any' ? 'all' : 'any' })
  }

  /** Commit the draft: refuse a crossed range locally, never send it. */
  const commitYear = (from: string, to: string): void => {
    if (yearTimer.current !== undefined) clearTimeout(yearTimer.current)
    const fromValue = from === '' ? undefined : Number(from)
    const toValue = to === '' ? undefined : Number(to)
    if (fromValue !== undefined && toValue !== undefined && fromValue > toValue) {
      setYearInvalid(true)
      return
    }
    setYearInvalid(false)
    if (value.yearFrom === fromValue && value.yearTo === toValue) return
    change({ ...value, yearFrom: fromValue, yearTo: toValue })
  }

  const editYear = (side: 'from' | 'to', text: string): void => {
    const draft = { ...yearDraft, [side]: text }
    setYearDraft(draft)
    if (yearTimer.current !== undefined) clearTimeout(yearTimer.current)
    yearTimer.current = setTimeout(() => commitYear(draft.from, draft.to), YEAR_COMMIT_DEBOUNCE_MS)
  }

  const openYear = (): void => {
    const next = !yearOpen
    setYearOpen(next)
    setYearInvalid(false)
    if (next) {
      setYearDraft({
        from: value.yearFrom === undefined ? '' : String(value.yearFrom),
        to: value.yearTo === undefined ? '' : String(value.yearTo),
      })
    } else if (yearTimer.current !== undefined) {
      clearTimeout(yearTimer.current)
      commitYear(yearDraft.from, yearDraft.to)
    }
  }

  const clearAll = (): void => {
    if (yearTimer.current !== undefined) clearTimeout(yearTimer.current)
    setYearOpen(false)
    setYearInvalid(false)
    setYearDraft({ from: '', to: '' })
    change({})
  }

  return (
    <div className={css.filterRail} role="toolbar" aria-label={t('libraryFilters')}>
      {/* Item Type Pill */}
      {types.length > 0 && (
        <Menu
          open={typeMenuOpen}
          anchor={
            <Pill
              active={selectedTypes.size > 0}
              onClick={() => setTypeMenuOpen(!typeMenuOpen)}
              aria-label={t('libraryFilterTypes')}
            >
              <span>{t('libraryFilterTypes')}</span>
              {selectedTypes.size > 0 && <span>({selectedTypes.size})</span>}
              <IconChevronDownOutlineMedium className={css.chevronIcon} />
            </Pill>
          }
          items={typeMenuItems}
          selectedIds={Array.from(selectedTypes)}
          onSelect={(id) => {
            const next = new Set(selectedTypes)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            change({ ...value, itemTypes: Array.from(next) })
          }}
          onClose={() => setTypeMenuOpen(false)}
          portal
          align="start"
        />
      )}

      {/* Selected Type Tags */}
      {Array.from(selectedTypes).map((typeVal) => {
        const label = types.find((item) => item.value === typeVal)?.label ?? typeVal
        return (
          <Tag key={typeVal} tone="neutral" className={css.filterTagWrap}>
            <span>{label}</span>
            <button
              type="button"
              className={css.tagRemoveButton}
              aria-label={t('libraryFilterRemove', { label })}
              onClick={() => {
                const next = new Set(selectedTypes)
                next.delete(typeVal)
                change({ ...value, itemTypes: Array.from(next) })
              }}
            >
              <IconCloseOutlineRegular size={11} />
            </button>
          </Tag>
        )
      })}

      {/* Tag Filter: a server-side searched panel */}
      <LibraryTagPicker
        t={t}
        face={face}
        library={library}
        value={value}
        change={change}
        enabled={enabled}
        onError={setError}
      />

      {/* Selected Tag Chips */}
      {Array.from(selectedTags).map((tag) => (
        <Tag key={tag} tone="neutral" className={css.filterTagWrap}>
          <span>{tag}</span>
          <button
            type="button"
            className={css.tagRemoveButton}
            aria-label={t('libraryTagRemove', { tag })}
            onClick={() => {
              const next = new Set(selectedTags)
              next.delete(tag)
              change({ ...value, tags: Array.from(next) })
            }}
          >
            <IconCloseOutlineRegular size={11} />
          </button>
        </Tag>
      ))}

      {/* Tag Match mode switcher (if >= 2 tags) */}
      {selectedTags.size > 1 && (
        <Pill onClick={toggleTagMatch}>
          {value.tagMatch === 'any' ? t('libraryTagAny') : t('libraryTagAll')}
        </Pill>
      )}

      {/* Attachment Filter Pill */}
      <Pill active={value.hasAttachment !== undefined} onClick={toggleAttachment}>
        {value.hasAttachment === undefined
          ? t('libraryAttachmentFilter')
          : value.hasAttachment
            ? t('libraryHasAttachment')
            : t('libraryNoAttachment')}
      </Pill>

      {/* Year Range Pill / Inputs */}
      <Pill
        active={yearOpen || value.yearFrom !== undefined || value.yearTo !== undefined}
        onClick={openYear}
      >
        <span>{t('libraryYearLabel')}</span>
        {(value.yearFrom !== undefined || value.yearTo !== undefined) && (
          <span>
            {value.yearFrom ?? ''}-{value.yearTo ?? ''}
          </span>
        )}
      </Pill>

      {yearOpen && (
        <div className={css.filterYearRow}>
          <input
            type="number"
            className={css.filterNumberInput}
            placeholder={t('libraryYearFromShort')}
            aria-label={t('libraryYearFrom')}
            min={ZOTERO_YEAR_MIN}
            max={ZOTERO_YEAR_MAX}
            value={yearDraft.from}
            onChange={(e) => editYear('from', e.target.value)}
            onBlur={() => commitYear(yearDraft.from, yearDraft.to)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitYear(yearDraft.from, yearDraft.to)
            }}
          />
          <span>–</span>
          <input
            type="number"
            className={css.filterNumberInput}
            placeholder={t('libraryYearToShort')}
            aria-label={t('libraryYearTo')}
            min={ZOTERO_YEAR_MIN}
            max={ZOTERO_YEAR_MAX}
            value={yearDraft.to}
            onChange={(e) => editYear('to', e.target.value)}
            onBlur={() => commitYear(yearDraft.from, yearDraft.to)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitYear(yearDraft.from, yearDraft.to)
            }}
          />
          {yearInvalid && (
            <span className={css.filterYearInvalid} role="alert">
              {t('libraryYearRangeInvalid')}
            </span>
          )}
        </div>
      )}

      {/* Clear All Filters Button */}
      {hasFilters && (
        <button type="button" className={css.filterClear} onClick={clearAll}>
          {t('libraryClearFilters')}
        </button>
      )}

      {/* Error Retry banner */}
      {error !== undefined && (
        <div className={css.filterError} role="alert">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)}>
            {t('libraryRetry')}
          </Button>
        </div>
      )}
    </div>
  )
}
