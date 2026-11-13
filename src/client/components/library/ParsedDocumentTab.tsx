/**
 * The parsed-document page: one right-sidebar tab per parsed PDF. It reads the
 * artifact in bounded pages as soon as it opens — no manual paging — renders the
 * whole Markdown, and turns a text selection into one instruction the composer
 * carries, so the model explains the passage in place.
 * @module dsh-zotero/client/components/library/ParsedDocumentTab
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconSparkleRegular,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroItemDetailView,
  ZoteroLibraryItemRequestView,
} from '../../../contract.ts'
import { downloadBlob } from '../../download.ts'
import { parsedDisplayMarkdown } from '../../parsed-markdown.ts'
import { parseParsedTabAddress, type ParsedTabTarget } from '../../parsed-tab.ts'
import {
  useDocumentParseSurface,
  type DocumentParseSurfacePort,
} from '../../enrichment/parse-surface.tsx'
import { itemInfoTextOf } from './LibraryCitationActions.tsx'
import { IconButton } from '../IconButton.tsx'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import css from './parsed-document.module.css'

/** The metadata-and-page read the composition root supplies. */
export type ParsedArtifactRead = (
  request: ZoteroDocumentArtifactRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroDocumentArtifactResultView>>

/** What the page needs from the client registration. */
export interface ParsedDocumentTabFace {
  readonly read: ParsedArtifactRead
  /** The item detail an explanation cites; absent without the item grant. */
  readonly item?: (
    request: ZoteroLibraryItemRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  /** The parse surface: a result page can ask for a fresh parse of its own PDF. */
  readonly parse?: DocumentParseSurfacePort
}

export type ParsedDocumentTabProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<ParsedDocumentTabFace> &
  PropsLocale<'zotero'>

/**
 * Pages one document may fetch in a single pass. The cap bounds a pathological
 * artifact; reaching it leaves a "read more" action rather than a frozen tab.
 */
const PAGE_BUDGET = 64

/** Figures fetched per document page's references; past it, alt text stays. */
const FIGURE_BUDGET = 64

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly message: string }

/** The parsed document of one attachment, read end to end by the tab. */
export function ParsedDocumentTab(props: ParsedDocumentTabProps) {
  const address = props.useTabInfo?.()?.tab.navigation.address ?? ''
  const target = useMemo(() => parseParsedTabAddress(address), [address])
  // An address this page does not own carries no document: there is nothing to
  // read and nothing to reload.
  if (target === undefined) {
    return (
      <section className={css.surface}>
        <div className={css.body}>
          <p className={css.status}>{props.t('parsedUnavailable')}</p>
        </div>
      </section>
    )
  }
  return <ParsedDocumentView {...props} target={target} />
}

/** One parsed document, its target already resolved. */
function ParsedDocumentView(props: ParsedDocumentTabProps & { readonly target: ParsedTabTarget }) {
  const { t, read, item, inputActions, parse, target } = props
  const tabInfo = props.useTabInfo?.()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [text, setText] = useState('')
  const [total, setTotal] = useState(0)
  const [pageCount, setPageCount] = useState<number>()
  const [label, setLabel] = useState('')
  /** The selection menu: one instruction for the passage it points at. */
  const [menu, setMenu] = useState<{ text: string; left: number; top: number }>()
  const [insertError, setInsertError] = useState<string>()
  /** Authored figure reference → object URL of the bytes the artifact carries. */
  const [figures, setFigures] = useState<ReadonlyMap<string, string>>(new Map())
  const figureAttempts = useRef(new Set<string>())
  const figureUrls = useRef(new Set<string>())
  const copy = useCopyFeedback(menu?.text, menu?.text)
  const documentRef = useRef<HTMLDivElement>(null)
  const escape = useRef<AbortController>(new AbortController())
  // One pass at a time: a reload pressed mid-flight retires the older walk.
  const epoch = useRef(0)
  const titleId = useId()
  const labels = useMemo(
    () => ({
      code: { copyLabel: t('libraryParsedCopyCode'), copiedLabel: t('libraryParsedCopiedCode') },
      footnotes: t('libraryParsedFootnotes'),
    }),
    [t],
  )

  // A result page owns its own re-parse entry: the same dialog the panel opens,
  // over the same shared port, so the target and mode are confirmed again.
  const parseSurface = useDocumentParseSurface(
    parse,
    {
      sessionId: props.sessionId,
      sessionAllowed: !props.useSession((snapshot) => snapshot.removed),
      startAllowed: props.useAccess('zotero/startDocumentParse'),
      readAllowed:
        props.useAccess('zotero/documentArtifact') &&
        props.useAccess('zotero/documentParseReceipt') &&
        props.useAccess('job/list') &&
        props.useAccess('job/follow'),
      cancelAllowed: props.useAccess('job/kill'),
    },
    t,
  )

  /**
   * Read from `offset` until the document ends or the per-pass budget runs out,
   * publishing each page as it lands so the tab fills in while it loads. A
   * rejected read settles the page as failed; nothing escapes the call.
   */
  const load = useCallback(
    async (document: ParsedTabTarget, offset: number, previous: string, signal: AbortSignal) => {
      const current = ++epoch.current
      let loaded = previous
      // The page count rides the metadata each page echoes; the first answer
      // that carries one wins, and it never depends on React state here.
      let carried: number | undefined
      try {
        for (let page = 0; page < PAGE_BUDGET; page++) {
          const result = await read(
            {
              sessionId: document.sessionId,
              target: { kind: 'attachment', ref: document.ref },
              read: { offset },
            },
            signal,
          )
          if (signal.aborted || current !== epoch.current) return
          if (!result.ok) {
            setState({ kind: 'failed', message: result.error.message })
            return
          }
          const value = result.value
          if (value.kind !== 'ready') {
            setState({ kind: 'unavailable' })
            return
          }
          if (value.page === undefined || value.page.offset !== loaded.length) {
            setState({ kind: 'failed', message: t('libraryParsedNoPage') })
            return
          }
          loaded += value.page.text
          offset = loaded.length
          carried = value.pageCount ?? carried
          setText(loaded)
          setTotal(value.page.totalChars)
          setPageCount(carried)
          setLabel(value.targetLabel)
          // A page that does not advance the offset ends the pass as well: the
          // artifact is malformed rather than merely long.
          if (loaded.length >= value.page.totalChars || value.page.text === '') break
        }
        if (current === epoch.current) setState({ kind: 'ready' })
      } catch (cause) {
        if (signal.aborted || current !== epoch.current) return
        setState({
          kind: 'failed',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    },
    [read, t],
  )

  /** Start over from the first page: the tab refresh command and the button share it. */
  const reload = useCallback(() => {
    void load(target, 0, '', escape.current.signal)
  }, [load, target])

  useEffect(() => {
    const abort = new AbortController()
    escape.current = abort
    setState({ kind: 'loading' })
    setText('')
    setTotal(0)
    setPageCount(undefined)
    setLabel('')
    setMenu(undefined)
    setInsertError(undefined)
    void load(target, 0, '', abort.signal)
    return () => abort.abort()
  }, [load, target])

  // The tab's own refresh command re-reads the artifact from the first page.
  useEffect(() => {
    const actions = tabInfo?.tab.actions
    if (actions === undefined) return
    return actions.bindCommands({ refresh: reload })
  }, [tabInfo?.tab.actions, reload])

  // A selection inside the document raises its own menu where the user made
  // it: one instruction (explain) or the clipboard (copy). Anywhere else in the
  // pane, and as soon as the text unselects, the menu is gone.
  useEffect(() => {
    const update = () => {
      const current = window.getSelection()
      const node = current?.anchorNode ?? null
      const inside =
        current !== null &&
        current.rangeCount > 0 &&
        !current.isCollapsed &&
        node !== null &&
        documentRef.current?.contains(node) === true
      const text = inside ? current.toString().trim() : ''
      if (!inside || text === '') {
        setMenu(undefined)
        return
      }
      const rect = current.getRangeAt(0).getBoundingClientRect()
      setMenu({
        text,
        left: Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - 264, 8)),
        top: Math.min(rect.bottom + 6, Math.max(window.innerHeight - 56, 8)),
      })
    }
    window.document.addEventListener('selectionchange', update)
    return () => window.document.removeEventListener('selectionchange', update)
  }, [])

  // The menu points at a screen position: scrolling or resizing retires it.
  useEffect(() => {
    const hide = () => setMenu(undefined)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  /**
   * One instruction: the passage, then the paper it belongs to and the item
   * ref, so the model can judge the passage in the paper's context and read
   * the rest of it through the read tools.
   */
  const explain = (text: string) => {
    if (inputActions === undefined) return
    const actions = inputActions
    const document = target
    void (async () => {
      const detail =
        document.item === undefined || item === undefined
          ? undefined
          : await item({ ref: document.item, include: [] }, escape.current.signal)
              .then((result) => (result.ok ? result.value : undefined))
              .catch(() => undefined)
      if (escape.current.signal.aborted) return
      const instruction = [
        t('parsedExplainPrompt'),
        text,
        detail === undefined ? displayTitle : itemInfoTextOf(detail),
        document.item ?? '',
      ]
        .filter((line) => line !== '')
        .join('\n\n')
      if (actions.insertQuote(instruction)) {
        actions.persistDraft()
        setInsertError(undefined)
        window.getSelection()?.removeAllRanges()
        setMenu(undefined)
      } else setInsertError(t('libraryInsertFailed'))
    })()
  }

  // Figures load beside the text: each reference the artifact carries becomes
  // one object URL the renderer can draw; a miss keeps the authored alt text.
  const figureRefs = useMemo(() => {
    const names = new Set<string>()
    for (const match of text.matchAll(/!\[[^\]]*\]\((images\/[^)\s]+)\)/gu)) names.add(match[1]!)
    return [...names]
  }, [text])

  useEffect(() => {
    const signal = escape.current.signal
    const pending = figureRefs
      .filter((name) => !figureAttempts.current.has(name))
      .slice(0, FIGURE_BUDGET)
    if (pending.length === 0) return
    for (const name of pending) figureAttempts.current.add(name)
    let cancelled = false
    void (async () => {
      for (const name of pending) {
        const result = await read(
          {
            sessionId: target.sessionId,
            target: { kind: 'attachment', ref: target.ref },
            image: { name },
          },
          signal,
        )
        if (cancelled || signal.aborted) return
        if (!result.ok || result.value.kind !== 'image') continue
        const value = result.value
        const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: value.mediaType }))
        figureUrls.current.add(url)
        setFigures((previous) => new Map(previous).set(name, url))
      }
    })().catch(() => {
      // A rejected figure read leaves the reference unresolved: the renderer
      // then shows the authored caption, exactly as for a name not stored.
    })
  }, [figureRefs, read, target.sessionId, target.ref])

  // Object URLs live as long as this tab; the browser holds their bytes.
  useEffect(
    () => () => {
      for (const url of figureUrls.current) URL.revokeObjectURL(url)
      figureUrls.current.clear()
    },
    [],
  )

  const pathImages = useMemo(
    () => ({
      resolve: (value: string) => figures.get(value.replace(/^\.\//u, '')),
    }),
    [figures],
  )

  // The artifact is complete only once every announced character arrived.
  const complete = state.kind === 'ready' && text.length >= total
  const title = target.title !== '' ? target.title : label
  const displayTitle = title === '' ? t('tabParsedFallback') : title
  const fileName = `${(title || 'parsed').replace(/[^\p{L}\p{N}_.-]+/gu, '_')}.md`
  const display = useMemo(() => parsedDisplayMarkdown(text), [text])

  const copyDocument = useCopyFeedback(text, text)
  return (
    <section className={css.surface} aria-labelledby={titleId}>
      {/* One row under the pane's strip: the paper, its figures of size, then
       * this page's controls — the shape the host's own document preview uses. */}
      <header className={css.toolbar}>
        <div className={css.heading}>
          <h2 id={titleId} className={css.title} title={displayTitle}>
            {displayTitle}
          </h2>
          <span className={css.meta}>
            {t('libraryParsedChars', { loaded: text.length, total })}
            {pageCount !== undefined && ` · ${t('libraryParsedPages', { count: pageCount })}`}
          </span>
        </div>
        <div className={css.tools}>
          <IconButton
            icon={
              copyDocument.phase === 'done' ? (
                <IconCheckOutlineRegular size={14} />
              ) : (
                <IconCopyOutlineRegular size={14} />
              )
            }
            aria-label={
              copyDocument.phase === 'done' ? t('libraryParsedCopied') : t('libraryParsedCopy')
            }
            title={t('libraryParsedCopy')}
            disabled={!complete}
            onClick={() => copyDocument.copyText(text)}
          />
          <IconButton
            icon={<IconDownloadOutlineRegular size={14} />}
            aria-label={t('libraryParsedDownload')}
            title={t('libraryParsedDownload')}
            disabled={!complete}
            onClick={() => downloadBlob(text, fileName, 'text/markdown;charset=utf-8')}
          />
          {parseSurface.openAttachment !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<IconSparkleRegular size={14} />}
              aria-label={t('libraryParsedReparse')}
              title={t('libraryParsedReparse')}
              onClick={() =>
                parseSurface.openAttachment?.({
                  ref: target.ref,
                  // The dialog names the attachment being sent; the artifact's
                  // own label is that name, while the tab is named by the paper.
                  title: label !== '' ? label : displayTitle,
                  contentType: 'application/pdf',
                })
              }
            >
              <span className={css.actionLabel}>{t('libraryParsedReparse')}</span>
            </Button>
          )}
          <IconButton
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={t('parsedReload')}
            title={t('parsedReload')}
            onClick={reload}
          />
        </div>
      </header>
      {insertError !== undefined && (
        <p role="alert" className={css.banner}>
          {insertError}
        </p>
      )}
      <div className={css.body} ref={documentRef}>
        {state.kind === 'failed' ? (
          <p role="alert" className={css.error}>
            {state.message}
          </p>
        ) : state.kind === 'unavailable' ? (
          <p className={css.status}>{t('parsedUnavailable')}</p>
        ) : text !== '' ? (
          <>
            <MarkdownText text={display} labels={labels} pathImages={pathImages} />
            {!complete && state.kind === 'ready' && (
              <p className={css.more}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void load(target, text.length, text, escape.current.signal)}
                >
                  {t('libraryParsedReadMore')}
                </Button>
              </p>
            )}
          </>
        ) : state.kind === 'loading' ? (
          <p className={css.status} role="status">
            {t('libraryParsedLoading')}
          </p>
        ) : null}
      </div>
      {parseSurface.dialog}
      {menu !== undefined &&
        createPortal(
          <div
            className={css.menu}
            style={{ left: menu.left, top: menu.top }}
            role="menu"
            aria-label={t('parsedSelectionMenu')}
            // Pressing a menu item must not collapse the selection it acts on.
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenu(undefined)
            }}
          >
            <Button
              type="button"
              role="menuitem"
              variant="ghost"
              size="sm"
              icon={<IconSparkleRegular size={14} />}
              onClick={() => explain(menu.text)}
            >
              {t('parsedExplain')}
            </Button>
            <Button
              type="button"
              role="menuitem"
              variant="ghost"
              size="sm"
              icon={<IconCopyOutlineRegular size={14} />}
              onClick={() => copy.copyText(menu.text)}
            >
              {copy.phase === 'done' ? t('libraryParsedCopied') : t('parsedCopySelection')}
            </Button>
          </div>,
          document.body,
        )}
    </section>
  )
}
