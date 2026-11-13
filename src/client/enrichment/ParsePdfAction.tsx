/**
 * The item-level parse action, state-aware: one button beside "Read PDF" that
 * submits a parse while no artifact exists, and reads the committed artifact
 * once one does. The result opens in a reader over the panel rather than
 * adding a row to the attachment list.
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
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroParseTargetView,
} from '../../contract.ts'
import { downloadBlob } from '../download.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { IconButton } from '../components/IconButton.tsx'
import css from './parse.module.css'

/** The metadata-and-page read, bound to one session by the composition root. */
export type ParsedArtifactReader = (
  request: ZoteroDocumentArtifactRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroDocumentArtifactResultView>>

export interface ParsePdfActionProps {
  readonly t: TranslateNS<'zotero'>
  readonly sessionId: string
  readonly target: ZoteroParseTargetView
  readonly title: string
  /** Absent without enrichment read access: the action stays a plain submit. */
  readonly read?: ParsedArtifactReader
  /** Bumped after a parse finishes so the probe re-reads the store. */
  readonly revision?: number
  /** Opens the submit form; the reader's own "parse again" uses it too. */
  readonly onParse: () => void
}

type Probe =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly pageCount?: number }
  | { readonly kind: 'absent' }

/**
 * One action, two states. The artifact probe is a read-only metadata call on
 * open; it never submits, resumes, or uploads anything.
 */
export function ParsePdfAction({
  t,
  sessionId,
  target,
  title,
  read,
  revision = 0,
  onParse,
}: ParsePdfActionProps) {
  const [probe, setProbe] = useState<Probe>({ kind: 'loading' })
  const [readerOpen, setReaderOpen] = useState(false)
  const epoch = useRef(0)
  const targetKey = JSON.stringify(target)

  useEffect(() => {
    if (read === undefined) return setProbe({ kind: 'absent' })
    const current = ++epoch.current
    setProbe({ kind: 'loading' })
    const abort = new AbortController()
    void read({ sessionId, target }, abort.signal).then(
      (result) => {
        if (current !== epoch.current) return
        if (!result.ok) return setProbe({ kind: 'absent' })
        const value = result.value
        if (value.kind !== 'ready') return setProbe({ kind: 'absent' })
        setProbe({
          kind: 'ready',
          ...(value.pageCount !== undefined ? { pageCount: value.pageCount } : {}),
        })
      },
      () => {
        // An unreadable probe falls back to the submit action; it never turns
        // into an error banner beside "Read PDF".
        if (current === epoch.current) setProbe({ kind: 'absent' })
      },
    )
    return () => {
      epoch.current++
      abort.abort()
    }
    // `targetKey` stands in for the object identity the wire compares.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, sessionId, targetKey, revision])

  const ready = probe.kind === 'ready'
  return (
    <>
      {/* The host's only high-contrast filled family. "Read PDF" beside it is
       * `outline`, so the two stay distinguishable without inventing colours. */}
      <Button
        variant="primary"
        size="sm"
        icon={ready ? <IconDeliverDocRegular size={14} /> : <IconSparkleRegular size={14} />}
        disabled={probe.kind === 'loading'}
        aria-label={
          ready ? t('libraryParsedResultNamed', { title }) : t('libraryParsePdfNamed', { title })
        }
        onClick={() => (ready ? setReaderOpen(true) : onParse())}
      >
        {t(ready ? 'libraryParsedView' : 'libraryParsePdf')}
      </Button>
      {ready && read !== undefined && (
        <ParsedArtifactReader
          open={readerOpen}
          onClose={() => setReaderOpen(false)}
          t={t}
          sessionId={sessionId}
          target={target}
          title={title}
          read={read}
          {...(probe.pageCount !== undefined ? { pageCount: probe.pageCount } : {})}
          onReparse={() => {
            setReaderOpen(false)
            onParse()
          }}
        />
      )}
    </>
  )
}

/** The reading surface: one bounded page at a time, complete text to copy or download. */
function ParsedArtifactReader({
  open,
  onClose,
  t,
  sessionId,
  target,
  title,
  read,
  pageCount,
  onReparse,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly t: TranslateNS<'zotero'>
  readonly sessionId: string
  readonly target: ZoteroParseTargetView
  readonly title: string
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
    () => ({ sessionId, target }) satisfies ZoteroDocumentArtifactRequestView,
    [sessionId, target],
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
    if (!open) return
    setText('')
    setTotal(0)
    setError('')
    void load(0, '')
    return () => {
      epoch.current++
    }
  }, [open, load])

  const complete = status === 'ready' && text.length >= total
  const fileName = `${title.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'parsed'}.md`
  return (
    <Modal open={open} onClose={onClose} title={title} headless>
      <section className={css.reader} aria-labelledby={titleId}>
        <header className={css.readerHeader}>
          <h2 id={titleId} className={css.title}>
            {t('libraryParsedResultNamed', { title })}
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
