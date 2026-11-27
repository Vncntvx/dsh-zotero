import { createElement, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroReaderNoteView, ZoteroReaderWriteNoteRequest } from '../../contract.ts'
import type { ZoteroNoteTextFormatting } from '../../types.ts'
import { ZOTERO_READER_NOTE_FORMATS, ZOTERO_READER_NOTE_TEXT_CHARS } from '../../constants.ts'
import { asRecord } from '../../json.ts'
import { REF_KEY_SOURCE, refFieldsOf } from '../../ref-grammar.ts'
import { messageOf } from '../error-text.ts'
import type { ReaderTabFace } from './ReaderTab.tsx'
import {
  noteDraftFormats,
  noteDraftKey,
  readNoteDraft,
  writeNoteDraft,
  type NoteDraft,
  type NoteDraftRetention,
} from './note-draft.ts'
import { inertDocumentHtml } from './inert-document-html.tsx'
import { ReaderExcerptActions, type ReaderTextSelection } from './ReaderExcerptActions.tsx'
import type { ReaderTranslationResult } from './ReaderTranslation.tsx'
import css from './reader.module.css'

const FORMAT_LABELS = {
  strong: 'noteFormatStrong',
  em: 'noteFormatEm',
  u: 'noteFormatUnderline',
  s: 'noteFormatStrike',
  mark: 'noteFormatHighlight',
  sub: 'noteFormatSubscript',
  sup: 'noteFormatSuperscript',
  code: 'noteFormatCode',
} as const
const IMAGE_KEY = new RegExp(`^${REF_KEY_SOURCE}$`)
const IMAGE_COUNT = 8

function noteFormattingPreview(text: string, formatting: readonly ZoteroNoteTextFormatting[]) {
  const boundaries = new Set([0, text.length])
  for (const { range } of formatting) {
    if (range) {
      boundaries.add(range.start)
      boundaries.add(range.end)
    }
  }
  const points = [...boundaries].sort((left, right) => left - right)
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!
    let segment: ReactNode = text.slice(start, end)
    const active = formatting.filter(
      ({ range }) => range === undefined || (range.start <= start && range.end >= end),
    )
    for (const { format } of active)
      segment = createElement(format, { key: `${start}-${format}` }, segment)
    return <Fragment key={start}>{segment}</Fragment>
  })
}

interface ReaderNoteProps extends PropsLocale<'zoteroReader'> {
  readonly refString: string
  readonly sessionId: string
  readonly tabSignal: AbortSignal
  readonly read: ReaderTabFace['readNote']
  readonly readImage?: ReaderTabFace['readNoteImage']
  readonly expectedVersion?: number
  readonly write?: ReaderTabFace['writeNote']
  readonly translate?: ReaderTabFace['translate']
  readonly onBack?: () => void
  readonly onDeleted: (message: string) => void
  readonly onEdited?: () => void
  readonly inputActions?: Pick<InputActions, 'insertQuote' | 'persistDraft'>
}

export function ReaderNote({
  t,
  refString,
  sessionId,
  tabSignal,
  read,
  readImage,
  expectedVersion,
  write,
  translate,
  onBack,
  onDeleted,
  onEdited,
  inputActions,
}: ReaderNoteProps) {
  const [note, setNote] = useState<ZoteroReaderNoteView>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<'noteQuoteAdded' | 'noteQuoteFailed'>()
  const [saved, setSaved] = useState<string>()
  const [mutation, setMutation] = useState<'edit' | 'delete'>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const imageLabel = t('noteImage')
  const content = useMemo(() => {
    if (note?.html === undefined) return undefined
    const fields = refFieldsOf(note.ref)
    let imageCount = 0
    return inertDocumentHtml(note.html, imageLabel, (key, alt) => {
      if (!readImage || !fields || !IMAGE_KEY.test(key) || imageCount >= IMAGE_COUNT)
        return undefined
      imageCount += 1
      const ref = note.ref.replace(`/item/${fields.key}`, `/attachment/${key}`)
      return (
        <ReaderNoteImage
          key={ref}
          t={t}
          alt={alt}
          tabSignal={tabSignal}
          read={(signal) => readImage(SessionId(sessionId), note.ref, ref, signal)}
        />
      )
    })
  }, [note, imageLabel, readImage, sessionId, t, tabSignal])

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    if (signal.aborted) return
    setFailed(false)
    void read({ sessionId, ref: refString }, signal).then(
      (next) => {
        if (!signal.aborted) setNote(next)
      },
      () => {
        if (!signal.aborted) setFailed(true)
      },
    )
    return () => controller.abort()
  }, [attempt, read, refString, sessionId, tabSignal])

  const back = onBack && (
    <Button size="sm" onClick={onBack}>
      {t('noteBack')}
    </Button>
  )
  if (failed)
    return (
      <div>
        {back}
        <p role="alert">{t('noteFailed')}</p>
        <Button size="sm" onClick={() => setAttempt((previous) => previous + 1)}>
          {t('retry')}
        </Button>
      </div>
    )
  if (!note)
    return (
      <>
        {back}
        <p role="status">{t('noteLoading')}</p>
      </>
    )
  const refresh = () => {
    setMutation(undefined)
    setNote(undefined)
    setAttempt((previous) => previous + 1)
  }
  const closeMutation = () => {
    const operation = mutation
    setMutation(undefined)
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          operation === 'delete' ? '[data-note-delete]' : '[data-note-edit]',
        )
        ?.focus()
    })
  }
  if (write && mutation && note.version !== undefined) {
    return (
      <ReaderNoteMutation
        t={t}
        action={{ operation: mutation, ref: note.ref, sessionId, expectedVersion: note.version }}
        runs={note.editableRuns}
        signal={tabSignal}
        write={write}
        onCancel={() => closeMutation()}
        onReload={refresh}
        onApplied={(message) => {
          if (mutation === 'delete') onDeleted(message)
          else {
            setSaved(message)
            onEdited?.()
            refresh()
          }
        }}
      />
    )
  }

  const quote = (
    selection?: ReaderTextSelection,
    translation?: ReaderTranslationResult,
    screenshot = false,
  ) => {
    if (!inputActions || tabSignal.aborted) return false
    const original = selection?.text ?? (note.truncated ? `${note.text}\n…` : note.text)
    const body = [
      original,
      selection?.truncated && t('quoteBatchTruncated'),
      translation && `${t('translationResult')}\n${translation.text}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const draft = [
      t('noteSource', { ref: note.ref }),
      body,
      JSON.stringify({
        noteRef: note.ref,
        sourceType: 'note',
        title: note.title,
        noteVersion: note.version,
        ...(screenshot && { excerptKind: 'screenshot' }),
        ...(translation && {
          translation: { target: translation.target, engine: translation.engine },
        }),
      }),
    ].join('\n\n')
    const label = t(
      translation ? 'translationQuote' : screenshot ? 'documentCapture' : 'detailsNotes',
    )
    if (!inputActions.insertQuote(draft, { label, title: note.title, body })) return false
    inputActions.persistDraft()
    return true
  }

  return (
    <article aria-label={note.title} className={css.noteBody}>
      {!onBack && <h2 className={css.detailsTitle}>{note.title}</h2>}
      {expectedVersion !== undefined && note.version !== expectedVersion && (
        <p role="status">{t('noteCitationChanged')}</p>
      )}
      <div className={css.controls}>
        {back}
        {write && note.version !== undefined && (
          <>
            {note.editableRuns?.length && (
              <Button size="sm" data-note-edit onClick={() => setMutation('edit')}>
                {t('noteEdit')}
              </Button>
            )}
            <Button size="sm" data-note-delete onClick={() => setMutation('delete')}>
              {t('annotationDeleteConfirm')}
            </Button>
          </>
        )}
      </div>
      <ReaderExcerptActions
        t={t}
        body={bodyRef}
        title={note.title}
        tabSignal={tabSignal}
        onQuote={inputActions && quote}
        translate={
          translate && ((text, target, signal) => translate({ sessionId, text, target }, signal))
        }
      />
      <div ref={bodyRef} className={css.documentText}>
        {content === undefined ? (
          <p>
            {note.text}
            {note.truncated ? '…' : ''}
          </p>
        ) : (
          content.nodes
        )}
      </div>
      {(content?.truncated || content === undefined) && <p role="status">{t('notePartial')}</p>}
      {saved && <p role="status">{saved}</p>}
      {inputActions && note.text.trim() && (
        <Button
          size="sm"
          onClick={() => {
            if (tabSignal.aborted) return
            setNotice(quote() ? 'noteQuoteAdded' : 'noteQuoteFailed')
          }}
        >
          {t('quote')}
        </Button>
      )}
      {notice && <p role="status">{t(notice)}</p>}
    </article>
  )
}

function ReaderNoteImage({
  t,
  alt,
  tabSignal,
  read,
}: PropsLocale<'zoteroReader'> & {
  alt?: string
  tabSignal: AbortSignal
  read: (signal: AbortSignal) => Promise<Blob>
}) {
  const [status, setStatus] = useState<'pending' | 'failed'>()
  const [url, setUrl] = useState<string>()
  const request = useRef<AbortController>()
  const objectUrl = useRef<string>()
  useEffect(() => {
    const dispose = () => {
      request.current?.abort()
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current)
        objectUrl.current = undefined
      }
    }
    tabSignal.addEventListener('abort', dispose, { once: true })
    return () => {
      tabSignal.removeEventListener('abort', dispose)
      dispose()
    }
  }, [tabSignal])
  if (url)
    return (
      <img
        className={css.noteInlineImage}
        src={url}
        alt={alt || t('noteLoadImage')}
        onError={() => {
          URL.revokeObjectURL(url)
          objectUrl.current = undefined
          setUrl(undefined)
          setStatus('failed')
        }}
      />
    )
  return (
    <span>
      <Button
        size="sm"
        disabled={status === 'pending'}
        onClick={async () => {
          if (tabSignal.aborted || request.current) return
          const controller = new AbortController()
          request.current = controller
          setStatus('pending')
          try {
            const blob = await read(controller.signal)
            if (controller.signal.aborted) return
            objectUrl.current = URL.createObjectURL(blob)
            setUrl(objectUrl.current)
            setStatus(undefined)
          } catch {
            if (!controller.signal.aborted) setStatus('failed')
          } finally {
            request.current = undefined
          }
        }}
      >
        {alt ? `${t('noteLoadImage')} · ${alt}` : t('noteLoadImage')}
      </Button>
      {status === 'failed' && <span role="status">{t('noteImage')}</span>}
    </span>
  )
}

type NoteAction =
  | Omit<Extract<ZoteroReaderWriteNoteRequest, { operation: 'create' }>, 'markdown'>
  | (Omit<Extract<ZoteroReaderWriteNoteRequest, { operation: 'edit' }>, 'edits' | 'operation'> & {
      operation: 'edit' | 'delete'
    })

export function ReaderNoteMutation({
  t,
  action,
  runs,
  signal,
  write,
  onApplied,
  onCancel,
  onReload,
  initialMarkdown,
  origin,
}: PropsLocale<'zoteroReader'> & {
  action: NoteAction
  runs?: ZoteroReaderNoteView['editableRuns']
  signal: AbortSignal
  write: ReaderTabFace['writeNote']
  onApplied: (message: string) => void
  onCancel: () => void
  onReload?: () => void
  initialMarkdown?: string
  origin?: string
}) {
  const active = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string>()
  const [markdownInvalid, setMarkdownInvalid] = useState(false)
  useEffect(() => () => active.current?.abort(), [])
  const { operation } = action
  const version = action.operation === 'create' ? undefined : action.expectedVersion
  const key = noteDraftKey(action.sessionId, action.ref, operation, origin)
  const [{ draft, retention }, setLocalDraft] = useState<{
    draft?: NoteDraft
    retention: NoteDraftRetention
  }>(
    () =>
      readNoteDraft(key) ?? {
        draft:
          operation === 'create' && initialMarkdown
            ? { fields: { markdown: initialMarkdown } }
            : undefined,
        retention: 'unavailable',
      },
  )
  useEffect(() => {
    if (!initialMarkdown || readNoteDraft(key)) return
    const retention = writeNoteDraft(key, { fields: { markdown: initialMarkdown } })
    setLocalDraft((state) => ({ ...state, retention }))
  }, [initialMarkdown, key])
  const blocked = draft?.submitted
    ? 'noteDraftUnverified'
    : draft && draft.version !== version
      ? 'noteDraftStale'
      : undefined
  const updateDraft = (next: NoteDraft | undefined) => {
    setLocalDraft({ draft: next, retention: writeNoteDraft(key, next) })
  }
  const changeField = (field: string, value: string, baseline: string, clear?: string) => {
    const fields = { ...draft?.fields }
    if (clear) delete fields[clear]
    if (value === baseline) delete fields[field]
    else fields[field] = value
    updateDraft(Object.keys(fields).length ? { version, fields } : undefined)
  }
  const label = t(
    operation === 'create' ? 'noteCreate' : operation === 'edit' ? 'noteEdit' : 'noteDelete',
  )
  const submit = async () => {
    if (active.current || locked || blocked || signal.aborted) return
    let request: ZoteroReaderWriteNoteRequest
    if (action.operation === 'create') {
      const markdown = draft?.fields.markdown?.trim()
      if (!markdown) return
      request = { ...action, markdown }
    } else if (action.operation === 'edit') {
      const edits = (runs ?? []).flatMap(({ offset, text }) => {
        const next = draft?.fields[String(offset)] ?? text
        const formatting = noteDraftFormats(draft?.fields[`format-${offset}`], next)
        return next === text && formatting.length === 0
          ? []
          : [
              {
                offset,
                text: next,
                ...(formatting.length === 1
                  ? {
                      format: formatting[0]!.format,
                      ...(formatting[0]!.range && { formatRange: formatting[0]!.range }),
                    }
                  : formatting.length > 1
                    ? { formatting }
                    : {}),
              },
            ]
      })
      if (!edits.length) {
        onCancel()
        return
      }
      request = { ...action, operation: 'edit', edits }
    } else request = { ...action, operation: 'delete' }
    const controller = new AbortController()
    const writeSignal = AbortSignal.any([signal, controller.signal])
    active.current = controller
    setPending(true)
    setError(undefined)
    if (draft) writeNoteDraft(key, { ...draft, submitted: true })
    const finishDraft = (next?: NoteDraft) => {
      const latest = readNoteDraft(key)?.draft
      if (!draft || !latest?.submitted || latest.version !== draft.version) return
      const fields = Object.entries(draft.fields)
      if (
        fields.length === Object.keys(latest.fields).length &&
        fields.every(([field, value]) => latest.fields[field] === value)
      )
        writeNoteDraft(key, next)
    }
    try {
      const result = await write(request, writeSignal)
      if (writeSignal.aborted) return
      if (result.kind === 'applied') {
        if (operation === 'delete')
          writeNoteDraft(noteDraftKey(action.sessionId, action.ref, 'edit'))
        else finishDraft()
        onApplied(result.message)
      } else {
        if (result.kind !== 'committed-unverified') finishDraft(draft)
        setError(result.message)
        setLocked(result.kind === 'committed-unverified' || result.kind === 'failed')
      }
    } catch (cause) {
      if (writeSignal.aborted) return
      setError(messageOf(cause))
      if (asRecord(remoteErrorOf(cause)?.details)?.code === 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE') {
        finishDraft(draft)
      } else setLocked(true)
    } finally {
      active.current = undefined
      if (!writeSignal.aborted) setPending(false)
    }
  }
  return (
    <form
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset disabled={pending} className={`${css.fieldset} ${css.annotationEditor}`}>
        {blocked && (
          <>
            <p role="alert">{t(blocked)}</p>
            {Object.entries(draft?.fields ?? {})
              .filter(([field]) => !field.startsWith('format-'))
              .map(([field, text], index) => (
                <label key={field} className={css.fieldLabel}>
                  {field === 'markdown' ? 'Markdown' : t('noteText', { number: index + 1 })}
                  <textarea className={css.field} readOnly value={text} />
                </label>
              ))}
          </>
        )}
        {!blocked && operation === 'create' && (
          <label className={css.fieldLabel}>
            Markdown
            <textarea
              className={css.field}
              name="markdown"
              required
              rows={6}
              value={draft?.fields.markdown ?? ''}
              readOnly={locked}
              maxLength={ZOTERO_READER_NOTE_TEXT_CHARS}
              aria-invalid={markdownInvalid || undefined}
              aria-describedby={markdownInvalid ? 'reader-note-markdown-error' : undefined}
              onInvalid={() => setMarkdownInvalid(true)}
              onChange={(event) => {
                setMarkdownInvalid(false)
                changeField('markdown', event.target.value, '')
              }}
            />
            {markdownInvalid && (
              <span id="reader-note-markdown-error" className={css.fieldError}>
                {t('noteMarkdownRequired')}
              </span>
            )}
          </label>
        )}
        {!blocked &&
          operation === 'edit' &&
          runs?.map(({ offset, text }, index) => {
            const name = String(offset)
            const inputName = `note-text-${offset}`
            const formatName = `format-${offset}`
            const value = draft?.fields[name] ?? text
            const formatting = noteDraftFormats(draft?.fields[formatName], value)
            return (
              <Fragment key={offset}>
                <label className={css.fieldLabel}>
                  {t('noteText', { number: index + 1 })}
                  <textarea
                    className={css.field}
                    name={inputName}
                    value={value}
                    readOnly={locked}
                    maxLength={ZOTERO_READER_NOTE_TEXT_CHARS}
                    onChange={(event) => {
                      const fields = { ...draft?.fields }
                      const nextText = event.target.value
                      if (nextText === text) delete fields[name]
                      else fields[name] = nextText
                      const wholeRun = formatting.filter(({ range }) => range === undefined)
                      if (wholeRun.length > 0) fields[formatName] = JSON.stringify(wholeRun)
                      else delete fields[formatName]
                      updateDraft(Object.keys(fields).length ? { version, fields } : undefined)
                    }}
                  />
                </label>
                <label className={css.fieldLabel}>
                  {t('noteFormat', { number: index + 1 })}
                  <select
                    className={css.field}
                    disabled={locked}
                    value=""
                    onChange={({ currentTarget }) => {
                      const field = currentTarget.form?.elements.namedItem(inputName)
                      const format = ZOTERO_READER_NOTE_FORMATS.find(
                        (option) => option === currentTarget.value,
                      )
                      if (!format) return
                      const range =
                        field instanceof HTMLTextAreaElement &&
                        field.selectionStart < field.selectionEnd
                          ? { start: field.selectionStart, end: field.selectionEnd }
                          : undefined
                      const same = formatting.findIndex(
                        (item) =>
                          item.format === format &&
                          item.range?.start === range?.start &&
                          item.range?.end === range?.end,
                      )
                      const next = [...formatting]
                      if (same >= 0) next.splice(same, 1)
                      else next.push({ format, ...(range && { range }) })
                      changeField(formatName, next.length > 0 ? JSON.stringify(next) : '', '')
                    }}
                  >
                    <option value="">{t('noteFormatAdd')}</option>
                    {ZOTERO_READER_NOTE_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {t(FORMAT_LABELS[format])}
                      </option>
                    ))}
                  </select>
                </label>
                {formatting.length > 0 && (
                  <div role="group" aria-label={t('noteFormatPreview', { number: index + 1 })}>
                    {noteFormattingPreview(value, formatting)}
                    {formatting.map(({ format, range }, formatIndex) => (
                      <Button
                        key={`${format}-${range?.start ?? 'all'}-${formatIndex}`}
                        size="sm"
                        type="button"
                        aria-label={`${t('noteFormatRemove')} ${t(FORMAT_LABELS[format])}`}
                        onClick={() => {
                          const next = formatting.filter((_, current) => current !== formatIndex)
                          changeField(formatName, next.length > 0 ? JSON.stringify(next) : '', '')
                        }}
                      >
                        {t(FORMAT_LABELS[format])}
                      </Button>
                    ))}
                  </div>
                )}
              </Fragment>
            )
          })}
        {operation === 'delete' && <p>{t('noteDelete')}</p>}
        {!blocked && !pending && !locked && draft && (
          <p role="status">
            {t(
              retention === 'stored'
                ? 'noteDraftKept'
                : retention === 'memory'
                  ? 'noteDraftMemory'
                  : 'noteDraftUnavailable',
            )}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={css.controls}>
          <Button size="sm" type="button" onClick={onCancel}>
            {t('cancel')}
          </Button>
          {draft && (
            <Button size="sm" type="button" onClick={() => updateDraft(undefined)}>
              {t('noteDiscardDraft')}
            </Button>
          )}
          {locked && onReload && (
            <Button size="sm" type="button" onClick={onReload}>
              {t('refresh')}
            </Button>
          )}
          <Button
            size="sm"
            variant={operation === 'delete' ? undefined : 'primary'}
            type="submit"
            disabled={locked || pending || blocked !== undefined}
          >
            {pending
              ? t('annotationSaving')
              : operation === 'delete'
                ? t('annotationDeleteConfirm')
                : t('noteSave')}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
