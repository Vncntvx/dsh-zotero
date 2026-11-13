/**
 * The item-level parse action, state-aware: one button that submits a parse
 * while no artifact exists and reads the committed artifact once one does. An
 * item carrying several PDFs asks which one first, then reports that
 * attachment's own state; the result opens in a reader over the panel rather
 * than adding a row to the attachment list.
 * @module dsh-zotero/client/enrichment/ParsePdfAction
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCloseOutlineRegular,
  IconDeliverDocRegular,
  IconSparkleRegular,
  MarkdownText,
  Modal,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAttachmentRowView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../../contract.ts'
import { downloadBlob } from '../download.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { PdfPickerDialog } from '../components/PdfPickerDialog.tsx'
import css from './parse.module.css'

/** The metadata-and-page read, bound to one session by the composition root. */
export type ParsedArtifactReader = (
  request: ZoteroDocumentArtifactRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroDocumentArtifactResultView>>

export interface ParsePdfActionProps {
  readonly t: TranslateNS<'zotero'>
  readonly sessionId: string
  /** The item's PDF attachments, Zotero's best choice first. */
  readonly attachments: readonly ZoteroAttachmentRowView[]
  /** Absent without enrichment read access: the action stays a plain submit. */
  readonly read?: ParsedArtifactReader
  /** Bumped after a parse finishes so the probe re-reads the store. */
  readonly revision?: number
  /** Opens the submit form for one attachment. */
  readonly onParse: (attachment: ZoteroAttachmentRowView) => void
}

/** One attachment's committed-artifact answer. */
type Probe = { readonly kind: 'ready'; readonly pageCount?: number } | { readonly kind: 'absent' }

/**
 * One action, two states. The artifact probes are read-only metadata calls on
 * open; they never submit, resume, or upload anything.
 */
export function ParsePdfAction({
  t,
  sessionId,
  attachments,
  read,
  revision = 0,
  onParse,
}: ParsePdfActionProps) {
  const [probes, setProbes] = useState<ReadonlyMap<string, Probe>>()
  const [picking, setPicking] = useState(false)
  const [reading, setReading] = useState<ZoteroAttachmentRowView>()
  const epoch = useRef(0)
  const attachmentKey = attachments.map((attachment) => attachment.ref).join('\n')
  const primary = attachments[0]

  useEffect(() => {
    if (read === undefined) return setProbes(new Map())
    const current = ++epoch.current
    setProbes(undefined)
    const abort = new AbortController()
    void Promise.all(
      attachments.map(async (attachment): Promise<Probe> => {
        try {
          const result = await read(
            { sessionId, target: { kind: 'attachment', ref: attachment.ref } },
            abort.signal,
          )
          if (!result.ok || result.value.kind !== 'ready') return { kind: 'absent' }
          const value = result.value
          return {
            kind: 'ready',
            ...(value.pageCount !== undefined ? { pageCount: value.pageCount } : {}),
          }
        } catch {
          // An unreadable probe is absence, never an error banner beside
          // "Read PDF": the action stays available as a submit.
          return { kind: 'absent' }
        }
      }),
    ).then((answers) => {
      if (current !== epoch.current) return
      setProbes(new Map(attachments.map((attachment, index) => [attachment.ref, answers[index]!])))
    })
    return () => {
      epoch.current++
      abort.abort()
    }
    // `attachmentKey` stands in for the array identity the wire compares.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, sessionId, attachmentKey, revision])

  if (primary === undefined) return null
  const ready = attachments.some((attachment) => probes?.get(attachment.ref)?.kind === 'ready')
  const only = attachments.length === 1
  const readingProbe = reading === undefined ? undefined : probes?.get(reading.ref)
  const pageCount = readingProbe?.kind === 'ready' ? readingProbe.pageCount : undefined
  const open = () => {
    // A single PDF acts directly; several ask which one, in the same shape the
    // read action uses, because the state differs per attachment.
    if (!only) return setPicking(true)
    if (ready) return setReading(primary)
    onParse(primary)
  }

  return (
    <>
      {/* The host's only high-contrast filled family. "Read PDF" beside it is
       * the same family, so the two stay distinguishable without inventing
       * colours. */}
      <Button
        variant="primary"
        size="sm"
        icon={ready ? <IconDeliverDocRegular size={14} /> : <IconSparkleRegular size={14} />}
        disabled={probes === undefined}
        aria-label={
          only
            ? t(ready ? 'libraryParsedResultNamed' : 'libraryParsePdfNamed', {
                title: primary.title,
              })
            : undefined
        }
        onClick={open}
      >
        {t(ready ? 'libraryParsedView' : only ? 'libraryParsePdf' : 'libraryParsePdfAny')}
      </Button>
      {!only && (
        <PdfPickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          t={t}
          title={t('libraryPickPdf')}
          options={attachments.map((attachment) => {
            const parsed = probes?.get(attachment.ref)?.kind === 'ready'
            return {
              key: attachment.ref,
              title: attachment.title,
              action: t(parsed ? 'libraryParsedView' : 'libraryParsePdfAny'),
              onSelect: () => {
                setPicking(false)
                if (parsed) setReading(attachment)
                else onParse(attachment)
              },
            }
          })}
        />
      )}
      {reading !== undefined && read !== undefined && (
        <ParsedArtifactReader
          // One reader per attachment: switching files starts from page one.
          key={reading.ref}
          onClose={() => setReading(undefined)}
          t={t}
          sessionId={sessionId}
          attachment={reading}
          read={read}
          {...(pageCount !== undefined ? { pageCount } : {})}
          onReparse={() => {
            setReading(undefined)
            onParse(reading)
          }}
        />
      )}
    </>
  )
}

/** The reading surface: one bounded page at a time, complete text to copy or download. */
function ParsedArtifactReader({
  onClose,
  t,
  sessionId,
  attachment,
  read,
  pageCount,
  onReparse,
}: {
  readonly onClose: () => void
  readonly t: TranslateNS<'zotero'>
  readonly sessionId: string
  readonly attachment: ZoteroAttachmentRowView
  readonly read: ParsedArtifactReader
  readonly pageCount?: number
  readonly onReparse: () => void
}) {
  const [text, setText] = useState('')
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const titleId = useId()
  const labels = useMemo<MarkdownLabels>(
    () => ({
      code: { copyLabel: t('libraryParsedCopyCode'), copiedLabel: t('libraryParsedCopiedCode') },
      footnotes: t('libraryParsedFootnotes'),
    }),
    [t],
  )
  const request = useMemo(
    () =>
      ({
        sessionId,
        target: { kind: 'attachment', ref: attachment.ref },
      }) satisfies ZoteroDocumentArtifactRequestView,
    [sessionId, attachment.ref],
  )

  const load = useCallback(
    async (offset: number, previous: string) => {
      const current = ++epoch.current
      setStatus('loading')
      try {
        const result = await read({ ...request, read: { offset } })
        if (current !== epoch.current) return
        if (!result.ok) {
          setError(result.error.message)
          setStatus('error')
          return
        }
        const value = result.value
        if (value.kind !== 'ready' || value.page === undefined) {
          setError(t('libraryParsedNoPage'))
          setStatus('error')
          return
        }
        if (value.page.offset !== previous.length) {
          setError(t('libraryParsedNoPage'))
          setStatus('error')
          return
        }
        setText(previous + value.page.text)
        setTotal(value.page.totalChars)
        setStatus('ready')
      } catch (cause) {
        if (current !== epoch.current) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setStatus('error')
      }
    },
    [read, request, t],
  )

  // Every open starts from the first page; a closed reader drops its pages.
  useEffect(() => {
    void load(0, '')
    return () => {
      epoch.current++
    }
  }, [load])

  const complete = status === 'ready' && text.length >= total
  const fileName = `${attachment.title.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'parsed'}.md`
  return (
    <Modal open onClose={onClose} title={attachment.title} headless>
      <section className={css.reader} aria-labelledby={titleId}>
        <header className={css.readerHeader}>
          <h2 id={titleId} className={css.title}>
            {t('libraryParsedResultNamed', { title: attachment.title })}
          </h2>
          <IconButton
            icon={<IconCloseOutlineRegular />}
            aria-label={t('parseClose')}
            onClick={onClose}
            type="button"
          />
        </header>
        <div className={css.readerBody}>
          <p className={css.secondary}>
            {t('libraryParsedChars', { loaded: text.length, total })}
            {pageCount !== undefined && ` · ${t('libraryParsedPages', { count: pageCount })}`}
          </p>
          {status === 'loading' && text === '' ? (
            <p role="status">{t('libraryParsedLoading')}</p>
          ) : status === 'error' ? (
            <p role="alert" className={css.error}>
              {error}
            </p>
          ) : (
            <div className={css.readerMarkdown}>
              <MarkdownText text={text} labels={labels} />
            </div>
          )}
        </div>
        <footer className={css.readerActions}>
          {!complete && status !== 'error' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(text.length, text)}
            >
              {t('libraryParsedReadMore')}
            </Button>
          )}
          <CopyButton
            value={text}
            label={t('libraryParsedCopy')}
            copiedLabel={t('libraryParsedCopied')}
            disabled={!complete}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!complete}
            onClick={() => downloadBlob(text, fileName, 'text/markdown;charset=utf-8')}
          >
            {t('libraryParsedDownload')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onReparse}>
            {t('libraryParsedReparse')}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}
