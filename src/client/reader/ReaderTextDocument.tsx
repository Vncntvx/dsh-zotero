import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  Input,
  MarkdownDelegateProvider,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { refFieldsOf } from '../../ref-grammar.ts'
import { remoteImageLinks } from '../remote-image-links.ts'
import { inertDocumentHtml } from './inert-document-html.tsx'
import { excerptPrefix } from './pdf-excerpt.ts'
import type { ReaderTabFace } from './ReaderTab.tsx'
import type { HistoricalTextCitation } from './historical-citations.ts'
import { renderedRange } from './rendered-range.ts'
import { searchTextNodes } from './text-search.ts'
import type { ReaderTranslationResult } from './ReaderTranslation.tsx'
import { ReaderExcerptActions, type ReaderTextSelection } from './ReaderExcerptActions.tsx'
import { IconButton } from '../components/IconButton.tsx'
import css from './reader.module.css'

type Attachment = Omit<Awaited<ReturnType<ReaderTabFace['readTextAttachment']>>, 'data'> & {
  readonly text: string
  readonly fingerprint?: string
}

interface Props extends PropsLocale<'zoteroReader'> {
  readonly refString: string
  readonly title: string
  readonly sessionId: SessionId
  readonly tabSignal: AbortSignal
  readonly citation?: Pick<HistoricalTextCitation, 'documentType' | 'textRange' | 'fingerprint'>
  readonly read: ReaderTabFace['readTextAttachment']
  readonly translate?: ReaderTabFace['translate']
  readonly inputActions?: Pick<InputActions, 'insertQuote' | 'persistDraft'>
}

export function ReaderTextDocument({
  t,
  refString,
  title,
  sessionId,
  tabSignal,
  citation,
  read,
  translate,
  inputActions,
}: Props) {
  const [attachment, setAttachment] = useState<Attachment>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [outline, setOutline] = useState<readonly HTMLElement[]>([])
  const [findQuery, setFindQuery] = useState('')
  const [findMatches, setFindMatches] = useState<readonly Range[]>([])
  const [findIndex, setFindIndex] = useState(0)
  const [findTruncated, setFindTruncated] = useState(false)
  const [citationStatus, setCitationStatus] = useState<
    | 'documentCitationUnverified'
    | 'quoteAttachmentChanged'
    | 'documentCitationMissing'
    | 'documentCitationFound'
  >()
  const body = useRef<HTMLDivElement>(null)
  const imageLabel = t('noteImage')
  const html = useMemo(
    () =>
      attachment?.format === 'html' ? inertDocumentHtml(attachment.text, imageLabel) : undefined,
    [attachment, imageLabel],
  )
  const markdown = useMemo(
    () =>
      attachment?.format === 'markdown' ? remoteImageLinks(attachment.text, imageLabel) : undefined,
    [attachment, imageLabel],
  )
  const labels = useMemo(
    () => ({
      code: { copyLabel: t('copy'), copiedLabel: t('copied') },
      footnotes: t('documentFootnotes'),
    }),
    [t],
  )

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    setFailed(false)
    setAttachment(undefined)
    const load = async () => {
      try {
        signal.throwIfAborted()
        const { data, eof, ...file } = await read(sessionId, refString, signal)
        signal.throwIfAborted()
        const text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: !eof })
        if (text.includes('\0')) throw new Error('Invalid text document.')
        const digest =
          eof && (await globalThis.crypto?.subtle?.digest('SHA-256', data).catch(() => undefined))
        signal.throwIfAborted()
        const fingerprint = digest
          ? `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
          : undefined
        setAttachment({ ...file, text, eof, fingerprint })
      } catch {
        if (!signal.aborted) setFailed(true)
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt, read, refString, sessionId, tabSignal])

  useEffect(() => {
    if (!attachment || !body.current) return
    const root = body.current
    setOutline(
      Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
        .filter((heading) => Boolean(heading.textContent?.trim()))
        .slice(0, 100),
    )
  }, [attachment, html, markdown])

  useEffect(() => {
    if (!attachment || !body.current) return
    const { ranges, truncated } = searchTextNodes(body.current, findQuery)
    setFindMatches(ranges)
    setFindIndex(0)
    setFindTruncated(truncated)
    if (ranges.length === 0) return
    const registry = globalThis.CSS?.highlights
    if (!registry || typeof Highlight !== 'function') return
    const name = 'zotero-reader-search'
    const highlight = new Highlight(...ranges)
    registry.set(name, highlight)
    return () => {
      if (registry.get(name) === highlight) registry.delete(name)
    }
  }, [attachment, findQuery, html, markdown])

  useEffect(() => {
    if (findMatches.length === 0) return
    findMatches[findIndex]?.startContainer.parentElement?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
    })
  }, [findIndex, findMatches])

  useEffect(() => {
    const range = findMatches[findIndex]
    const registry = globalThis.CSS?.highlights
    if (!range || !registry || typeof Highlight !== 'function') return
    const name = 'zotero-reader-current-search'
    const highlight = new Highlight(range)
    registry.set(name, highlight)
    return () => {
      if (registry.get(name) === highlight) registry.delete(name)
    }
  }, [findIndex, findMatches])

  useEffect(() => {
    setCitationStatus(undefined)
    const root = body.current
    if (!citation || !attachment || !root) return
    if (!citation.fingerprint || !attachment.fingerprint) {
      setCitationStatus('documentCitationUnverified')
      return
    }
    if (
      citation.fingerprint !== attachment.fingerprint ||
      citation.documentType !== attachment.format
    ) {
      setCitationStatus('quoteAttachmentChanged')
      return
    }
    const range = renderedRange(root, citation.textRange)
    if (!range) {
      setCitationStatus('documentCitationMissing')
      return
    }
    range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' })
    setCitationStatus('documentCitationFound')
    const registry = globalThis.CSS?.highlights
    if (!registry || typeof Highlight !== 'function') return
    const name = 'zotero-reader-cited-text'
    const marks = registry.get(name) ?? new Highlight()
    marks.add(range)
    registry.set(name, marks)
    return () => {
      marks.delete(range)
      if (!marks.size && registry.get(name) === marks) registry.delete(name)
    }
  }, [attachment, citation, html, markdown])

  if (failed)
    return (
      <div className={css.status}>
        <p role="alert">{t('documentReadFailed')}</p>
        <Button size="sm" onClick={() => setAttempt((previous) => previous + 1)}>
          {t('retry')}
        </Button>
      </div>
    )
  if (!attachment)
    return (
      <p role="status" className={css.status}>
        {t('documentLoading')}
      </p>
    )

  const quote = (
    selection: ReaderTextSelection,
    result?: ReaderTranslationResult,
    screenshot = false,
  ) => {
    if (!inputActions || tabSignal.aborted) return false
    const text = result
      ? `${selection.text}\n\n${t('translationResult')}\n${result.text}`
      : selection.text
    const identity = refFieldsOf(refString)
    const provenance = {
      attachmentRef: refString,
      title,
      itemRef: attachment.parentRef,
      instanceId: identity?.serverId,
      libraryRef: identity && `zotero://${identity.libraryType}/${identity.libraryId}/`,
      documentType: attachment.format,
      fingerprint: attachment.fingerprint,
      ...(selection.truncated && { excerptTruncated: true }),
      ...(result && { translation: { target: result.target, engine: result.engine } }),
      precision: 'text',
      sourceType: screenshot ? 'screenshot' : 'selection',
      textRange: { start: selection.start, end: selection.start + selection.text.length },
    }
    const draft = [
      t('quoteDocumentSource', { ref: refString }),
      text,
      selection.truncated && t('quoteBatchTruncated'),
      JSON.stringify(provenance),
    ]
      .filter(Boolean)
      .join('\n\n')
    const label = t(result ? 'translationQuote' : screenshot ? 'documentCapture' : 'quote')
    if (!inputActions.insertQuote(draft, { title, label, body: text })) return false
    inputActions.persistDraft()
    return true
  }

  const moveFind = (backwards: boolean) => {
    if (findMatches.length === 0) return
    setFindIndex(
      (current) => (current + findMatches.length + (backwards ? -1 : 1)) % findMatches.length,
    )
  }

  return (
    <section aria-label={title} className={`${css.reader} ${css.standaloneNote}`}>
      <h2 className={css.detailsTitle}>{title}</h2>
      {(!attachment.eof || html?.truncated) && <p role="status">{t('documentPartial')}</p>}
      {citationStatus && <p role="status">{t(citationStatus)}</p>}
      <form
        className={css.findForm}
        role="search"
        aria-label={t('documentFind')}
        onSubmit={(event) => {
          event.preventDefault()
          moveFind(false)
        }}
      >
        <Input
          className={css.findSeat}
          type="search"
          aria-label={t('documentFind')}
          placeholder={t('documentFind')}
          value={findQuery}
          onChange={(event) => setFindQuery(event.target.value)}
        />
        <IconButton
          shape="square"
          icon={<IconChevronUpOutlineRegular size={14} />}
          aria-label={t('findPrevious')}
          disabled={findMatches.length === 0}
          onClick={() => moveFind(true)}
        />
        <IconButton
          shape="square"
          icon={<IconChevronDownOutlineRegular size={14} />}
          aria-label={t('findNext')}
          disabled={findMatches.length === 0}
          onClick={() => moveFind(false)}
        />
        {findQuery.trim() && (
          <span className={css.meta} role="status" aria-live="polite">
            {findMatches.length === 0
              ? t('documentFindNoResults')
              : findTruncated
                ? t('documentFindManyResults', { count: findMatches.length })
                : t('documentFindResults', {
                    current: findIndex + 1,
                    total: findMatches.length,
                  })}
          </span>
        )}
      </form>
      {outline.length > 0 && (
        <details className={css.disclosure}>
          <summary>{t('outline')}</summary>
          <ul className={css.annotationList}>
            {outline.map((heading, index) => (
              <li key={index}>
                <Button size="sm" onClick={() => heading.scrollIntoView({ block: 'start' })}>
                  {excerptPrefix(heading.textContent ?? '', 200)}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ReaderExcerptActions
        t={t}
        body={body}
        title={title}
        tabSignal={tabSignal}
        translate={
          translate && ((text, target, signal) => translate({ sessionId, text, target }, signal))
        }
        onQuote={inputActions && quote}
      />
      <div ref={body} className={css.documentText}>
        {html ? (
          html.nodes
        ) : markdown === undefined ? (
          <pre>{attachment.text}</pre>
        ) : (
          <MarkdownDelegateProvider>
            <MarkdownText text={markdown} labels={labels} omitHtml />
          </MarkdownDelegateProvider>
        )}
      </div>
    </section>
  )
}
