import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconEllipsisOutlineMedium,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconButton } from '../components/IconButton.tsx'
import type { PdfFindStatus, PdfView } from './pdf-runtime.ts'
import css from './reader.module.css'

/** The host's own zoom control draws its minus glyph inline; there is no minus icon. */
const MINUS = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

type Translate = PropsLocale<'zoteroReader'>['t']

export interface ReaderToolbarProps {
  readonly t: Translate
  readonly view: PdfView
  readonly pageInput: string
  readonly onPageInput: (value: string) => void
  readonly onGoTo: (page: number) => void
  readonly outlineOpen: boolean
  readonly onToggleOutline: () => void
  readonly annotations?: { readonly open: boolean; readonly toggle: () => void }
  readonly details?: { readonly open: boolean; readonly toggle: () => void }
  readonly onCapture?: () => void
  readonly quote?: { readonly open: boolean; readonly toggle: () => void }
  /** Hide the bars from focus and pointer input while a modal overlay owns the page. */
  readonly inert?: boolean
}

/**
 * The top bar answers "where am I": the physical page, the printed label, and
 * which panels are open. Reading controls stay off it so the page keeps its
 * width on a narrow pane.
 */
export function ReaderToolbar({
  t,
  view,
  pageInput,
  onPageInput,
  onGoTo,
  outlineOpen,
  onToggleOutline,
  annotations,
  details,
  onCapture,
  quote,
  inert = false,
}: ReaderToolbarProps): ReactNode {
  // A PDF's printed folio is citation context, not page navigation: it belongs
  // on the context line, not in the bar the reader steers by.
  const printedLabel =
    view.label !== undefined && view.label !== String(view.page) ? view.label : undefined
  const submitPage = () => {
    const page = Number(pageInput)
    if (Number.isInteger(page) && page >= 1 && page <= view.count) onGoTo(page)
    else onPageInput(String(view.page))
  }
  return (
    <>
      <div
        className={css.toolbar}
        role="toolbar"
        aria-label={t('documentNavigation')}
        {...(inert ? { inert: '' } : {})}
      >
        <div className={css.group}>
          <IconButton
            shape="square"
            icon={<IconChevronLeftOutlineRegular size={14} />}
            aria-label={t('previous')}
            disabled={view.page <= 1}
            onClick={() => onGoTo(view.page - 1)}
          />
          <form
            className={css.pageForm}
            aria-label={t('pagePosition', { page: view.page, count: view.count })}
            onSubmit={(event) => {
              event.preventDefault()
              submitPage()
            }}
          >
            <input
              className={css.pageSeat}
              type="text"
              inputMode="numeric"
              aria-label={t('page')}
              value={pageInput}
              onChange={(event) => onPageInput(event.target.value)}
              onBlur={submitPage}
            />
            <span className={css.meta}>{t('pageCount', { count: view.count })}</span>
          </form>
          <IconButton
            shape="square"
            icon={<IconChevronRightOutlineRegular size={14} />}
            aria-label={t('next')}
            disabled={view.page >= view.count}
            onClick={() => onGoTo(view.page + 1)}
          />
        </div>

        <span className={css.divider} aria-hidden="true" />

        <div className={css.group}>
          <Button size="sm" aria-expanded={outlineOpen} onClick={onToggleOutline}>
            {t('outline')}
          </Button>
          {annotations !== undefined && (
            <Button size="sm" aria-expanded={annotations.open} onClick={annotations.toggle}>
              {t('annotations')}
            </Button>
          )}
          {details !== undefined && (
            <Button size="sm" aria-expanded={details.open} onClick={details.toggle}>
              {t('details')}
            </Button>
          )}
          {onCapture && (
            <Button size="sm" onClick={onCapture}>
              {t('capture')}
            </Button>
          )}
        </div>
        {quote && (
          <Button size="sm" aria-expanded={quote.open} onClick={quote.toggle}>
            {t('quoteDocument')}
          </Button>
        )}
      </div>
      {(view.sectionTitle !== undefined || printedLabel !== undefined) && (
        <p className={css.sectionBar}>
          {view.sectionTitle !== undefined && (
            <span className={css.sectionTitle} title={view.sectionTitle}>
              {t('currentSection', { title: view.sectionTitle })}
            </span>
          )}
          {printedLabel !== undefined && (
            <span className={css.sectionLabel}>{t('pageLabel', { label: printedLabel })}</span>
          )}
        </p>
      )}
    </>
  )
}

export interface ReaderFloatBarProps {
  readonly t: Translate
  readonly zoom: number
  readonly fitMode: 'width' | 'page' | 'free'
  readonly query: string
  readonly findStatus?: PdfFindStatus
  readonly onQuery: (value: string) => void
  readonly onFind: (backwards: boolean) => void
  readonly onZoom: (factor: number) => void
  readonly onFit: (mode: 'page-width' | 'page-fit') => void
  readonly onRotate: (step: 1 | -1) => void
  readonly onOpenZotero?: () => void
  readonly inert?: boolean
}

/** How long the bar stays up after the last pointer activity, as the host's zoom panel does. */
const IDLE_MS = 2500

/**
 * The floating reading bar over the page, with the host's own zoom-panel
 * geometry and visibility: scale, find, and the document actions that are not
 * worth a top-bar seat (fit modes, rotation, opening the page in Zotero). It
 * fades out while reading and returns on pointer movement or focus.
 */
export function ReaderFloatBar({
  t,
  zoom,
  fitMode,
  query,
  findStatus,
  onQuery,
  onFind,
  onZoom,
  onFit,
  onRotate,
  onOpenZotero,
  inert = false,
}: ReaderFloatBarProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [hovered, setHovered] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // The page area is the bar's parent: pointer activity there means reading.
    const area = bar.current?.parentElement
    if (!area) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    }
    const leave = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    }
    area.addEventListener('pointermove', wake)
    area.addEventListener('pointerdown', wake)
    area.addEventListener('pointerleave', leave)
    leave()
    return () => {
      clearTimeout(timer)
      area.removeEventListener('pointermove', wake)
      area.removeEventListener('pointerdown', wake)
      area.removeEventListener('pointerleave', leave)
    }
  }, [])
  const items: readonly MenuEntry[] = [
    { id: 'fit-width', label: t('fitWidth') },
    { id: 'fit-page', label: t('fitPage') },
    { type: 'separator', id: 'fit-separator' },
    { id: 'rotate-cw', label: t('rotate') },
    { id: 'rotate-ccw', label: t('rotateCounterclockwise') },
    ...(onOpenZotero === undefined
      ? []
      : ([
          { type: 'separator', id: 'zotero-separator' },
          { id: 'zotero', label: t('zotero') },
        ] satisfies MenuEntry[])),
  ]
  const selectedId = fitMode === 'width' ? 'fit-width' : fitMode === 'page' ? 'fit-page' : undefined
  return (
    <div
      ref={bar}
      className={clsx(css.floatBar, (!idle || hovered || menuOpen) && css.floatVisible)}
      role="toolbar"
      aria-label={t('readingControls')}
      {...(inert ? { inert: '' } : {})}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        setHovered(true)
        setIdle(false)
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <div className={css.group}>
        <IconButton
          shape="square"
          icon={MINUS}
          aria-label={t('zoomOut')}
          onClick={() => onZoom(1 / 1.2)}
        />
        <span className={css.percent}>{Math.round(zoom * 100)}%</span>
        <IconButton
          shape="square"
          icon={<IconPlusOutlineRegular size={14} />}
          aria-label={t('zoomIn')}
          onClick={() => onZoom(1.2)}
        />
      </div>

      <span className={css.divider} aria-hidden="true" />

      <form
        className={css.findForm}
        onSubmit={(event) => {
          event.preventDefault()
          onFind(false)
        }}
      >
        <Input
          className={css.findSeat}
          type="search"
          icon={<IconSearchOutlineRegular size={16} />}
          aria-label={t('find')}
          placeholder={t('find')}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <IconButton
          shape="square"
          icon={<IconChevronUpOutlineRegular size={14} />}
          aria-label={t('findPrevious')}
          disabled={!query.trim()}
          onClick={() => onFind(true)}
        />
        <IconButton
          shape="square"
          icon={<IconChevronDownOutlineRegular size={14} />}
          aria-label={t('findNext')}
          disabled={!query.trim()}
          onClick={() => onFind(false)}
        />
        {query.trim() && findStatus && (
          <span className={css.findStatus} role="status" aria-live="polite">
            {findStatus.state === 'pending'
              ? t('findSearching')
              : findStatus.state === 'not-found' || findStatus.total === 0
                ? t('findNoResults')
                : t('findResults', {
                    current: findStatus.current,
                    total: findStatus.total,
                  })}
          </span>
        )}
      </form>

      <span className={css.divider} aria-hidden="true" />

      <Menu
        open={menuOpen}
        anchor={
          <IconButton
            shape="square"
            icon={<IconEllipsisOutlineMedium size={14} />}
            aria-label={t('toolbarMore')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          />
        }
        items={items}
        selectedId={selectedId}
        align="end"
        portal
        autoFocus
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'fit-width') onFit('page-width')
          else if (id === 'fit-page') onFit('page-fit')
          else if (id === 'rotate-cw') onRotate(1)
          else if (id === 'rotate-ccw') onRotate(-1)
          else if (id === 'zotero') onOpenZotero?.()
        }}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  )
}
