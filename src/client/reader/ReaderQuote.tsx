import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroAnnotationRowView } from '../../contract.ts'
import type {
  EvidencePrecision,
  EvidenceSourceType,
  PdfQuoteSource,
} from '../../reader/evidence.ts'
import {
  excerptPrefix,
  MAX_EXCERPT_PAGES,
  MAX_EXCERPT_RECTS,
  MAX_EXCERPT_TEXT,
  type PdfExcerpt,
} from './pdf-excerpt.ts'
import type { PdfOutline, PdfView } from './pdf-runtime.ts'
import { isCharacterBoundary } from './text-boundary.ts'
import { useReturnFocus } from './return-focus.ts'
import css from './reader.module.css'

interface Section {
  readonly id: string
  readonly path: readonly string[]
  readonly start: number
}

function sectionsOf(
  outline: readonly PdfOutline[],
  count: number,
  path: readonly string[] = [],
): Section[] {
  return outline.flatMap((item) => {
    const sectionPath = [...path, excerptPrefix(item.title, 200)]
    const start = item.pageIndex === undefined ? 0 : item.pageIndex + 1
    const children = sectionsOf(item.children, count, sectionPath)
    return start >= 1 && start <= count
      ? [{ id: item.id, path: sectionPath, start }, ...children]
      : children
  })
}

type QuoteScope = 'document' | 'full' | 'pages' | 'sections' | 'characters'

interface ReviewSource {
  readonly provenance: PdfQuoteSource
  readonly label: string
  readonly excerpt: string
}

export type ReaderReviews = SnapshotStore<ReadonlyMap<SessionId, readonly ReviewSource[]>>
const REVIEW_ENTRIES = 8
const REVIEW_SESSIONS = 16
const REVIEW_CHARS = MAX_EXCERPT_TEXT * 2
const REVIEW_PROVENANCE_CHARS = 16_000
const emptyReview: readonly ReviewSource[] = []
const noSubscription = () => () => undefined

interface ReaderQuoteProps extends PropsLocale<'zoteroReader'> {
  readonly source: PdfQuoteSource
  readonly view: PdfView
  readonly outline: readonly PdfOutline[]
  readonly annotation?: ZoteroAnnotationRowView
  readonly tabSignal: AbortSignal
  readonly inputActions: Pick<InputActions, 'insertQuote' | 'persistDraft'>
  readonly review?: { store: ReaderReviews; sessionId: SessionId }
  readonly read: (start: number, end: number, signal: AbortSignal) => Promise<PdfExcerpt>
  readonly pageLabel: (pageIndex: number) => string
  readonly onClose: () => void
}

export function ReaderQuote({
  t,
  source,
  view,
  outline,
  annotation,
  tabSignal,
  inputActions,
  review,
  read,
  pageLabel,
  onClose,
}: ReaderQuoteProps) {
  useReturnFocus()
  const sections = useMemo(() => sectionsOf(outline, view.count), [outline, view.count])
  const [scope, setScope] = useState<QuoteScope>('document')
  const [startPage, setStartPage] = useState(String(view.page))
  const [endPage, setEndPage] = useState(String(view.page))
  const [firstCharacter, setFirstCharacter] = useState('1')
  const [lastCharacter, setLastCharacter] = useState('')
  const [startSectionId, setStartSectionId] = useState(view.sectionId ?? '')
  const [endSectionId, setEndSectionId] = useState(view.sectionId ?? '')
  const [preview, setPreview] = useState<PdfExcerpt>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  const selected = useSyncExternalStore(
    review?.store.subscribe ?? noSubscription,
    () => (review && review.store.getSnapshot().get(review.sessionId)) ?? emptyReview,
  )
  useEffect(() => () => request.current?.abort(), [])

  const startSection = sections.find(({ id }) => id === startSectionId) ?? sections[0]
  const endSection = sections.find(({ id }) => id === endSectionId) ?? startSection
  const endIndex = sections.indexOf(endSection)
  const nextSection = sections
    .slice(endIndex + 1)
    .find(
      ({ id, start }) =>
        endSection && start >= endSection.start && !id.startsWith(`${endSection.id}.`),
    )
  const pageScope = scope === 'pages' || scope === 'characters'
  const start = pageScope ? Number(startPage) : scope === 'sections' ? startSection?.start : 1
  const end = pageScope
    ? Number(endPage)
    : scope === 'sections' && nextSection && endSection
      ? Math.max(endSection.start, nextSection.start - 1)
      : view.count
  const valid =
    start !== undefined &&
    Number.isInteger(start) &&
    start >= 1 &&
    Number.isInteger(end) &&
    end >= start &&
    end <= view.count &&
    (scope !== 'sections' ||
      (sections.indexOf(startSection) <= endIndex && endSection.start >= start))
  const pagesInvalid =
    pageScope &&
    !(
      Number.isInteger(start) &&
      start >= 1 &&
      Number.isInteger(end) &&
      end >= start &&
      end <= view.count
    )

  const reset = () => {
    setPreview(undefined)
    setError(undefined)
  }
  const load = async () => {
    if (!valid || tabSignal.aborted || request.current) return
    const controller = new AbortController()
    request.current = controller
    const lifetime = AbortSignal.any([controller.signal, tabSignal])
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(20_000)])
    setPending(true)
    reset()
    try {
      const excerpt = await read(start, end, signal)
      signal.throwIfAborted()
      setPreview(excerpt)
      setFirstCharacter('1')
      setLastCharacter(String(excerpt.text.length))
    } catch {
      if (!lifetime.aborted) setError(t('quoteReadFailed'))
    } finally {
      request.current = undefined
      if (!lifetime.aborted) setPending(false)
    }
  }

  const position = annotation?.position
  const annotationPage =
    position && position.pageIndex >= 0 && position.pageIndex < view.count ? position : undefined
  const annotationBody =
    annotation &&
    [
      annotation.text,
      annotation.comment && t('quoteAnnotationComment', { comment: annotation.comment }),
    ]
      .filter(Boolean)
      .join('\n\n')
  const offset = Number(firstCharacter) - 1
  const endOffset = Number(lastCharacter)
  const textRange =
    scope === 'characters' &&
    preview &&
    Number.isInteger(offset) &&
    Number.isInteger(endOffset) &&
    offset >= 0 &&
    endOffset > offset &&
    endOffset <= preview.text.length &&
    isCharacterBoundary(preview.text, offset) &&
    isCharacterBoundary(preview.text, endOffset)
      ? { start: offset, end: endOffset }
      : undefined
  const text =
    annotationBody === undefined
      ? scope === 'characters'
        ? textRange && preview
          ? preview.text.slice(textRange.start, textRange.end)
          : ''
        : (preview?.text ?? '')
      : excerptPrefix(annotationBody, MAX_EXCERPT_TEXT)
  const annotationRects =
    annotationPage?.rects.length && annotationPage.rects.length <= MAX_EXCERPT_RECTS
      ? annotationPage.rects
      : undefined
  const pages = annotationPage
    ? [
        {
          pageIndex: annotationPage.pageIndex,
          pageLabel: pageLabel(annotationPage.pageIndex),
          rects: annotationRects,
        },
      ]
    : (preview?.pages ?? [])
        .filter(
          ({ textRange: pageRange }) =>
            scope !== 'characters' ||
            (pageRange &&
              textRange &&
              pageRange.start < textRange.end &&
              pageRange.end > textRange.start),
        )
        .map(({ pageIndex, pageLabel }) => ({ pageIndex, pageLabel }))
  const documentOnly = !annotation && scope === 'document'
  const limitReached = Boolean(
    preview?.truncated || (annotationBody && text.length < annotationBody.length),
  )
  const pageList = pages.map(({ pageIndex }) => pageIndex + 1).join(', ')
  const citation = pageList
    ? t('quoteSource', { ref: source.attachmentRef, pages: pageList })
    : t('quoteDocumentSource', { ref: source.attachmentRef })
  const provenance = {
    ...source,
    sourceType: (annotation
      ? 'annotation'
      : documentOnly
        ? 'document'
        : 'page') satisfies EvidenceSourceType,
    precision: (annotationRects
      ? 'region'
      : textRange
        ? 'text'
        : pages.length
          ? 'page'
          : 'document') satisfies EvidencePrecision,
    ...(textRange && { textRange }),
    ...(annotation && { annotationRef: annotation.ref, annotationPageLabel: annotation.pageLabel }),
    ...(preview &&
      valid && { requestedPages: { firstPageIndex: start - 1, lastPageIndex: end - 1 } }),
    ...(preview &&
      scope === 'sections' && { sectionPath: startSection.path, endSectionPath: endSection.path }),
    ...(limitReached && { excerptTruncated: true }),
    ...(preview?.emptyPages ? { pagesWithoutText: preview.emptyPages } : {}),
    pages,
  }
  const truncatedNotice = limitReached ? t('quoteExcerptTruncated') : undefined
  const emptyNotice = preview?.emptyPages
    ? t('quotePagesWithoutText', { count: preview.emptyPages })
    : undefined
  const draft = [citation, text, truncatedNotice, emptyNotice, JSON.stringify(provenance)]
    .filter(Boolean)
    .join('\n\n')
  const canInsert = documentOnly || ((pages.length > 0 || !!annotation) && Boolean(text.trim()))
  const insert = () => {
    if (tabSignal.aborted || !canInsert) return
    if (
      !inputActions.insertQuote(draft, {
        title: source.title,
        label: t(annotation ? 'quoteAnnotation' : 'quoteDocument'),
        ...(pageList && { detail: t('selectionPages', { pages: pageList }) }),
        body: text || citation,
      })
    ) {
      setError(t('quoteInsertFailed'))
      return
    }
    inputActions.persistDraft()
    onClose()
  }

  const reviewText = selected.map(({ excerpt }) => excerpt).join('\n\n')
  const reviewSources = JSON.stringify(selected.map(({ provenance }) => provenance))
  const reviewDraft = `${t('quoteReviewPrompt')}\n\n${reviewText}\n\n${reviewSources}`
  const setReview = (change: (entries: readonly ReviewSource[]) => readonly ReviewSource[]) => {
    if (!review || tabSignal.aborted) return
    const { store, sessionId } = review
    const current = store.getSnapshot()
    const next = change(current.get(sessionId) ?? emptyReview)
    const updated = new Map(current)
    updated.delete(sessionId)
    if (next.length) updated.set(sessionId, next)
    if (updated.size > REVIEW_SESSIONS) {
      const oldest = updated.keys().next()
      if (!oldest.done) updated.delete(oldest.value)
    }
    store.set(updated)
  }
  const addToReview = () => {
    if (!canInsert) return
    const entry = {
      provenance,
      label: pageList
        ? `${source.title} · ${t('selectionPages', { pages: pageList })}`
        : source.title,
      excerpt: [source.title, citation, text, truncatedNotice, emptyNotice]
        .filter(Boolean)
        .join('\n\n'),
    }
    setError(undefined)
    setReview((entries) => {
      const retained = entries.filter(
        ({ provenance: previous }) => previous.attachmentRef !== source.attachmentRef,
      )
      const next = [...retained, entry]
      if (
        next.length > REVIEW_ENTRIES ||
        next.reduce((total, source) => total + source.excerpt.length, 0) > REVIEW_CHARS ||
        JSON.stringify(next.map(({ provenance }) => provenance)).length > REVIEW_PROVENANCE_CHARS
      ) {
        setError(t('quoteReviewLimit', { count: REVIEW_ENTRIES, characters: REVIEW_CHARS }))
        return entries
      }
      return next
    })
  }

  return (
    <section
      className={css.translation}
      aria-label={t(annotation ? 'quoteAnnotation' : 'quoteDocument')}
    >
      {!annotation && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void load()
          }}
        >
          <fieldset className={`${css.fieldset} ${css.controls}`} disabled={pending}>
            <label className={css.fieldLabel}>
              {t('quoteScope')}
              <select
                className={css.field}
                value={scope}
                onChange={(event) => {
                  reset()
                  setScope(event.target.value as QuoteScope)
                }}
              >
                <option value="document">{t('quoteReferenceOnly')}</option>
                <option value="full">{t('quoteFullPdf')}</option>
                <option value="pages">{t('quotePageRange')}</option>
                <option value="characters">{t('quoteCharacterRange')}</option>
                {!!sections.length && <option value="sections">{t('quoteSectionRange')}</option>}
              </select>
            </label>
            {pageScope && (
              <>
                <label className={css.fieldLabel}>
                  {t('quoteFirstPage')}
                  <input
                    className={css.field}
                    type="number"
                    min={1}
                    max={view.count}
                    required
                    aria-invalid={pagesInvalid || undefined}
                    aria-describedby={pagesInvalid ? 'reader-quote-page-error' : undefined}
                    value={startPage}
                    onChange={(event) => {
                      reset()
                      setStartPage(event.target.value)
                    }}
                  />
                </label>
                <label className={css.fieldLabel}>
                  {t('quoteLastPage')}
                  <input
                    className={css.field}
                    type="number"
                    min={1}
                    max={view.count}
                    required
                    aria-invalid={pagesInvalid || undefined}
                    aria-describedby={pagesInvalid ? 'reader-quote-page-error' : undefined}
                    value={endPage}
                    onChange={(event) => {
                      reset()
                      setEndPage(event.target.value)
                    }}
                  />
                </label>
                {pagesInvalid && (
                  <p id="reader-quote-page-error" className={css.fieldError}>
                    {t('quoteInvalidPages', { count: view.count })}
                  </p>
                )}
              </>
            )}
            {scope === 'sections' && (
              <>
                <label className={`${css.fieldLabel} ${css.quoteSection}`}>
                  {t('quoteFirstSection')}
                  <select
                    className={css.field}
                    value={startSection?.id}
                    onChange={(event) => {
                      reset()
                      setStartSectionId(event.target.value)
                      setEndSectionId(event.target.value)
                    }}
                  >
                    {sections.map(({ id, path, start }) => (
                      <option key={id} value={id}>{`${path.join(' › ')} (${start})`}</option>
                    ))}
                  </select>
                </label>
                <label className={`${css.fieldLabel} ${css.quoteSection}`}>
                  {t('quoteLastSection')}
                  <select
                    className={css.field}
                    value={endSection?.id}
                    onChange={(event) => {
                      reset()
                      setEndSectionId(event.target.value)
                    }}
                  >
                    {sections.slice(sections.indexOf(startSection)).map(({ id, path, start }) => (
                      <option key={id} value={id}>{`${path.join(' › ')} (${start})`}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {!documentOnly && (
              <Button type="submit" size="sm" disabled={!valid}>
                {t('quotePrepare')}
              </Button>
            )}
          </fieldset>
          {scope === 'sections' && valid && <p>{t('quoteOutlinePages', { start, end })}</p>}
          {!documentOnly && (
            <p>{t('quoteBudget', { pages: MAX_EXCERPT_PAGES, characters: MAX_EXCERPT_TEXT })}</p>
          )}
        </form>
      )}
      {pending && <p role="status">{t('quoteReading')}</p>}
      {error && <p role="alert">{error}</p>}
      {preview && !preview.text && <p role="status">{t('quoteNoText')}</p>}
      {scope === 'characters' && !!preview?.text && (
        <>
          <div className={css.controls}>
            <label className={css.fieldLabel}>
              {t('quoteFirstCharacter')}
              <input
                className={css.field}
                type="number"
                min={1}
                max={preview.text.length}
                value={firstCharacter}
                onChange={(event) => setFirstCharacter(event.target.value)}
              />
            </label>
            <label className={css.fieldLabel}>
              {t('quoteLastCharacter')}
              <input
                className={css.field}
                type="number"
                min={1}
                max={preview.text.length}
                value={lastCharacter}
                onChange={(event) => setLastCharacter(event.target.value)}
              />
            </label>
          </div>
          <textarea
            className={css.field}
            aria-label={t('quoteExtractedText')}
            value={preview.text}
            readOnly
            rows={4}
            onSelect={(event) => {
              const { selectionStart, selectionEnd } = event.currentTarget
              if (selectionEnd > selectionStart) {
                setFirstCharacter(String(selectionStart + 1))
                setLastCharacter(String(selectionEnd))
              }
            }}
          />
          {!canInsert && <p role="status">{t('quoteInvalidCharacters')}</p>}
        </>
      )}
      {canInsert && (
        <>
          <p role="status">
            {t('quoteEstimatedTokens', { count: 4 + Math.ceil(formatQuoteText(draft).length / 4) })}
          </p>
          {truncatedNotice && <p role="status">{truncatedNotice}</p>}
          {emptyNotice && <p role="status">{emptyNotice}</p>}
          <blockquote className={css.quoteText}>{text || citation}</blockquote>
        </>
      )}
      <div className={css.controls}>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        {review && canInsert && (
          <Button type="button" size="sm" onClick={addToReview}>
            {t('quoteReviewSelect')}
          </Button>
        )}
        {canInsert && (
          <Button type="button" size="sm" variant="primary" onClick={insert}>
            {t('quoteAddDraft')}
          </Button>
        )}
      </div>
      {!!selected.length && (
        <section aria-label={t('quoteReviewScope')}>
          <ul>
            {selected.map(({ provenance, label }) => (
              <li key={provenance.attachmentRef}>
                {label}{' '}
                <Button
                  size="sm"
                  aria-label={t('quoteReviewRemove', { title: label })}
                  onClick={() =>
                    setReview((items) =>
                      items.filter(
                        (item) => item.provenance.attachmentRef !== provenance.attachmentRef,
                      ),
                    )
                  }
                >
                  {t('quoteReviewRemoveButton')}
                </Button>
              </li>
            ))}
          </ul>
          {selected.length >= 2 && (
            <>
              <p>
                {t('quoteEstimatedTokens', {
                  count: 4 + Math.ceil(formatQuoteText(reviewDraft).length / 4),
                })}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  if (tabSignal.aborted) return
                  if (
                    !inputActions.insertQuote(reviewDraft, {
                      label: t('quoteReviewScope'),
                      title: t('quoteReviewSources', { count: selected.length }),
                      body: selected.map(({ label }) => label).join('\n'),
                    })
                  ) {
                    setError(t('quoteInsertFailed'))
                    return
                  }
                  inputActions.persistDraft()
                  setReview(() => emptyReview)
                  onClose()
                }}
              >
                {t('quoteReviewDraft')}
              </Button>
            </>
          )}
        </section>
      )}
    </section>
  )
}
