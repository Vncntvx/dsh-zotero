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
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ZoteroItemDetailView, ZoteroLibraryItemRequestView } from '../../../contract.ts'
import { downloadBlob } from '../../download.ts'
import { artifactImageName } from '../../../artifact-images.ts'
import { parseParsedTabAddress, type ParsedTabTarget } from '../../parsed-tab.ts'
import type { PreparedParsedDocument } from '../../parsed-documents.ts'
import {
  useDocumentParseSurface,
  type DocumentParseSurfacePort,
} from '../../enrichment/parse-surface.tsx'
import { itemInfoTextOf } from './LibraryCitationActions.tsx'
import { IconButton } from '../IconButton.tsx'
import { useCopyFeedback } from '../useCopyFeedback.ts'
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

export function ParsedDocumentTitle(
  props: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'zotero'>,
) {
  const tab = props.useTabInfo().tab
  const target = parseParsedTabAddress(tab.navigation.address, tab.navigation.params)
  return target?.title || props.t('tabParsedFallback')
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
  readonly focus: HTMLElement | null
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
    const update = () => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (!documentRef.current?.contains(range.commonAncestorContainer)) return
      const text = selection.toString().trim()
      if (text === '') return
      const rect = range.getBoundingClientRect()
      setMenu({
        text,
        point: { x: rect.left, y: rect.bottom },
        focus:
          window.document.activeElement instanceof HTMLElement
            ? window.document.activeElement
            : null,
      })
    }
    const hide = () => setMenu(undefined)
    window.document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  const displayTitle = target.title || document?.metadata.targetLabel || t('tabParsedFallback')
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
          {document && (
            <span className={css.meta}>
              {t('libraryParsedChars', {
                loaded: document.text.length,
                total: document.text.length,
              })}
              {document.metadata.pageCount !== undefined &&
                ` · ${t('libraryParsedPages', { count: document.metadata.pageCount })}`}
            </span>
          )}
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
          {parseSurface.openAttachment && (
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
                  title: document?.metadata.targetLabel || displayTitle,
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
      {copy.phase === 'done' && (
        <p role="status" className={css.banner}>
          {t('libraryParsedCopied')}
        </p>
      )}
      {preparing && (
        <p role="status" className={css.progress}>
          {progress
            ? t('parsedPreparing', {
                pages: progress.pages,
                totalPages: progress.totalPages,
                images: progress.images,
                totalImages: progress.totalImages,
              })
            : t('libraryParsedLoading')}
        </p>
      )}
      <div className={css.body} ref={documentRef}>
        {document && <ParsedMarkdown document={document} labels={labels} />}
        {!document && resource.status === 'none' && (
          <p className={css.status}>{t('parsedUnavailable')}</p>
        )}
      </div>
      {parseSurface.dialog}
      {menu !== undefined && (
        <Menu
          open
          anchor={null}
          portal
          contextual
          autoFocus
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
