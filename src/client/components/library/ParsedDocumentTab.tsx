/** One complete parsed-document resource, with host-owned controls and selection menus. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconSparkleRegular,
  MarkdownText,
  Menu,
  TextShimmer,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ZoteroItemDetailView, ZoteroLibraryItemRequestView } from '../../../contract.ts'
import { downloadBlob } from '../../download.ts'
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
import { useTransientToast } from '../use-transient-toast.ts'
import css from './parsed-document.module.css'

export type { ParsedArtifactRead } from '../../parsed-documents.ts'
export interface ParsedDocumentTabFace {
  readonly refresh: (address: string) => void
  readonly item?: (
    request: ZoteroLibraryItemRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  readonly parse?: DocumentParseSurfacePort
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
  if (!isGenericParsedTitle(target.title)) return target.title
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

interface SelectionMenu {
  readonly text: string
  readonly point: { readonly x: number; readonly y: number }
  readonly side?: 'bottom' | 'top'
  readonly focus: HTMLElement | null
}

export function computeSelectionAnchor(
  range: Range,
  cursor?: { readonly x: number; readonly y: number } | null,
): { readonly point: { readonly x: number; readonly y: number }; readonly side: 'bottom' | 'top' } {
  const rawRects =
    typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
      : []
  const fallback =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect)
  const selection = typeof window !== 'undefined' ? window.getSelection() : null
  const isBackward =
    selection !== null &&
    range.startContainer === selection.focusNode &&
    range.startOffset === selection.focusOffset

  const activeRect =
    rawRects.length > 0 ? (isBackward ? rawRects[0] : rawRects[rawRects.length - 1]) : fallback

  const top = activeRect.top ?? (activeRect.bottom !== undefined ? activeRect.bottom - 20 : 0)
  const bottom = activeRect.bottom ?? top + 20
  const left = activeRect.left ?? 0
  const right = activeRect.right ?? left + (activeRect.width ?? 100)

  const menuWidth = 160
  const menuHeight = 84
  const margin = 16

  let focalX: number
  if (
    cursor !== undefined &&
    cursor !== null &&
    cursor.x >= 0 &&
    cursor.y >= top - 40 &&
    cursor.y <= bottom + 40
  ) {
    focalX = cursor.x
  } else {
    focalX = isBackward ? left : right
  }

  const viewportWidth =
    (typeof window !== 'undefined' ? window.innerWidth : 0) ||
    document.documentElement?.clientWidth ||
    800
  const viewportHeight =
    (typeof window !== 'undefined' ? window.innerHeight : 0) ||
    document.documentElement?.clientHeight ||
    600

  const x = Math.max(margin, Math.min(focalX - menuWidth / 2, viewportWidth - menuWidth - margin))

  const spaceAbove = top
  const spaceBelow = viewportHeight - bottom
  const preferTop = spaceAbove >= menuHeight + 20 || spaceBelow < menuHeight + 20
  const side: 'bottom' | 'top' = preferTop ? 'top' : 'bottom'
  const y = side === 'top' ? top : bottom

  return { point: { x, y }, side }
}
export function serializeTableToMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''
  const matrix = rows.map((tr) =>
    Array.from(tr.children).map((cell) => cell.textContent?.trim() ?? ''),
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

export function serializeNodeToMarkdown(node: Node): string {
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
    childrenText += serializeNodeToMarkdown(node.childNodes[i]!)
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
      return href ? `[${text}](${href})` : text
    }
    case 'IMG': {
      const alt = el.getAttribute('alt') ?? ''
      const src = el.getAttribute('src') ?? ''
      return `![${alt}](${src})`
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
      return serializeTableToMarkdown(el)
    default:
      return childrenText
  }
}

export function extractSelectionMarkdown(range: Range): string {
  try {
    const fragment = range.cloneContents()
    const md = serializeNodeToMarkdown(fragment)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (md !== '') return md
  } catch {
    // fallback
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
  const [menu, setMenu] = useState<SelectionMenu>()
  const [insertError, setInsertError] = useState<string>()
  const documentRef = useRef<HTMLDivElement>(null)
  const escape = useRef(new AbortController())
  const titleId = useId()
  const copy = useCopyFeedback(address)
  const copyDocument = useCopyFeedback(document?.metadata.artifactId, document?.text)
  const { toast: copiedToast, notify: notifyCopied, clear: clearCopied } = useTransientToast()
  useEffect(() => {
    if (copy.phase === 'done' || copyDocument.phase === 'done')
      notifyCopied(t('libraryParsedCopied'), 'success')
  }, [copy.phase, copyDocument.phase, notifyCopied, t])
  useEffect(() => {
    clearCopied()
  }, [address, clearCopied])
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
  }, [address])
  useEffect(() => {
    let pointerSelecting = false
    let keyboardSelecting = false

    const update = (cursor?: { readonly x: number; readonly y: number } | null) => {
      if (pointerSelecting || keyboardSelecting) return
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (!documentRef.current?.contains(range.commonAncestorContainer)) return
      const text = extractSelectionMarkdown(range)
      if (text === '') return
      const { point, side } = computeSelectionAnchor(range, cursor)
      setMenu({
        text,
        point,
        side,
        focus:
          window.document.activeElement instanceof HTMLElement
            ? window.document.activeElement
            : null,
      })
    }
    const hide = () => setMenu(undefined)

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
      hide()
      if (event.button !== 0) return
      pointerSelecting = true
    }
    const onPointerUp = (event: PointerEvent) => {
      if (pointerSelecting) {
        pointerSelecting = false
        update({ x: event.clientX, y: event.clientY })
      }
    }
    const onPointerCancel = () => {
      pointerSelecting = false
      keyboardSelecting = false
      hide()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onPointerCancel()
        return
      }
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
      if (event.key === 'Shift' || event.shiftKey) {
        keyboardSelecting = true
        hide()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (keyboardSelecting && (event.key === 'Shift' || !event.shiftKey)) {
        keyboardSelecting = false
        update()
      }
    }

    const onSelectionChange = () => {
      if (pointerSelecting || keyboardSelecting) return
      update()
    }

    window.document.addEventListener('selectionchange', onSelectionChange)
    window.document.addEventListener('pointerdown', onPointerDown, true)
    window.document.addEventListener('pointerup', onPointerUp, true)
    window.document.addEventListener('pointercancel', onPointerCancel, true)
    window.document.addEventListener('keydown', onKeyDown)
    window.document.addEventListener('keyup', onKeyUp)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.document.removeEventListener('selectionchange', onSelectionChange)
      window.document.removeEventListener('pointerdown', onPointerDown, true)
      window.document.removeEventListener('pointerup', onPointerUp, true)
      window.document.removeEventListener('pointercancel', onPointerCancel, true)
      window.document.removeEventListener('keydown', onKeyDown)
      window.document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  const extractedTitle = useMemo(
    () =>
      document !== undefined
        ? (document.metadata.title ?? extractMarkdownTitleOf(document.text))
        : undefined,
    [document],
  )
  const hasGenericTarget = isGenericParsedTitle(target.title)
  const hasGenericLabel = isGenericParsedTitle(document?.metadata.targetLabel)
  const displayTitle = !hasGenericTarget
    ? target.title
    : extractedTitle ||
      (!hasGenericLabel ? document!.metadata.targetLabel : '') ||
      target.title ||
      t('tabParsedFallback')
  const explain = async (selection: SelectionMenu) => {
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
      const instruction = [
        t('parsedExplainPrompt'),
        selection.text,
        result?.ok ? itemInfoTextOf(result.value) : displayTitle,
        target.item ?? '',
      ]
        .filter(Boolean)
        .join('\n\n')
      if (inputActions.insertQuote(instruction)) {
        inputActions.persistDraft()
        setInsertError(undefined)
      } else setInsertError(t('libraryInsertFailed'))
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
  return (
    <section className={css.surface} aria-labelledby={titleId}>
      <header className={css.toolbar}>
        <div className={css.heading}>
          <h2 id={titleId} className={css.title} title={displayTitle}>
            {displayTitle}
          </h2>
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
            aria-label={t(
              copyDocument.phase === 'done' ? 'libraryParsedCopied' : 'libraryParsedCopy',
            )}
            title={t('libraryParsedCopy')}
            disabled={!document}
            onClick={() => document && copyDocument.copyText(document.text)}
          />
          <IconButton
            icon={<IconDownloadOutlineRegular size={14} />}
            aria-label={t('libraryParsedDownload')}
            title={t('libraryParsedDownload')}
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
          {parseSurface.openAttachment &&
            (target.artifactId === undefined || parseSurface.openArtifact) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<IconSparkleRegular size={14} />}
                aria-label={t('libraryParsedReparse')}
                title={t('libraryParsedReparse')}
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
          <IconButton
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={t('parsedReload')}
            title={t('parsedReload')}
            disabled={!artifactAllowed || !sessionAllowed}
            onClick={reload}
          />
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
      {copiedToast !== null && (
        <Toast
          key={copiedToast.seq}
          tone={copiedToast.tone}
          text={copiedToast.text}
          onDone={clearCopied}
        />
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
      {menu !== undefined && (
        <Menu
          open
          anchor={null}
          portal
          contextual
          autoFocus
          side={menu.side ?? 'bottom'}
          anchorPoint={menu.point}
          returnFocus={() => menu.focus}
          onClose={() => setMenu(undefined)}
          items={[
            {
              id: 'explain',
              label: t('parsedExplain'),
              icon: <IconSparkleRegular size={14} />,
              disabled: inputActions === undefined,
            },
            {
              id: 'copy',
              label: t('parsedCopySelection'),
              icon: <IconCopyOutlineRegular size={14} />,
            },
          ]}
          onSelect={(id) => {
            const selected = menu
            setMenu(undefined)
            if (id === 'copy') copy.copyText(selected.text)
            else void explain(selected)
          }}
        />
      )}
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
