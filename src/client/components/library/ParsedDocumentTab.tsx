import type { ContextMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
/** One complete parsed-document resource, with host-owned controls and selection menus. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconSparkleRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  MarkdownText,
  TextShimmer,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ZoteroItemDetailView, ZoteroLibraryItemRequestView } from '../../../contract.ts'
import { downloadBlob } from '../../download.ts'
import { answerLanguageOf, type AnswerLanguageSource } from '../../answer-language.ts'
import { artifactImageName } from '../../../artifact-images.ts'
import { extractMarkdownTitleOf, isGenericParsedTitle } from '../../../parsed-title.ts'
import { parseParsedTabAddress, type ParsedTabTarget } from '../../parsed-tab.ts'
import {
  ParsedDocuments,
  useParsedTitleMeta,
  type PreparedParsedDocument,
} from '../../parsed-documents.ts'
import {
  useDocumentParseSurface,
  type DocumentParseSurfacePort,
} from '../../enrichment/parse-surface.tsx'
import { itemInfoTextOf } from './LibraryCitationActions.tsx'
import { IconButton } from '../IconButton.tsx'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import css from './parsed-document.module.css'
import tipCss from '../tip.module.css'

export type { ParsedArtifactRead } from '../../parsed-documents.ts'
export interface ParsedDocumentTabFace {
  readonly contextMenus: Pick<ContextMenus, 'register' | 'open' | 'close' | 'active'>
  readonly refresh: (address: string) => void
  /**
   * The client locale service. The explain prompt is assembled here, so the
   * component reads the active language from it as the draft is built.
   */
  readonly locale: AnswerLanguageSource
  readonly item?: (
    request: ZoteroLibraryItemRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  readonly parse?: DocumentParseSurfacePort
  /**
   * Raise one transient notice in the shell overlay. It lives there, not in
   * this tab, so closing the tab does not take the report with it.
   */
  readonly notify?: (text: string, tone?: 'success') => void
}
export type ParsedDocumentTabProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<ParsedDocumentTabFace> &
  PropsLocale<'zotero'>

export function extractMarkdownTitle(markdown: string): string | undefined {
  return extractMarkdownTitleOf(markdown)
}

export interface ParsedDocumentTitleFace {
  /** The lease-free title source; the chip never opens the full document. */
  readonly documents: ParsedDocuments
}

export function ParsedDocumentTitle(
  props: PropsRuntime<'sidebar.right.pane.tab.title'> &
    InjectFace<ParsedDocumentTitleFace> &
    PropsLocale<'zotero'>,
) {
  const tab = props.useTabInfo().tab
  const target = useMemo(
    () => parseParsedTabAddress(tab.navigation.address, tab.navigation.params),
    [tab.navigation.address, tab.navigation.params],
  )
  const meta = useParsedTitleMeta(props.documents, tab.navigation.address, target)
  if (target === undefined) return props.t('tabParsedFallback')
  return meta.title || target.title || props.t('tabParsedFallback')
}

export function ParsedDocumentTab(props: ParsedDocumentTabProps) {
  const tab = props.useTabInfo().tab
  const address = tab.navigation.address
  const target = useMemo(
    () => parseParsedTabAddress(address, tab.navigation.params),
    [address, tab.navigation.params],
  )
  if (target === undefined)
    return (
      <section className={css.surface}>
        <p className={css.status}>{props.t('parsedUnavailable')}</p>
      </section>
    )
  return <ParsedDocumentView {...props} key={address} target={target} address={address} />
}

type FigureNames = ReadonlyMap<string, string>

export function serializeTableToMarkdown(table: Element, figures?: FigureNames): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''
  const matrix = rows.map((tr) =>
    Array.from(tr.children).map((cell) =>
      Array.from(cell.childNodes, (node) => serializeNodeToMarkdown(node, figures))
        .join('')
        .trim()
        .replace(/\s*\n\s*/gu, ' ')
        .replaceAll('|', '\\|'),
    ),
  )
  if (matrix.length === 0 || !matrix[0]) return ''
  const colCount = Math.max(...matrix.map((r) => r.length))
  let md = '\n\n'
  matrix.forEach((row, idx) => {
    while (row.length < colCount) row.push('')
    md += `| ${row.join(' | ')} |\n`
    if (idx === 0) {
      md += `| ${new Array(colCount).fill('---').join(' | ')} |\n`
    }
  })
  return md + '\n'
}

class UnknownSelectionImage extends Error {}

export function serializeNodeToMarkdown(node: Node, figures?: FigureNames): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return ''
  }

  const el = node as Element

  // 1. KaTeX math formulas (inline or display)
  if (el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display'))) {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    if (tex !== undefined) {
      const isDisplay =
        el.classList.contains('katex-display') ||
        (typeof el.closest === 'function' && el.closest('.katex-display') !== null)
      return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`
    }
  }

  // 2. Preformatted code block
  if (el.tagName === 'PRE') {
    const codeEl = el.querySelector('code')
    const code = codeEl?.textContent ?? el.textContent ?? ''
    return `\n\n\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`
  }

  let childrenText = ''
  for (let i = 0; i < node.childNodes.length; i++) {
    childrenText += serializeNodeToMarkdown(node.childNodes[i]!, figures)
  }

  const tag = el.tagName ? el.tagName.toUpperCase() : ''
  switch (tag) {
    case 'H1':
      return `\n\n# ${childrenText.trim()}\n\n`
    case 'H2':
      return `\n\n## ${childrenText.trim()}\n\n`
    case 'H3':
      return `\n\n### ${childrenText.trim()}\n\n`
    case 'H4':
      return `\n\n#### ${childrenText.trim()}\n\n`
    case 'H5':
      return `\n\n##### ${childrenText.trim()}\n\n`
    case 'H6':
      return `\n\n###### ${childrenText.trim()}\n\n`
    case 'P':
      return `\n\n${childrenText.trim()}\n\n`
    case 'STRONG':
    case 'B': {
      const trimmed = childrenText.trim()
      return trimmed ? `**${trimmed}**` : ''
    }
    case 'EM':
    case 'I': {
      const trimmed = childrenText.trim()
      return trimmed ? `*${trimmed}*` : ''
    }
    case 'DEL':
    case 'S': {
      const trimmed = childrenText.trim()
      return trimmed ? `~~${trimmed}~~` : ''
    }
    case 'CODE':
      return `\`${el.textContent ?? ''}\``
    case 'A': {
      const href = el.getAttribute('href')
      const text = childrenText.trim()
      return href && /^(?:https?:|mailto:|#)/iu.test(href) ? `[${text}](${href})` : text
    }
    case 'IMG': {
      const alt = el.getAttribute('alt') ?? ''
      const src = el.getAttribute('src') ?? ''
      const name = figures?.get(src) ?? artifactImageName(src)
      if (src.startsWith('blob:') && name === undefined) throw new UnknownSelectionImage()
      return name !== undefined ? `![${alt.replace(/[\\[\]]/gu, '\\$&')}](${name})` : alt
    }
    case 'BLOCKQUOTE': {
      const text = childrenText.trim()
      return `\n\n> ${text.replace(/\n/g, '\n> ')}\n\n`
    }
    case 'LI':
      return `- ${childrenText.trim()}\n`
    case 'UL':
    case 'OL':
      return `\n\n${childrenText.trim()}\n\n`
    case 'BR':
      return '\n'
    case 'HR':
      return '\n\n---\n\n'
    case 'TABLE':
      return serializeTableToMarkdown(el, figures)
    default:
      return childrenText
  }
}

export function extractSelectionMarkdown(range: Range, figures?: FigureNames): string | undefined {
  try {
    const fragment = range.cloneContents()
    const md = serializeNodeToMarkdown(fragment, figures)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (md !== '') return md
  } catch (error) {
    if (error instanceof UnknownSelectionImage) return undefined
  }
  return range.toString().trim()
}

function ParsedDocumentView(
  props: ParsedDocumentTabProps & { readonly target: ParsedTabTarget; readonly address: string },
) {
  const { t, item, parse, target, address, refresh, inputActions } = props
  const artifactAllowed = props.useAccess('zotero/documentArtifact')
  const receiptAllowed = props.useAccess('zotero/documentParseReceipt')
  const listAllowed = props.useAccess('job/list')
  const followAllowed = props.useAccess('job/follow')
  const startAllowed = props.useAccess('zotero/startDocumentParse')
  const cancelAllowed = props.useAccess('job/kill')
  const sessionAllowed = !props.useSession((snapshot) => snapshot.removed)
  const resource = props.useResource<'zotero-parsed'>(address)
  const document =
    artifactAllowed && sessionAllowed && resource.value?.phase !== 'denied'
      ? resource.value?.document
      : undefined
  const figures = useMemo(
    () => new Map(Object.entries(document?.images ?? {}).map(([name, url]) => [url, name])),
    [document],
  )
  const parseSurface = useDocumentParseSurface(
    parse,
    {
      sessionId: props.sessionId,
      sessionAllowed,
      startAllowed,
      cancelAllowed,
      readAllowed: artifactAllowed && receiptAllowed && listAllowed && followAllowed,
    },
    t,
  )
  const selectionOwner = useId()
  const { contextMenus } = props
  const [insertError, setInsertError] = useState<string>()
  const documentRef = useRef<HTMLDivElement>(null)
  const escape = useRef(new AbortController())
  const titleId = useId()
  const copy = useCopyFeedback(address)
  const copyDocument = useCopyFeedback(document?.metadata.artifactId, document?.text)
  const notify = props.notify
  const copyLabel = t('libraryParsedCopied')
  const previousCopy = useRef(false)
  const previousDocumentCopy = useRef(false)
  useEffect(() => {
    const copied = copy.phase === 'done'
    if (copied && !previousCopy.current) notify?.(copyLabel, 'success')
    previousCopy.current = copied
  }, [copy.phase, copyLabel, notify])
  useEffect(() => {
    const copied = copyDocument.phase === 'done'
    if (copied && !previousDocumentCopy.current) notify?.(copyLabel, 'success')
    previousDocumentCopy.current = copied
  }, [copyDocument.phase, copyLabel, notify])
  const labels = useMemo(
    () => ({
      code: { copyLabel: t('libraryParsedCopyCode'), copiedLabel: t('libraryParsedCopiedCode') },
      footnotes: t('libraryParsedFootnotes'),
    }),
    [t],
  )
  const reload = useCallback(() => refresh(address), [refresh, address])
  const tabInfo = props.useTabInfo()
  useEffect(
    () => tabInfo?.tab.actions?.bindCommands({ refresh: reload }),
    [tabInfo?.tab.actions, reload],
  )
  useEffect(() => {
    const abort = new AbortController()
    escape.current = abort
    return () => abort.abort()
  }, [address, document?.metadata.artifactId])
  // Registration effects run after render has installed the current actions below.
  const selectionActions = useRef<{
    explain(text: string): void
    copy(text: string): void
    enabled: boolean
  }>()
  useEffect(
    () =>
      contextMenus.register({
        target: 'zoteroSelection',
        id: `zotero.selection.${selectionOwner}`,
        order: 80,
        resolve: (selection) =>
          selection.owner !== selectionOwner
            ? []
            : [
                {
                  id: 'explain',
                  label: t('parsedExplain'),
                  icon: { key: 'zotero.selection.explain' },
                  disabled: !selectionActions.current!.enabled,
                  run: () => selectionActions.current!.explain(selection.text),
                },
                {
                  id: 'copy',
                  label: t('parsedCopySelection'),
                  icon: { key: 'zotero.selection.copy' },
                  run: () => selectionActions.current!.copy(selection.text),
                },
              ],
      }),
    [contextMenus, selectionOwner, t, inputActions],
  )
  useEffect(() => {
    let pointerSelecting = false,
      keyboardSelecting = false
    let previous:
      | { text: string | undefined; start: Node; offset: number; end: Node; endOffset: number }
      | undefined
    const closeOwned = () => {
      const active = contextMenus.active.getSnapshot()
      if (active?.kind === 'zoteroSelection' && active.value.owner === selectionOwner)
        contextMenus.close()
    }
    const update = (point?: { x: number; y: number }) => {
      if (pointerSelecting || keyboardSelecting) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (!documentRef.current?.contains(range.commonAncestorContainer)) return
      const text = extractSelectionMarkdown(range, figures)
      if (
        previous !== undefined &&
        previous.text === text &&
        previous.start === range.startContainer &&
        previous.offset === range.startOffset &&
        previous.end === range.endContainer &&
        previous.endOffset === range.endOffset
      )
        return
      previous = {
        text,
        start: range.startContainer,
        offset: range.startOffset,
        end: range.endContainer,
        endOffset: range.endOffset,
      }
      if (!text) {
        closeOwned()
        if (text === undefined) notify?.(t('parsedSelectionImageUnavailable'))
        return
      }
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      )
      const backwards =
        selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset
      const rect = (backwards ? rects[0] : rects.at(-1)) ?? range.getBoundingClientRect()
      contextMenus.open(
        { kind: 'zoteroSelection', value: { owner: selectionOwner, text } },
        point ?? { x: backwards ? rect.left : rect.right, y: rect.bottom },
      )
    }
    const pointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Node) ||
        !documentRef.current?.contains(event.target)
      )
        return
      pointerSelecting = true
      previous = undefined
      closeOwned()
    }
    const pointerUp = (event: PointerEvent) => {
      if (!pointerSelecting) return
      pointerSelecting = false
      update({ x: event.clientX, y: event.clientY })
    }
    const cancel = () => {
      pointerSelecting = false
      keyboardSelecting = false
      closeOwned()
    }
    const keyDown = (event: KeyboardEvent) => {
      const selection = window.getSelection()
      if (
        (event.key === 'Shift' || event.shiftKey) &&
        ((event.target instanceof Node && documentRef.current?.contains(event.target)) ||
          (selection?.rangeCount &&
            documentRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)))
      ) {
        keyboardSelecting = true
        previous = undefined
        closeOwned()
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      if (keyboardSelecting && (event.key === 'Shift' || !event.shiftKey)) {
        keyboardSelecting = false
        update()
      }
    }
    const selectionChanged = () => update()
    // A layout change invalidates the captured document range; close only this reader's target.
    window.addEventListener('scroll', closeOwned, true)
    window.addEventListener('resize', closeOwned)
    window.document.addEventListener('selectionchange', selectionChanged)
    window.document.addEventListener('pointerdown', pointerDown, true)
    window.document.addEventListener('pointerup', pointerUp, true)
    window.document.addEventListener('pointercancel', cancel, true)
    window.document.addEventListener('keydown', keyDown)
    window.document.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('scroll', closeOwned, true)
      window.removeEventListener('resize', closeOwned)
      window.document.removeEventListener('selectionchange', selectionChanged)
      window.document.removeEventListener('pointerdown', pointerDown, true)
      window.document.removeEventListener('pointerup', pointerUp, true)
      window.document.removeEventListener('pointercancel', cancel, true)
      window.document.removeEventListener('keydown', keyDown)
      window.document.removeEventListener('keyup', keyUp)
      closeOwned()
    }
  }, [contextMenus, selectionOwner, figures, notify, t])

  const extractedTitle = useMemo(
    () =>
      document !== undefined
        ? (document.metadata.title ?? extractMarkdownTitleOf(document.text))
        : undefined,
    [document],
  )
  const hasGenericTarget = isGenericParsedTitle(target.title)
  const hasGenericLabel = isGenericParsedTitle(document?.metadata.targetLabel)
  const displayTitle =
    extractedTitle ||
    (!hasGenericTarget
      ? target.title
      : (!hasGenericLabel ? document!.metadata.targetLabel : '') ||
        target.title ||
        t('tabParsedFallback'))
  const explain = async (selection: { text: string }) => {
    if (inputActions === undefined) return
    const signal = escape.current.signal
    try {
      const result =
        target.item !== undefined && item !== undefined
          ? await item({ ref: target.item, include: [] }, signal)
          : undefined
      if (signal.aborted) return
      if (result !== undefined && !result.ok) {
        setInsertError(result.error.message)
        return
      }
      // Address the exact parsed document the tab shows. A Zotero attachment
      // ref or an opaque artifact id both resolve through the same retrieve
      // mode; URL-sourced documents have no ref and use artifactId.
      if (document === undefined) return
      const source = { kind: 'artifactId', artifactId: document.metadata.artifactId }
      const draft = [
        t('parsedExplainPrompt', {
          source: JSON.stringify(source),
          language: answerLanguageOf(props.locale.getSnapshot().active),
        }),
        result?.ok ? itemInfoTextOf(result.value) : displayTitle,
        target.item ?? '',
        // Keep the excerpt at the end, after the instruction and metadata.
        selection.text,
      ]
        .filter(Boolean)
        .join('\n\n')
      // Keep the request in the Host's single removable quote card.
      if (
        !inputActions.insertQuote(draft, {
          label: t('parsedExplain'),
          title: displayTitle,
          detail: document?.metadata.targetLabel,
          body: selection.text,
        })
      ) {
        setInsertError(t('libraryInsertFailed'))
        return
      }
      inputActions.persistDraft()
      setInsertError(undefined)
    } catch (error) {
      if (!signal.aborted) setInsertError(error instanceof Error ? error.message : String(error))
    }
  }
  const failure =
    !artifactAllowed || !sessionAllowed
      ? t('parsedReadDenied')
      : (resource.failure?.message ?? resource.value?.message)
  const preparing =
    resource.status === 'loading' ||
    (resource.value?.phase === 'preparing' && resource.status !== 'failed')
  const progress = resource.value?.progress
  selectionActions.current = {
    explain: (text) => void explain({ text }),
    copy: (text) => copy.copyText(text),
    enabled: inputActions !== undefined,
  }
  return (
    <section className={css.surface} aria-labelledby={titleId}>
      <header className={css.toolbar}>
        <div className={css.heading}>
          <h2 id={titleId} className={css.title} title={displayTitle}>
            {displayTitle}
          </h2>
        </div>
        <div className={css.tools}>
          <Tooltip label={t('libraryParsedCopy')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                icon={
                  copyDocument.phase === 'done' ? (
                    <IconCheckOutlineRegular size={14} />
                  ) : (
                    <IconCopyOutlineRegular size={14} />
                  )
                }
                aria-label={t(
                  copyDocument.phase === 'done' ? 'libraryParsedCopied' : 'libraryParsedCopy',
                )}
                disabled={!document}
                onClick={() => document && copyDocument.copyText(document.text)}
              />
            </span>
          </Tooltip>
          <Tooltip label={t('libraryParsedDownload')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                icon={<IconDownloadOutlineRegular size={14} />}
                aria-label={t('libraryParsedDownload')}
                disabled={!document}
                onClick={() =>
                  document &&
                  downloadBlob(
                    document.text,
                    `${displayTitle.replace(/[^\p{L}\p{N}_.-]+/gu, '_')}.md`,
                    'text/markdown;charset=utf-8',
                  )
                }
              />
            </span>
          </Tooltip>
          {parseSurface.openAttachment &&
            (target.artifactId === undefined || parseSurface.openArtifact) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<IconSparkleRegular size={14} />}
                aria-label={t('libraryParsedReparse')}
                onClick={() => {
                  const label = document?.metadata.targetLabel || displayTitle
                  if (target.artifactId !== undefined)
                    parseSurface.openArtifact?.(target.artifactId, label)
                  else
                    parseSurface.openAttachment?.({
                      ref: target.ref,
                      title: label,
                      contentType: 'application/pdf',
                    })
                }}
              >
                <span className={css.actionLabel}>{t('libraryParsedReparse')}</span>
              </Button>
            )}
          <Tooltip label={t('parsedReload')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                icon={<IconRefreshOutlineRegular size={14} />}
                aria-label={t('parsedReload')}
                disabled={!artifactAllowed || !sessionAllowed}
                onClick={reload}
              />
            </span>
          </Tooltip>
        </div>
      </header>
      {failure && (
        <p role="alert" className={css.banner}>
          {failure}
        </p>
      )}
      {insertError && (
        <p role="alert" className={css.banner}>
          {insertError}
        </p>
      )}
      {preparing && (
        <p role="status" className={css.progress}>
          <TextShimmer active>
            {progress
              ? t('parsedPreparing', {
                  pages: progress.pages,
                  totalPages: progress.totalPages,
                  images: progress.images,
                  totalImages: progress.totalImages,
                })
              : t('libraryParsedLoading')}
          </TextShimmer>
        </p>
      )}
      <div className={css.body} ref={documentRef}>
        {document && <ParsedMarkdown document={document} labels={labels} />}
        {!document && resource.status === 'none' && (
          <p className={css.status}>{t('parsedUnavailable')}</p>
        )}
      </div>
      {document && (
        <footer className={css.footer}>
          <div className={css.footerActions} />
          <span className={css.footerMeta}>
            {t('libraryParsedChars', {
              loaded: document.text.length,
              total: document.text.length,
            })}
          </span>
        </footer>
      )}
      {parseSurface.dialog}
    </section>
  )
}

function ParsedMarkdown({
  document,
  labels,
}: {
  document: PreparedParsedDocument
  labels: import('@deepseek-ai/dsh-client-ui-primitives').MarkdownLabels
}) {
  const pathImages = useMemo(
    () => ({
      resolve: (value: string) => {
        const name = artifactImageName(value)
        return name === undefined ? undefined : document.images[name]
      },
    }),
    [document],
  )
  return <MarkdownText text={document.display} labels={labels} pathImages={pathImages} />
}
