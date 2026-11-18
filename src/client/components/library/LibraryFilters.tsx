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
  Input,
  Menu,
  Pill,
  Tag,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import { ZOTERO_YEAR_MAX, ZOTERO_YEAR_MIN } from '../../../constants.ts'
import type { LibraryFeedFace } from './library-feed-types.ts'
import type { LibraryFilters as Filters } from './library-model.ts'
import { LibraryTagPicker } from './LibraryTagPicker.tsx'
import { itemTypeLabelOf } from './item-type-labels.ts'
import type { ItemTypeVocabulary } from './use-item-type-labels.ts'
import { IconButton } from '../IconButton.tsx'
import css from './library.module.css'

const YEAR_COMMIT_DEBOUNCE_MS = 300

export function LibraryFilters({
  t,
  face,
  library,
  value,
  change,
  itemTypes,
  enabled = true,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly face: LibraryFeedFace
  readonly library: SupportedLocalLibrary
  readonly value: Filters
  readonly change: (filters: Filters) => void
  /** The panel-level item-type read: its rows feed the menu, its errors the retry line. */
  readonly itemTypes: ItemTypeVocabulary
  readonly enabled?: boolean
}): ReactNode {
  // Only the tag picker's own failure lives here; the item-type listing's
  // failure belongs to the vocabulary that every pane reads.
  const [pickerError, setPickerError] = useState<string>()

  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)

  // Year draft: the inputs own the text, the filter value only moves on
  // commit (debounce, blur, or Enter).
  const [yearOpen, setYearOpen] = useState(false)
  const [yearDraft, setYearDraft] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [yearInvalid, setYearInvalid] = useState<'number' | 'range'>()
  const yearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Item types are a static schema listing the panel reads once for every
  // surface that names one; this rail only renders it.
  const types = useMemo(
    () =>
      itemTypes.rows.map((row) => ({
        value: row.itemType,
        label: itemTypeLabelOf(row.itemType, itemTypes.localized, t),
      })),
    [itemTypes.rows, itemTypes.localized, t],
  )

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

  const toggleTagMatch = () => {
    change({ ...value, tagMatch: value.tagMatch === 'any' ? 'all' : 'any' })
  }

  /** Commit the draft: refuse a crossed range locally, never send it. */
  const commitYear = (from: string, to: string): void => {
    if (yearTimer.current !== undefined) clearTimeout(yearTimer.current)
    const fromValue = from === '' ? undefined : /^\d+$/u.test(from) ? Number(from) : NaN
    const toValue = to === '' ? undefined : /^\d+$/u.test(to) ? Number(to) : NaN
    if (
      [fromValue, toValue].some(
        (year) =>
          year !== undefined &&
          (!Number.isInteger(year) || year < ZOTERO_YEAR_MIN || year > ZOTERO_YEAR_MAX),
      )
    ) {
      setYearInvalid('number')
      return
    }
    if (fromValue !== undefined && toValue !== undefined && fromValue > toValue) {
      setYearInvalid('range')
      return
    }
    setYearInvalid(undefined)
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
    setYearInvalid(undefined)
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
    setYearInvalid(undefined)
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
            <IconButton
              size="sm"
              shape="square"
              aria-label={t('libraryFilterRemove', { label })}
              icon={<IconCloseOutlineRegular size={11} />}
              onClick={() => {
                const next = new Set(selectedTypes)
                next.delete(typeVal)
                change({ ...value, itemTypes: Array.from(next) })
              }}
            />
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
        onError={setPickerError}
      />

      {/* Selected Tag Chips */}
      {Array.from(selectedTags).map((tag) => (
        <Tag key={tag} tone="neutral" className={css.filterTagWrap}>
          <span>{tag}</span>
          <IconButton
            size="sm"
            shape="square"
            aria-label={t('libraryTagRemove', { tag })}
            icon={<IconCloseOutlineRegular size={11} />}
            onClick={() => {
              const next = new Set(selectedTags)
              next.delete(tag)
              change({ ...value, tags: Array.from(next) })
            }}
          />
        </Tag>
      ))}

      {/* Tag Match mode switcher (if >= 2 tags) */}
      {selectedTags.size > 1 && (
        <Pill onClick={toggleTagMatch}>
          {value.tagMatch === 'any' ? t('libraryTagAny') : t('libraryTagAll')}
        </Pill>
      )}

      {/* Attachment Filter: the three options use the same menu pattern as the
       * other pickers. */}
      <Menu
        open={attachmentOpen}
        anchor={
          <Pill
            active={value.hasAttachment !== undefined}
            onClick={() => setAttachmentOpen(!attachmentOpen)}
            aria-label={t('libraryAttachmentFilter')}
          >
            <span>
              {value.hasAttachment === undefined
                ? t('libraryAttachmentFilter')
                : value.hasAttachment
                  ? t('libraryHasAttachment')
                  : t('libraryNoAttachment')}
            </span>
            <IconChevronDownOutlineMedium className={css.chevronIcon} />
          </Pill>
        }
        items={[
          { id: 'all', label: t('libraryAttachmentFilter') },
          { id: 'with', label: t('libraryHasAttachment') },
          { id: 'without', label: t('libraryNoAttachment') },
        ]}
        selectedIds={[
          value.hasAttachment === undefined ? 'all' : value.hasAttachment ? 'with' : 'without',
        ]}
        onSelect={(id) => {
          change({
            ...value,
            hasAttachment: id === 'with' ? true : id === 'without' ? false : undefined,
          })
          setAttachmentOpen(false)
        }}
        onClose={() => setAttachmentOpen(false)}
        portal
        align="start"
      />

      {/* Year Range Pill / Inputs: the pill discloses the input row. */}
      <Pill
        active={yearOpen || value.yearFrom !== undefined || value.yearTo !== undefined}
        onClick={openYear}
        aria-label={t('libraryYearLabel')}
      >
        <span>{t('libraryYearLabel')}</span>
        {(value.yearFrom !== undefined || value.yearTo !== undefined) && (
          <span>
            {value.yearFrom ?? ''}-{value.yearTo ?? ''}
          </span>
        )}
        <IconChevronDownOutlineMedium className={css.chevronIcon} />
      </Pill>

      {yearOpen && (
        <div className={css.filterYearRow}>
          <Input
            type="number"
            className={css.filterNumberSeat}
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
          <Input
            type="number"
            className={css.filterNumberSeat}
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
              {t(yearInvalid === 'number' ? 'libraryYearNumberInvalid' : 'libraryYearRangeInvalid')}
            </span>
          )}
        </div>
      )}

      {/* Clear All Filters Button */}
      {hasFilters && (
        <Button variant="outline" size="sm" className={css.filterClear} onClick={clearAll}>
          {t('libraryClearFilters')}
        </Button>
      )}

      {/* One recovery line: the item-type walk retries itself; the tag picker
       * re-queries whenever it is opened again, so its message is only dismissed. */}
      {(itemTypes.error ?? pickerError) !== undefined && (
        <div className={css.filterError} role="alert">
          <span>{itemTypes.error ?? pickerError}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={
              itemTypes.error !== undefined ? itemTypes.retry : () => setPickerError(undefined)
            }
          >
            {itemTypes.error !== undefined ? t('libraryRetry') : t('libraryDismissError')}
          </Button>
        </div>
      )}
    </div>
  )
}
