import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ZoteroAttachmentRowView,
  ZoteroItemDetailView,
  ZoteroNoteRowView,
} from '../../contract.ts'
import { isPdfContentType } from '../../media-types.ts'
import type { PdfPageRegion } from '../../reader/evidence.ts'
import { messageOf } from '../error-text.ts'
import type { ReaderTabFace } from './ReaderTab.tsx'
import { ReaderCitationCopy, type ReaderCitationOptions } from './ReaderCitationCopy.tsx'
import { ReaderNote, ReaderNoteMutation } from './ReaderNote.tsx'
import { ReaderBatchQuote } from './ReaderBatchQuote.tsx'
import { ReaderSiblingAnnotations } from './ReaderSiblingAnnotations.tsx'
import { ReaderJournalMetrics, type ReaderJournalMetricsOptions } from './ReaderJournalMetrics.tsx'
import { emptyVisits, sameReadingLibrary, type ReadingVisits } from './reading-history.ts'
import css from './reader.module.css'

interface ReaderDetailsProps extends PropsLocale<'zoteroReader'> {
  readonly sessionId: string
  readonly documentRef: string
  readonly tabSignal: AbortSignal
  readonly details: ReaderTabFace['details']
  readonly readAnnotations?: ReaderTabFace['annotations']
  readonly readNote?: ReaderTabFace['readNote']
  readonly readNoteImage?: ReaderTabFace['readNoteImage']
  readonly visits?: ReadingVisits
  readonly writeNote?: ReaderTabFace['writeNote']
  readonly translate?: ReaderTabFace['translate']
  readonly journalMetrics?: ReaderJournalMetricsOptions
  readonly citationCopy?: ReaderCitationOptions
  readonly canExport?: boolean
  readonly inputActions?: Pick<InputActions, 'insertQuote' | 'persistDraft'>
  readonly resolve: ReaderTabFace['resolve']
  readonly switchingDisabled: boolean
  readonly onSwitch: (
    attachment: Pick<ZoteroAttachmentRowView, 'ref' | 'title'>,
    position?: PdfPageRegion,
  ) => void
}

function mergePage<T extends { readonly ref: string }>(
  previous: readonly T[] | undefined,
  page: readonly T[],
  offset: number,
): readonly T[] {
  if (!previous || offset === 0) return page
  return [...new Map([...previous, ...page].map((row) => [row.ref, row])).values()]
}

const AGO_LABELS = {
  minutes: 'agoMinutes',
  hours: 'agoHours',
  days: 'agoDays',
  months: 'agoMonths',
  years: 'agoYears',
} as const

export function ReaderDetails({
  t,
  sessionId,
  documentRef,
  tabSignal,
  details,
  readAnnotations,
  readNote,
  readNoteImage,
  visits = emptyVisits,
  writeNote,
  translate,
  journalMetrics,
  citationCopy,
  canExport,
  inputActions,
  resolve,
  switchingDisabled,
  onSwitch,
}: ReaderDetailsProps) {
  const notePreviewId = useId()
  const [result, setResult] = useState<{
    item: ZoteroItemDetailView
    attachments: readonly ZoteroAttachmentRowView[]
    notes: readonly ZoteroNoteRowView[]
  }>()
  const [requestedOffset, setRequestedOffset] = useState(0)
  const [notesOffset, setNotesOffset] = useState<number>()
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState<string>()
  const [pending, setPending] = useState(true)
  const [switchError, setSwitchError] = useState<string>()
  const [switching, setSwitching] = useState(false)
  const [annotationAttachment, setAnnotationAttachment] = useState<string>()
  const [selectedNote, setSelectedNote] = useState<string>()
  const [creatingNote, setCreatingNote] = useState(false)
  const [noteStatus, setNoteStatus] = useState<string>()
  const [abstractStatus, setAbstractStatus] = useState<'abstractQuoteAdded' | 'quoteInsertFailed'>()
  const switchScope = useRef<AbortController>()
  useEffect(() => () => switchScope.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([tabSignal, controller.signal])
    setPending(true)
    setFailed(undefined)
    const request = {
      sessionId,
      ref: documentRef,
      offset: requestedOffset,
      ...(notesOffset === undefined ? {} : { notesOffset }),
    }
    void details(request, signal).then(
      (next) => {
        if (signal.aborted) return
        setResult((previous) => {
          const sameItem = previous?.item.ref === next.ref ? previous : undefined
          return {
            item: next,
            attachments: mergePage(
              sameItem?.attachments,
              next.attachments?.items ?? [],
              requestedOffset,
            ),
            notes: mergePage(sameItem?.notes, next.notes?.items ?? [], notesOffset ?? 0),
          }
        })
        setPending(false)
      },
      (cause: unknown) => {
        if (signal.aborted) return
        setFailed(messageOf(cause))
        setPending(false)
      },
    )
    return () => controller.abort()
  }, [attempt, details, documentRef, notesOffset, requestedOffset, sessionId, tabSignal])

  const recent = useSyncExternalStore(visits.subscribe, visits.getSnapshot).filter(
    (entry) =>
      entry.attachmentRef !== documentRef && sameReadingLibrary(entry.attachmentRef, documentRef),
  )
  const switchTo = async (
    attachment: Pick<ZoteroAttachmentRowView, 'ref' | 'title'>,
    position?: PdfPageRegion,
  ) => {
    if (switchingDisabled || switchScope.current || tabSignal.aborted) return
    const controller = new AbortController()
    switchScope.current = controller
    const signal = AbortSignal.any([tabSignal, controller.signal])
    setSwitching(true)
    setSwitchError(undefined)
    try {
      const file = await resolve(attachment.ref, signal)
      if (file.ref !== attachment.ref) throw new Error('Attachment identity changed')
      if (!signal.aborted) {
        if (position) onSwitch(attachment, position)
        else onSwitch(attachment)
      }
    } catch {
      if (!signal.aborted) setSwitchError(attachment.title)
    } finally {
      switchScope.current = undefined
      if (!signal.aborted) setSwitching(false)
    }
  }

  const item = result?.item
  const creators = item?.creators
    .map(({ name, firstName, lastName }) => name || [firstName, lastName].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ')
  const nextOffset = item?.attachments?.nextOffset
  const nextNotesOffset = item?.notes?.nextOffset
  const noteWriter = item?.noteWriteEnabled ? writeNote : undefined
  const quoteAbstract = () => {
    if (!item?.abstract || !inputActions || tabSignal.aborted) return
    const notice = item.abstractTruncated ? t('abstractQuoteTruncated') : undefined
    const body = [item.abstract, notice].filter(Boolean).join('\n\n')
    const draft = [t('abstractQuoteSource', { ref: item.ref }), body].join('\n\n')
    if (
      !inputActions.insertQuote(draft, { label: t('detailsAbstract'), title: item.title, body })
    ) {
      setAbstractStatus('quoteInsertFailed')
      return
    }
    inputActions.persistDraft()
    setAbstractStatus('abstractQuoteAdded')
  }
  const refreshNotes = () => {
    setRequestedOffset(0)
    setNotesOffset(undefined)
    setAttempt((current) => current + 1)
  }
  const closeCreate = (message?: string) => {
    if (message !== undefined) setNoteStatus(message)
    setCreatingNote(false)
    if (message !== undefined) refreshNotes()
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-note-create]')?.focus()
    })
  }
  const closeNote = (message?: string) => {
    const closed = selectedNote
    if (message !== undefined) setNoteStatus(message)
    setSelectedNote(undefined)
    if (message !== undefined) refreshNotes()
    requestAnimationFrame(() => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-note-open]')) {
        if (button.dataset.noteOpen === closed) {
          button.focus()
          return
        }
      }
      document.querySelector<HTMLButtonElement>('[data-note-create]')?.focus()
    })
  }
  if (selectedNote !== undefined && readNote) {
    return (
      <aside aria-label={t('detailsNotes')}>
        <ReaderNote
          key={selectedNote}
          t={t}
          refString={selectedNote}
          sessionId={sessionId}
          tabSignal={tabSignal}
          read={readNote}
          readImage={readNoteImage}
          write={noteWriter}
          translate={translate}
          onBack={() => closeNote()}
          onDeleted={(message) => closeNote(message)}
          onEdited={refreshNotes}
          inputActions={inputActions}
        />
      </aside>
    )
  }
  if (creatingNote && item && noteWriter) {
    return (
      <aside aria-label={t('detailsNotes')}>
        <ReaderNoteMutation
          t={t}
          action={{ operation: 'create', ref: item.ref, sessionId }}
          signal={tabSignal}
          write={noteWriter}
          onCancel={() => closeCreate()}
          onApplied={(message) => {
            closeCreate(message)
          }}
        />
      </aside>
    )
  }
  return (
    <aside aria-label={t('details')}>
      {pending && (
        <p className={css.status} role="status">
          {t('detailsLoading')}
        </p>
      )}
      {failed !== undefined && (
        <div>
          <p role="alert">{t('detailsFailed', { message: failed })}</p>
          <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>
            {t('retry')}
          </Button>
        </div>
      )}
      {recent.length > 0 && (
        <details className={css.disclosure}>
          <summary>{t('recentReading')}</summary>
          <ul className={css.annotationList}>
            {recent.map(({ attachmentRef, title, pageIndex, lastVisitedAt }) => {
              const age = relativeTime(lastVisitedAt, Date.now())
              return (
                <li key={attachmentRef}>
                  <Button
                    size="sm"
                    disabled={switchingDisabled || switching}
                    onClick={() =>
                      void switchTo({ ref: attachmentRef, title: title || attachmentRef })
                    }
                  >
                    {title || attachmentRef}
                  </Button>
                  <span>
                    {t('recentPage', { page: pageIndex + 1 })} ·{' '}
                    <time
                      className={css.meta}
                      dateTime={new Date(lastVisitedAt).toISOString()}
                      title={new Date(lastVisitedAt).toLocaleString()}
                    >
                      {t(age.unit === 'now' ? 'agoNow' : AGO_LABELS[age.unit], { count: age.n })}
                    </time>
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {switchError !== undefined && (
        <p role="alert">{t('attachmentSwitchFailed', { title: switchError })}</p>
      )}
      {item && (
        <>
          <h3 className={css.detailsTitle}>{item.title}</h3>
          {creators && <p className={css.detailsText}>{creators}</p>}
          {citationCopy && (
            <div className={css.controls}>
              <ReaderCitationCopy
                options={citationCopy}
                item={item}
                enabled={canExport}
                tabSignal={tabSignal}
              />
            </div>
          )}
          <dl>
            {item.venue && (
              <>
                <dt className={css.detailsTerm}>{t('detailsVenue')}</dt>
                <dd className={css.detailsValue}>{item.venue}</dd>
              </>
            )}
            {item.date && (
              <>
                <dt className={css.detailsTerm}>{t('detailsDate')}</dt>
                <dd className={css.detailsValue}>{item.date}</dd>
              </>
            )}
            {item.doi && (
              <>
                <dt className={css.detailsTerm}>DOI</dt>
                <dd className={css.detailsValue}>{item.doi}</dd>
              </>
            )}
            {item.tags.length > 0 && (
              <>
                <dt className={css.detailsTerm}>{t('detailsTags')}</dt>
                <dd className={css.detailsValue}>{item.tags.join(', ')}</dd>
              </>
            )}
            {item.collections.length > 0 && (
              <>
                <dt className={css.detailsTerm}>{t('detailsCollections')}</dt>
                <dd className={css.detailsValue}>
                  {item.collections.map(({ name, ref }) => name ?? ref).join(', ')}
                </dd>
              </>
            )}
          </dl>
          {journalMetrics && item.itemType === 'journalArticle' && item.publicationTitle && (
            <ReaderJournalMetrics
              t={t}
              journal={item.publicationTitle}
              options={journalMetrics}
              tabSignal={tabSignal}
            />
          )}
          {item.abstract && (
            <>
              <h4 className={css.detailsHeading}>{t('detailsAbstract')}</h4>
              <p className={css.detailsText}>
                {item.abstract}
                {item.abstractTruncated ? '…' : ''}
              </p>
              {inputActions && (
                <Button size="sm" onClick={quoteAbstract}>
                  {t('quoteAbstract')}
                </Button>
              )}
              {abstractStatus && <p role="status">{t(abstractStatus)}</p>}
            </>
          )}
          {item.attachments && (
            <>
              <h4 className={css.detailsHeading}>{t('detailsAttachments')}</h4>
              <ul className={css.annotationList}>
                {result.attachments.map((attachment) => (
                  <li key={attachment.ref}>
                    {attachment.ref === documentRef ? (
                      <span aria-current="true">{attachment.title}</span>
                    ) : isPdfContentType(attachment.contentType) ? (
                      <>
                        <div className={css.controls}>
                          <Button
                            size="sm"
                            disabled={switchingDisabled || switching}
                            onClick={() => void switchTo(attachment)}
                          >
                            {attachment.title}
                          </Button>
                          {readAnnotations && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={t('siblingAnnotations', { title: attachment.title })}
                              aria-expanded={annotationAttachment === attachment.ref}
                              onClick={() =>
                                setAnnotationAttachment((open) =>
                                  open === attachment.ref ? undefined : attachment.ref,
                                )
                              }
                            >
                              {t('annotations')}
                            </Button>
                          )}
                        </div>
                        {readAnnotations && annotationAttachment === attachment.ref && (
                          <ReaderSiblingAnnotations
                            t={t}
                            sessionId={sessionId}
                            attachmentRef={attachment.ref}
                            tabSignal={tabSignal}
                            read={readAnnotations}
                            disabled={switchingDisabled || switching}
                            onLocate={(position) => void switchTo(attachment, position)}
                          />
                        )}
                      </>
                    ) : (
                      attachment.title
                    )}
                  </li>
                ))}
              </ul>
              {nextOffset !== undefined && !failed && (
                <Button size="sm" disabled={pending} onClick={() => setRequestedOffset(nextOffset)}>
                  {t('more')}
                </Button>
              )}
            </>
          )}
          {(noteWriter || result.notes.length > 0 || nextNotesOffset !== undefined) && (
            <>
              <h4 className={css.detailsHeading}>{t('detailsNotes')}</h4>
              {noteStatus && <p role="status">{noteStatus}</p>}
              {noteWriter && (
                <Button
                  size="sm"
                  data-note-create
                  disabled={pending}
                  onClick={() => setCreatingNote(true)}
                >
                  {t('noteCreate')}
                </Button>
              )}
              {inputActions && result.notes.length > 0 && (
                <ReaderBatchQuote
                  t={t}
                  kind="note"
                  entries={result.notes}
                  itemRef={item.ref}
                  title={item.title}
                  tabSignal={tabSignal}
                  inputActions={inputActions}
                />
              )}
              <ul className={css.annotationList}>
                {result.notes.map((note) => {
                  const clamped = note.truncated || note.text.length > 180
                  const previewId = `${notePreviewId}-${note.ref}`
                  return (
                    <li key={note.ref} className={css.noteCard}>
                      <p
                        id={previewId}
                        className={`${css.noteText} ${clamped ? css.noteClamp : ''}`}
                        title={note.text}
                      >
                        {note.text || t('noteEmpty')}
                      </p>
                      {readNote ? (
                        <div className={css.noteFooter}>
                          <Button
                            size="sm"
                            aria-describedby={previewId}
                            data-note-open={note.ref}
                            onClick={() => setSelectedNote(note.ref)}
                          >
                            {t('noteOpen')}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {nextNotesOffset !== undefined && !failed && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => setNotesOffset(nextNotesOffset)}
                >
                  {t('moreNotes')}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </aside>
  )
}
