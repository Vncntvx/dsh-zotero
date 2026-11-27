import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import { refFieldsOf } from '../../ref-grammar.ts'
import {
  turnCitations,
  type HistoricalCitation,
  type HistoricalPdfCitation,
} from './historical-citations.ts'
import { resultNoteMarkdown, turnAnswer } from './turn-result-note.ts'
import type { ReaderNoteMutation } from './ReaderNote.tsx'
import css from './reader.module.css'

interface ResultNoteEditor {
  readonly ref: string
  readonly title: string
  readonly Editor: typeof ReaderNoteMutation
  readonly t: TranslateNS<'zoteroReader'>
  readonly write: Parameters<typeof ReaderNoteMutation>[0]['write']
}

type Props = PropsRuntime<'conversation.chat.turnTail'> &
  PropsLocale<'zoteroReaderShell'> &
  InjectFace<{
    readonly openCitation: (
      sessionId: SessionId,
      citation: HistoricalCitation,
      signal: AbortSignal,
    ) => Promise<boolean>
    readonly prepareNote?: (
      sessionId: SessionId,
      citation: HistoricalPdfCitation,
      signal: AbortSignal,
    ) => Promise<ResultNoteEditor | undefined>
  }>

export function ReaderTurnCitations({
  t,
  turn,
  seq,
  sessionId,
  useChat,
  useRemoteAccess,
  useAccess,
  openCitation,
  prepareNote,
}: Props) {
  const canResolve = useRemoteAccess('zotero/resolveAttachment')
  const canRead = useAccess('workspaceFiles/readBytes')
  const canReadNote = useRemoteAccess('zotero/readerNote')
  const canReadParsed = useAccess('zotero/documentArtifact')
  const canReadDetails = useRemoteAccess('zotero/readerDetails')
  const canWriteNote = useRemoteAccess('zotero/readerWriteNote')
  const answer = useChat((snapshot) => turnAnswer(snapshot, turn.turn, seq))
  const sources = useChat(
    (snapshot) => turnCitations(snapshot, turn.turn),
    (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
  )
  const request = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const noteRequest = useRef<AbortController>()
  const [note, setNote] = useState<{
    readonly editor: ResultNoteEditor
    readonly markdown: string
    readonly signal: AbortSignal
  }>()
  const [preparingNote, setPreparingNote] = useState(false)
  const [noteMessage, setNoteMessage] = useState<string>()
  useEffect(() => {
    setPending(false)
    setFailed(false)
    return () => {
      request.current?.abort()
      request.current = undefined
    }
  }, [canResolve, canRead, canReadNote, canReadParsed, sessionId, turn.turn])
  useEffect(() => {
    setPreparingNote(false)
    setNote(undefined)
    setNoteMessage(undefined)
    return () => {
      noteRequest.current?.abort()
      noteRequest.current = undefined
    }
  }, [canResolve, canReadDetails, canWriteNote, sessionId, turn.turn, seq])

  const readable = sources.filter((citation) =>
    'artifactId' in citation
      ? canReadParsed
      : 'noteRef' in citation
        ? canReadNote
        : canResolve && canRead,
  )
  if (readable.length === 0) return null
  const onlyPdf = readable.every(
    (citation) => !('noteRef' in citation) && !('textRange' in citation),
  )
  const open = async (citation: HistoricalCitation) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setFailed(false)
    try {
      const opened = await openCitation(sessionId, citation, controller.signal)
      if (!controller.signal.aborted) setFailed(!opened)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setPending(false)
      }
    }
  }
  const saveResult = async (citation: HistoricalPdfCitation) => {
    if (!prepareNote || !answer || noteRequest.current) return
    const controller = new AbortController()
    noteRequest.current = controller
    setPreparingNote(true)
    setNoteMessage(undefined)
    let prepared = false
    try {
      const editor = await prepareNote(sessionId, citation, controller.signal)
      if (controller.signal.aborted) return
      if (editor) {
        prepared = true
        setNote({
          editor,
          markdown: resultNoteMarkdown(answer, citation),
          signal: controller.signal,
        })
      } else setNoteMessage(t('turnResultNoteUnavailable'))
    } catch {
      if (!controller.signal.aborted) setNoteMessage(t('turnResultNoteUnavailable'))
    } finally {
      if (!controller.signal.aborted) setPreparingNote(false)
      if (!prepared && noteRequest.current === controller) noteRequest.current = undefined
    }
  }
  const closeNote = () => {
    noteRequest.current?.abort()
    noteRequest.current = undefined
    setNote(undefined)
  }
  return (
    <details className={css.disclosure}>
      <summary>
        {t(onlyPdf ? 'turnCitations' : 'turnReaderCitations', { count: readable.length })}
      </summary>
      <ul>
        {readable.map((citation, index) => {
          const pdf = !('noteRef' in citation) && !('textRange' in citation) ? citation : undefined
          const ref = pdf && refFieldsOf(pdf.attachmentRef)
          return (
            <li key={index}>
              <Button size="sm" disabled={pending} onClick={() => void open(citation)}>
                {pdf?.position
                  ? t('turnCitationPage', {
                      title: citation.title,
                      page: pdf.position.pageIndex + 1,
                    })
                  : citation.title}
              </Button>
              {pdf &&
                prepareNote &&
                answer &&
                canReadDetails &&
                canWriteNote &&
                ref?.libraryType === 'user' &&
                Number(ref.libraryId) === 0 && (
                  <Button
                    size="sm"
                    disabled={preparingNote || !!note}
                    onClick={() => void saveResult(pdf)}
                  >
                    {t('turnResultNote')}
                  </Button>
                )}
            </li>
          )
        })}
      </ul>
      {failed && <p role="status">{t('unavailable')}</p>}
      {note && canReadDetails && canWriteNote && (
        <section aria-label={note.editor.title}>
          <p>{note.editor.title}</p>
          <note.editor.Editor
            t={note.editor.t}
            action={{ sessionId, ref: note.editor.ref, operation: 'create' }}
            origin={`turn-${turn.turn}-${seq}`}
            initialMarkdown={note.markdown}
            signal={note.signal}
            write={note.editor.write}
            onApplied={(message) => {
              setNoteMessage(message)
              closeNote()
            }}
            onCancel={closeNote}
          />
        </section>
      )}
      {noteMessage && <p role="status">{noteMessage}</p>}
    </details>
  )
}
