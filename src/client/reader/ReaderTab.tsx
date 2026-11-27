import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button,
  IconRefreshOutlineRegular,
  Pill,
  StateDot,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAnnotationRowView,
  ZoteroArtifactRegionTextView,
  ZoteroArtifactTextRegion,
  ZoteroItemDetailView,
  ZoteroLibraryWriteResultView,
  ZoteroReaderAnnotationsRequest,
  ZoteroReaderAnnotationsView,
  ZoteroReaderCreateAnnotationsRequest,
  ZoteroReaderCreateAnnotationsView,
  ZoteroReaderDeleteAnnotationRequest,
  ZoteroReaderDetailsRequest,
  ZoteroReaderNoteRequest,
  ZoteroReaderNoteView,
  ZoteroReaderSuggestAnnotationRequest,
  ZoteroReaderTranslateRequest,
  ZoteroReaderWriteNoteRequest,
  ZoteroReaderUpdateAnnotationRequest,
} from '../../contract.ts'
import {
  ZOTERO_CHILD_PAGE_ROWS,
  ZOTERO_READER_TRANSLATION_SOURCE_CHARS,
  ZOTERO_WRITE_OBJECT_BATCH,
} from '../../constants.ts'
import { refFieldsOf } from '../../ref-grammar.ts'
import { asRecord } from '../../json.ts'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { messageOf } from '../error-text.ts'
import { canUseSessionActions } from '../session-actions.ts'
import { pdfUrlOf } from '../actions/open-zotero.ts'
import { IconButton } from '../components/IconButton.tsx'
import { readerAddress, readerTarget } from './address.ts'
import { annotationColorOf, DEFAULT_ANNOTATION_COLOR } from './annotation-color.ts'
import { AnnotationEditor } from './AnnotationEditor.tsx'
import { AnnotationComment } from './AnnotationComment.tsx'
import { ReaderDetails } from './ReaderDetails.tsx'
import type { ReaderCitationOptions } from './ReaderCitationCopy.tsx'
import type { ReaderJournalMetricsOptions } from './ReaderJournalMetrics.tsx'
import { ReaderCapture } from './ReaderCapture.tsx'
import { ReaderQuote, type ReaderReviews } from './ReaderQuote.tsx'
import { ReaderBatchQuote } from './ReaderBatchQuote.tsx'
import { ReaderNote } from './ReaderNote.tsx'
import { ReaderPanel } from './ReaderPanel.tsx'
import { ReaderTextDocument } from './ReaderTextDocument.tsx'
import { ReaderTranslation, type ReaderTranslationResult } from './ReaderTranslation.tsx'
import { ReaderTranslationTargetContext } from './translation-preferences.ts'
import type { ReaderTranslationTarget } from '../../reader/config.ts'
import { browserTranslationProvider } from './browser-translation.ts'
import { DRAWER_MAX_REM } from './layout.ts'
import { ReaderFloatBar, ReaderToolbar } from './ReaderToolbar.tsx'
import { MAX_EXCERPT_PAGES, MAX_EXCERPT_RECTS } from './pdf-excerpt.ts'
import type {
  mountPdf,
  PdfEvidenceLocation,
  PdfFindStatus,
  PdfOutline,
  PdfPasswordRequest,
  PdfSelection,
  PdfView,
} from './pdf-runtime.ts'
import type { createReadingHistory } from './reading-history.ts'
import type { ReadingState } from '../../reader/reading-state.ts'
import type { PdfPageRegion, PdfQuoteSource } from '../../reader/evidence.ts'
import type { ParsedPassage } from '../parsed-tab.ts'
import type {} from './locales.ts'
import css from './reader.module.css'

export { readerEn, readerZh } from './locales.ts'
export { ReaderNoteMutation } from './ReaderNote.tsx'
export { ReaderTurnCitations } from './ReaderTurnCitations.tsx'

type PdfControls = Awaited<ReturnType<typeof mountPdf>>
const evidenceStatusKey = {
  locating: 'evidenceLocating',
  ambiguous: 'evidenceAmbiguous',
  page: 'evidencePage',
  missing: 'evidenceMissing',
  incomplete: 'evidenceIncomplete',
  failed: 'evidenceFailed',
} as const

function usesPanelDrawers(node: HTMLElement | null) {
  const width = node?.clientWidth
  if (!width) return false
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return width <= DRAWER_MAX_REM * rem
}

export interface ReaderTabFace {
  defaultTranslationTarget?: () => ReaderTranslationTarget
  defaultCaptureWatermark?: () => boolean
  translationTarget?: {
    readonly getSnapshot: () => ReaderTranslationTarget
    readonly subscribe: (listener: () => void) => () => void
  }
  resolve: (
    ref: string,
    signal: AbortSignal,
  ) => Promise<{ path: string; ref: string; parentRef?: string }>
  read: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => Promise<Uint8Array<ArrayBuffer>>
  readTextAttachment: (
    sessionId: SessionId,
    ref: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly format: 'html' | 'markdown' | 'text'
    readonly data: Uint8Array<ArrayBuffer>
    readonly eof: boolean
    readonly parentRef?: string
  }>
  load: () => Promise<{ mountPdf: typeof mountPdf }> | undefined
  openProtocol: (url: string) => Promise<boolean>
  history: ReturnType<typeof createReadingHistory>
  reviews?: ReaderReviews
  openParsedPassage?: (
    sessionId: SessionId,
    source: PdfQuoteSource,
    selection: Pick<ParsedPassage, 'quote' | 'region'>,
    signal: AbortSignal,
  ) => Promise<boolean>
  readParsedText?: (
    sessionId: SessionId,
    source: PdfQuoteSource,
    regions: readonly ZoteroArtifactTextRegion[],
    signal: AbortSignal,
  ) => Promise<ZoteroArtifactRegionTextView | undefined>
  details: (
    request: ZoteroReaderDetailsRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroItemDetailView>
  readNote: (request: ZoteroReaderNoteRequest, signal: AbortSignal) => Promise<ZoteroReaderNoteView>
  readNoteImage?: (
    sessionId: SessionId,
    noteRef: string,
    imageRef: string,
    signal: AbortSignal,
  ) => Promise<Blob>
  translate: (request: ZoteroReaderTranslateRequest, signal: AbortSignal) => Promise<string>
  suggestAnnotation?: (
    request: ZoteroReaderSuggestAnnotationRequest,
    signal: AbortSignal,
  ) => Promise<string>
  writeNote: (
    request: ZoteroReaderWriteNoteRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroLibraryWriteResultView>
  journalMetrics?: ReaderJournalMetricsOptions
  citationCopy?: ReaderCitationOptions
  annotations: (
    request: ZoteroReaderAnnotationsRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroReaderAnnotationsView>
  updateAnnotation: (
    request: ZoteroReaderUpdateAnnotationRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroLibraryWriteResultView>
  createAnnotations: (
    request: ZoteroReaderCreateAnnotationsRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroReaderCreateAnnotationsView>
  deleteAnnotation: (
    request: ZoteroReaderDeleteAnnotationRequest,
    signal: AbortSignal,
  ) => Promise<ZoteroLibraryWriteResultView>
}

type ReaderTabProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsLocale<'zoteroReader'> &
  InjectFace<ReaderTabFace>

const NO_TRANSLATION_TARGET_SUBSCRIPTION = () => () => undefined
const DEFAULT_TRANSLATION_TARGET = () => 'auto' as const

export function ReaderTab(props: ReaderTabProps) {
  const { tab } = props.useTabInfo()
  const address = tab.navigation.address
  const target = readerTarget(address)
  const translationTarget = useSyncExternalStore(
    props.translationTarget?.subscribe ?? NO_TRANSLATION_TARGET_SUBSCRIPTION,
    props.translationTarget?.getSnapshot ??
      props.defaultTranslationTarget ??
      DEFAULT_TRANSLATION_TARGET,
  )
  const canResolve = props.useRemoteAccess('zotero/resolveAttachment')
  const canRead = props.useAccess('workspaceFiles/readBytes')
  const canReadNote = props.useRemoteAccess('zotero/readerNote')
  const canWriteNote = props.useAccess('zotero/readerWriteNote')
  const canTranslate = props.useRemoteAccess('zotero/readerTranslate')
  const session = props.useSession((snapshot) =>
    snapshot.removed ? 'removed' : canUseSessionActions(snapshot) ? 'open' : 'closed',
  )
  if (
    !target ||
    target.sessionId !== props.sessionId ||
    session === 'removed' ||
    (target.kind === 'note' ? !canReadNote : !canResolve || !canRead)
  )
    return (
      <p role="status" className={css.status}>
        {props.t('unavailable')}
      </p>
    )
  if (target.kind === 'note')
    return (
      <ReaderTranslationTargetContext.Provider value={translationTarget}>
        <div className={`${css.reader} ${css.standaloneNote}`}>
          <ReaderNote
            key={`${address}:${tab.navigation.revision}`}
            t={props.t}
            refString={target.ref}
            sessionId={props.sessionId}
            tabSignal={tab.signal}
            read={props.readNote}
            readImage={canResolve && canRead ? props.readNoteImage : undefined}
            expectedVersion={tab.navigation.params?.noteVersion}
            write={canWriteNote && session === 'open' ? props.writeNote : undefined}
            translate={canTranslate && session === 'open' ? props.translate : undefined}
            inputActions={props.inputActions}
            onDeleted={() => tab.actions.close()}
          />
        </div>
      </ReaderTranslationTargetContext.Provider>
    )
  if (target.kind === 'text')
    return (
      <ReaderTranslationTargetContext.Provider value={translationTarget}>
        <ReaderTextDocument
          key={`${address}:${tab.navigation.revision}`}
          t={props.t}
          refString={target.ref}
          title={tab.navigation.params?.title ?? props.t('title')}
          sessionId={props.sessionId}
          tabSignal={tab.signal}
          citation={tab.navigation.params?.textCitation}
          read={props.readTextAttachment}
          translate={canTranslate && session === 'open' ? props.translate : undefined}
          inputActions={props.inputActions}
        />
      </ReaderTranslationTargetContext.Provider>
    )
  // History links and retrieved text are checked against the current file even
  // when the same sidebar tab already holds an older version of it.
  const navigation = tab.navigation.params
  const checkSource =
    navigation?.expectedFingerprint || navigation?.evidenceQuote || navigation?.artifactEvidence
  const key = checkSource ? `${address}:${tab.navigation.revision}` : address
  return (
    <ReaderTranslationTargetContext.Provider value={translationTarget}>
      <ReaderDocument key={key} {...props} documentRef={target.ref} />
    </ReaderTranslationTargetContext.Provider>
  )
}

function ReaderDocument({
  useTabInfo,
  t,
  documentRef,
  load,
  resolve,
  read,
  history,
  reviews,
  openParsedPassage,
  readParsedText,
  details,
  readNote,
  readNoteImage,
  translate,
  suggestAnnotation,
  writeNote,
  journalMetrics,
  citationCopy,
  annotations,
  updateAnnotation,
  createAnnotations,
  deleteAnnotation,
  openProtocol,
  defaultCaptureWatermark,
  useRemoteAccess,
  useAccess,
  useSession,
  inputActions,
  sessionId,
}: ReaderTabProps & { readonly documentRef: string }) {
  const { tab } = useTabInfo()
  const { signal: tabSignal } = tab
  const targetPosition = tab.navigation.params?.position
  const targetQuote = tab.navigation.params?.evidenceQuote
  const targetArtifact = tab.navigation.params?.artifactEvidence
  const expectedFingerprint =
    tab.navigation.params?.expectedFingerprint ??
    targetArtifact?.contentFingerprint ??
    targetQuote?.contentFingerprint
  const documentTitle = useRef(tab.navigation.params?.title)
  useEffect(() => {
    documentTitle.current = tab.navigation.params?.title
  }, [tab.navigation.params?.title])
  const host = useRef<HTMLDivElement>(null)
  const readerNode = useRef<HTMLElement>(null)
  const selectedAnnotationRow = useRef<HTMLLIElement>(null)
  const controls = useRef<PdfControls | null>(null)
  const [view, setView] = useState<PdfView>()
  const [pageInput, setPageInput] = useState('')
  const [query, setQuery] = useState('')
  const [findStatus, setFindStatus] = useState<PdfFindStatus>()
  const [zoomFactor, setZoomFactor] = useState(1)
  const [fitMode, setFitMode] = useState<'width' | 'page' | 'free'>('width')
  const [selection, setSelection] = useState<PdfSelection>()
  const parsedSelectionRequest = useRef<AbortController>()
  const [locatingSelection, setLocatingSelection] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [quoteTarget, setQuoteTarget] = useState<{ annotationRef?: string }>()
  const [translation, setTranslation] = useState<PdfSelection>()
  const translationCache = useRef(new Map<string, string>())
  const [annotationDraft, setAnnotationDraft] = useState<{
    type: ZoteroReaderCreateAnnotationsRequest['type']
    selection: PdfSelection
  }>()
  const [creationResult, setCreationResult] = useState<ZoteroReaderCreateAnnotationsView>()
  const [actionNotice, setActionNotice] = useState<string>()
  const [evidenceLocation, setEvidenceLocation] = useState<
    PdfEvidenceLocation | { kind: 'locating'; cancel: () => void } | { kind: 'failed' }
  >()
  const [error, setError] = useState<string>()
  const [passwordRequest, setPasswordRequest] = useState<
    PdfPasswordRequest & { cancel: () => void }
  >()
  const [location, setLocation] = useState<Awaited<ReturnType<ReaderTabFace['resolve']>>>()
  const [outline, setOutline] = useState<readonly PdfOutline[]>([])
  const [outlineError, setOutlineError] = useState(false)
  const panels = useRef<ReadingState['panels']>({ outline: false, info: false })
  const [panelState, setPanelState] = useState(panels.current)
  const outlineOpen = panelState.outline
  const rightPanel = panelState.info ? (panelState.infoTab ?? 'annotations') : undefined
  const annotationsOpen = rightPanel === 'annotations'
  const [annotationRows, setAnnotationRows] = useState<readonly ZoteroAnnotationRowView[]>([])
  const [annotationError, setAnnotationError] = useState(false)
  const [annotationOffset, setAnnotationOffset] = useState<number>()
  const [requestedOffset, setRequestedOffset] = useState(0)
  const [annotationRevision, setAnnotationRevision] = useState(0)
  const [annotationFilter, setAnnotationFilter] = useState('')
  const [annotationColorFilter, setAnnotationColorFilter] = useState('')
  const [selectedAnnotation, setSelectedAnnotation] = useState<string>()
  const [annotationChoices, setAnnotationChoices] = useState<readonly string[]>([])
  const [annotationWriteEnabled, setAnnotationWriteEnabled] = useState(false)
  const [annotationEdit, setAnnotationEdit] = useState<ZoteroAnnotationRowView>()
  const [annotationDelete, setAnnotationDelete] = useState<ZoteroAnnotationRowView>()
  const deleteCancel = useRef<HTMLButtonElement>(null)
  const [annotationBusy, setAnnotationBusy] = useState(false)
  const [annotationNotice, setAnnotationNotice] = useState<{ message: string; warning: boolean }>()
  const annotationWrite = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    if (!annotationDelete) return
    deleteCancel.current?.focus()
  }, [annotationDelete])
  const saveReadingState = useRef<() => void>(() => undefined)
  const updatePanels = useCallback((value: ReadingState['panels']) => {
    const next =
      value.outline && value.info && usesPanelDrawers(readerNode.current)
        ? { ...value, outline: false }
        : value
    panels.current = next
    setPanelState(next)
  }, [])
  useEffect(() => {
    const node = readerNode.current
    if (!node || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => {
      if (panels.current.outline && panels.current.info && usesPanelDrawers(node)) {
        updatePanels(panels.current)
        saveReadingState.current()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [updatePanels])
  const readingVisible = useRef(tab.visible && !document.hidden)
  const updateReadingVisibility = useRef<() => void>(() => undefined)
  const [attempt, setAttempt] = useState(0)
  const canOpenZotero = useRemoteAccess('zotero/openProtocol')
  const canReadAnnotations = useRemoteAccess('zotero/readerAnnotations')
  const canReadParsed = useRemoteAccess('zotero/documentArtifact')
  // PDF.js can report the same range on selectionchange, pointerup, and keyup.
  const selectionRange =
    selection &&
    JSON.stringify([
      selection.text,
      selection.pages.map(({ pageIndex, textOffset }) => [pageIndex, textOffset]),
    ])
  useEffect(() => {
    setLocatingSelection(false)
    return () => {
      parsedSelectionRequest.current?.abort()
      parsedSelectionRequest.current = undefined
    }
  }, [canReadParsed, openParsedPassage, selectionRange, tabSignal])
  const canReadDetails = useRemoteAccess('zotero/readerDetails')
  const canReadNotes = useRemoteAccess('zotero/readerNote')
  const canTranslate = useRemoteAccess('zotero/readerTranslate')
  const canSuggestAnnotation = useRemoteAccess('zotero/readerSuggestAnnotation')
  const canWriteNotes = useAccess('zotero/readerWriteNote')
  const canReadJournalMetrics = useRemoteAccess('zotero/journalMetrics')
  const canExport = useRemoteAccess('zotero/export')
  const canWriteAnnotations = useAccess('zotero/readerUpdateAnnotation')
  const canCreateAnnotations = useAccess('zotero/readerCreateAnnotations')
  const canDeleteAnnotations = useAccess('zotero/readerDeleteAnnotation')
  const canUseSession = useSession(canUseSessionActions)
  const annotationMutationsAllowed = canUseSession && annotationWriteEnabled
  const canEditAnnotations = canWriteAnnotations && annotationMutationsAllowed
  const canRemoveAnnotations = canDeleteAnnotations && annotationMutationsAllowed
  const attachment = refFieldsOf(documentRef)
  const pdfSource = attachment &&
    view && {
      attachmentRef: documentRef,
      itemRef: location?.parentRef,
      instanceId: attachment.serverId,
      libraryRef: `zotero://${attachment.libraryType}/${attachment.libraryId}/`,
      title: tab.navigation.params?.title ?? t('title'),
      fingerprint: view.fingerprint,
    }
  const canAnnotateSelection =
    canCreateAnnotations &&
    annotationMutationsAllowed &&
    attachment?.libraryType === 'user' &&
    Number(attachment.libraryId) === 0
  useEffect(() => () => annotationWrite.current?.abort(), [])
  useEffect(() => {
    const node = host.current
    if (!node || tabSignal.aborted) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    setView(undefined)
    setFindStatus(undefined)
    setQuoteTarget(undefined)
    setLocation(undefined)
    setError(undefined)
    setPasswordRequest(undefined)
    setOutline([])
    setOutlineError(false)
    setSelection(undefined)
    setCaptureOpen(false)
    setTranslation(undefined)
    translationCache.current.clear()
    setAnnotationDraft(undefined)
    setCreationResult(undefined)
    setAnnotationChoices([])
    setActionNotice(undefined)
    let position:
      | Omit<ReadingState, 'attachmentRef' | 'panels' | 'readingSeconds' | 'lastVisitedAt'>
      | undefined
    let saved: ReadingState | undefined
    let fingerprint = ''
    let attachmentRef = documentRef
    let itemRef: string | undefined
    let sectionTitle: string | undefined
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let startedAt: number | undefined
    let elapsed = 0
    let lastVisitedAt: number | undefined
    const flush = () => {
      clearTimeout(saveTimer)
      if (!position) return
      if (startedAt !== undefined) lastVisitedAt = Date.now()
      if (lastVisitedAt === undefined) return
      history.save({
        ...position,
        attachmentRef,
        fingerprint,
        itemRef,
        title: documentTitle.current?.slice(0, 500),
        sectionPath: sectionTitle === undefined ? undefined : [sectionTitle],
        panels: panels.current,
        readingSeconds:
          (saved?.readingSeconds ?? 0) +
          (elapsed + (startedAt === undefined ? 0 : performance.now() - startedAt)) / 1000,
        lastVisitedAt,
      })
    }
    const updateVisibility = () => {
      if (readingVisible.current && position && startedAt === undefined) {
        startedAt = performance.now()
        flush()
      } else if (!readingVisible.current && startedAt !== undefined) {
        elapsed += performance.now() - startedAt
        startedAt = undefined
        lastVisitedAt = Date.now()
        flush()
      }
    }
    saveReadingState.current = flush
    updateReadingVisibility.current = updateVisibility
    void (async () => {
      const file = await resolve(documentRef, signal)
      signal.throwIfAborted()
      setLocation(file)
      attachmentRef = file.ref
      itemRef = file.parentRef
      const runtime = await load()
      if (!runtime) throw new Error(t('unavailable'))
      signal.throwIfAborted()
      const bytes = await read(sessionId, file.path, signal)
      signal.throwIfAborted()
      let pendingView: PdfView | undefined
      const reportPage = (next: PdfView) => {
        if (signal.aborted) return
        sectionTitle = next.sectionTitle
        if (!controls.current) {
          pendingView = next
          return
        }
        setView(next)
        setPageInput(String(next.page))
      }
      const mounted = await runtime.mountPdf(
        node,
        bytes,
        signal,
        reportPage,
        {
          restore(currentFingerprint) {
            fingerprint = currentFingerprint
            saved = history.restore(attachmentRef, fingerprint)
            updatePanels(saved?.panels ?? { outline: false, info: false })
            return saved
          },
          onPosition(next) {
            if (signal.aborted) return
            position = next
            updateVisibility()
            setZoomFactor((current) => (current === next.zoom ? current : next.zoom))
            setFitMode((current) => (current === next.fitMode ? current : next.fitMode))
            clearTimeout(saveTimer)
            saveTimer = setTimeout(flush, 400)
          },
        },
        {
          onPassword(request) {
            if (signal.aborted) return
            setPasswordRequest({
              ...request,
              cancel() {
                controller.abort()
                setPasswordRequest(undefined)
                setError(t('passwordCanceled'))
              },
            })
          },
          onSelection(next) {
            if (!signal.aborted) setSelection(next)
          },
          onAnnotationPick(refs) {
            if (signal.aborted) return
            updatePanels({ ...panels.current, info: true, infoTab: 'annotations' })
            saveReadingState.current()
            setAnnotationChoices(refs.length > 1 ? refs : [])
            setSelectedAnnotation(refs.length === 1 ? refs[0] : undefined)
          },
          onFindStatus(status) {
            if (!signal.aborted) setFindStatus((current) => ({ ...current, ...status }))
          },
        },
      )
      if (signal.aborted) mounted.dispose()
      else {
        controls.current = mounted
        if (pendingView) reportPage(pendingView)
        try {
          const items = await mounted.getOutline()
          if (!signal.aborted) setOutline(items)
        } catch {
          if (!signal.aborted) setOutlineError(true)
        }
      }
    })().catch((cause: unknown) => {
      if (signal.aborted) return
      setPasswordRequest(undefined)
      setError(messageOf(cause))
    })
    return () => {
      flush()
      saveReadingState.current = () => undefined
      updateReadingVisibility.current = () => undefined
      controller.abort()
      controls.current = null
    }
  }, [attempt, documentRef, history, load, read, resolve, sessionId, t, tabSignal, updatePanels])

  useEffect(() => {
    const update = () => {
      readingVisible.current = tab.visible && !document.hidden
      updateReadingVisibility.current()
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [tab.visible])

  const citationChanged = Boolean(
    view && expectedFingerprint && view.fingerprint !== expectedFingerprint,
  )
  const citationUnverified = Boolean(
    view &&
    expectedFingerprint &&
    (!view.fingerprint.startsWith('sha256:') || !expectedFingerprint.startsWith('sha256:')),
  )
  const targetPageIndex = targetArtifact?.artifactRegion.pageIndex ?? targetPosition?.pageIndex
  const citationMissingPage = Boolean(
    view &&
    expectedFingerprint &&
    targetPageIndex !== undefined &&
    (!Number.isInteger(targetPageIndex) || targetPageIndex < 0 || targetPageIndex >= view.count),
  )
  useEffect(() => {
    setEvidenceLocation(undefined)
    const pdf = controls.current
    if (!view?.fingerprint || !pdf || tabSignal.aborted) return
    const stale = citationChanged || citationUnverified || citationMissingPage
    pdf.setEvidence(stale ? undefined : targetPosition)
    if ((!targetQuote && !targetArtifact) || targetPosition || stale) return
    const request = new AbortController()
    const signal = AbortSignal.any([request.signal, tabSignal])
    setEvidenceLocation({
      kind: 'locating',
      cancel() {
        request.abort()
        setEvidenceLocation(undefined)
      },
    })
    const locate = targetArtifact
      ? pdf.artifactPosition(targetArtifact.artifactRegion, signal).then((position) => {
          if (!signal.aborted) pdf.setEvidence(position)
          return position.rects.length
            ? { kind: 'region' as const, pageIndex: position.pageIndex }
            : { kind: 'page' as const, pageIndex: position.pageIndex }
        })
      : pdf.locateEvidence(targetQuote!, signal)
    void locate.then(
      (location) => {
        if (!signal.aborted) setEvidenceLocation(location)
      },
      () => {
        if (!signal.aborted) setEvidenceLocation({ kind: 'failed' })
      },
    )
    return () => request.abort()
  }, [
    citationChanged,
    citationUnverified,
    citationMissingPage,
    targetPosition,
    targetQuote,
    targetArtifact,
    tab.navigation.revision,
    tabSignal,
    view?.fingerprint,
  ])

  const locateInParsed = async (
    pages: readonly PdfPageRegion[],
    quote?: string,
    signal = tabSignal,
  ) => {
    if (!pdfSource || !openParsedPassage || signal.aborted) return false
    const text = quote && quote.length <= 2_000 ? quote : undefined
    const region =
      pages.length === 1 ? await controls.current?.artifactSelection(pages[0], signal) : undefined
    if (signal.aborted || (!text && !region)) return false
    return await openParsedPassage(sessionId, pdfSource, { quote: text, region }, signal)
  }

  const locateSelectionInParsed = async () => {
    if (!selection || parsedSelectionRequest.current || tabSignal.aborted) return
    const controller = new AbortController()
    parsedSelectionRequest.current = controller
    const signal = AbortSignal.any([tabSignal, controller.signal])
    setLocatingSelection(true)
    setActionNotice(undefined)
    try {
      const opened = await locateInParsed(selection.pages, selection.text, signal)
      if (!signal.aborted && !opened) setActionNotice(t('parsedMissing'))
    } catch {
      if (!signal.aborted) setActionNotice(t('parsedOpenFailed'))
    } finally {
      if (parsedSelectionRequest.current === controller) parsedSelectionRequest.current = undefined
      if (!signal.aborted) setLocatingSelection(false)
    }
  }

  const readCaptureText = async (pages: readonly PdfPageRegion[], signal: AbortSignal) => {
    const pdf = controls.current
    if (!pdf || !pdfSource || !readParsedText) return undefined
    const regions = []
    for (const page of pages) {
      const region = await pdf.artifactSelection(page, signal)
      signal.throwIfAborted()
      if (!region?.box) continue
      const [left, top, right, bottom] = region.box
      const box = [Math.ceil(left), Math.ceil(top), Math.floor(right), Math.floor(bottom)] as const
      if (box[0] < box[2] && box[1] < box[3]) regions.push({ pageIndex: page.pageIndex, box })
    }
    if (!regions.length) return undefined
    const result = await readParsedText(sessionId, pdfSource, regions, signal)
    return result && { ...result, incomplete: result.incomplete || regions.length !== pages.length }
  }

  const documentReady = view !== undefined
  useEffect(() => {
    if (!documentReady || !canReadAnnotations || tabSignal.aborted) {
      setAnnotationRows([])
      setAnnotationOffset(undefined)
      setAnnotationWriteEnabled(false)
      return
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    setAnnotationError(false)
    setAnnotationOffset(undefined)
    void annotations(
      { sessionId, ref: documentRef, offset: requestedOffset, limit: ZOTERO_CHILD_PAGE_ROWS },
      signal,
    ).then(
      (page) => {
        if (signal.aborted) return
        setAnnotationRows((rows) =>
          requestedOffset === 0
            ? page.items
            : [...new Map([...rows, ...page.items].map((row) => [row.ref, row])).values()],
        )
        setAnnotationOffset(page.nextOffset)
        setAnnotationWriteEnabled(page.writeEnabled)
      },
      () => {
        if (signal.aborted) return
        setAnnotationError(true)
        setAnnotationWriteEnabled(false)
      },
    )
    return () => controller.abort()
  }, [
    annotationRevision,
    annotations,
    canReadAnnotations,
    documentReady,
    documentRef,
    requestedOffset,
    sessionId,
    tabSignal,
  ])

  const visibleAnnotations = useMemo(
    () =>
      annotationRows.filter(
        (row) =>
          (!annotationFilter || row.type === annotationFilter) &&
          (!annotationColorFilter || annotationColorOf(row.color) === annotationColorFilter),
      ),
    [annotationRows, annotationFilter, annotationColorFilter],
  )
  const chosenAnnotations = visibleAnnotations.filter(({ ref }) => annotationChoices.includes(ref))
  useEffect(() => {
    if (documentReady)
      controls.current?.setAnnotations(canReadAnnotations ? visibleAnnotations : [])
  }, [visibleAnnotations, canReadAnnotations, documentReady])

  useEffect(() => {
    controls.current?.setSelectedAnnotation(selectedAnnotation)
  }, [selectedAnnotation, view?.fingerprint])
  useEffect(() => {
    if (annotationsOpen) selectedAnnotationRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [annotationsOpen, selectedAnnotation])

  const refreshAnnotations = () => {
    setRequestedOffset(0)
    setAnnotationRevision((revision) => revision + 1)
  }

  const runAnnotationWrite = async (
    operation: (signal: AbortSignal) => Promise<void>,
    onError: (cause: unknown) => void,
  ) => {
    if (tabSignal.aborted || annotationWrite.current) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    annotationWrite.current = controller
    setAnnotationBusy(true)
    try {
      await operation(signal)
    } catch (cause) {
      if (!signal.aborted) onError(cause)
    } finally {
      annotationWrite.current = undefined
      if (!signal.aborted) setAnnotationBusy(false)
    }
  }

  const changeAnnotation = async (
    submit: (signal: AbortSignal) => Promise<ZoteroLibraryWriteResultView>,
    close: () => void,
    failure: 'annotationSaveFailed' | 'annotationDeleteFailed',
  ) => {
    await runAnnotationWrite(
      async (signal) => {
        setAnnotationNotice(undefined)
        const result = await submit(signal)
        if (signal.aborted) return
        const conflict = result.code === 'ZOTERO_WRITE_CONFLICT'
        setAnnotationNotice({
          message: conflict ? t('annotationConflict') : result.message,
          warning: conflict || result.kind === 'committed-unverified',
        })
        if (
          result.kind === 'applied' ||
          result.kind === 'committed-unverified' ||
          conflict ||
          result.code === 'ZOTERO_NOT_FOUND'
        ) {
          close()
          refreshAnnotations()
        }
      },
      (cause) => {
        setAnnotationNotice({ message: t(failure, { message: messageOf(cause) }), warning: false })
        if (asRecord(remoteErrorOf(cause)?.details)?.code === 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE')
          return
        close()
        refreshAnnotations()
      },
    )
  }

  const saveAnnotation = async (
    changes: Pick<ZoteroReaderUpdateAnnotationRequest, 'set' | 'tagChanges'>,
  ) => {
    const row = annotationEdit
    const expectedVersion = row?.version
    if (!canEditAnnotations || !row || expectedVersion === undefined) return
    await changeAnnotation(
      (signal) =>
        updateAnnotation({ sessionId, ref: row.ref, expectedVersion, ...changes }, signal),
      () => closeAnnotationEdit(row.ref),
      'annotationSaveFailed',
    )
  }

  const restoreAnnotationFocus = (action: 'editRef' | 'deleteRef', ref: string) => {
    const selector = action === 'editRef' ? '[data-edit-ref]' : '[data-delete-ref]'
    requestAnimationFrame(() => {
      if (!readingVisible.current || tabSignal.aborted) return
      const buttons = readerNode.current?.querySelectorAll<HTMLButtonElement>(selector)
      if (!buttons) return
      for (const button of buttons) {
        if (button.dataset[action] !== ref) continue
        button.focus()
        break
      }
    })
  }

  const closeAnnotationEdit = (ref: string) => {
    setAnnotationEdit(undefined)
    restoreAnnotationFocus('editRef', ref)
  }

  const removeAnnotation = async () => {
    const row = annotationDelete
    const expectedVersion = row?.version
    if (!canRemoveAnnotations || !row || expectedVersion === undefined) return
    await changeAnnotation(
      (signal) => deleteAnnotation({ sessionId, ref: row.ref, expectedVersion }, signal),
      () => setAnnotationDelete(undefined),
      'annotationDeleteFailed',
    )
  }

  const saveSelection = async (form: FormData) => {
    if (!canAnnotateSelection || !annotationDraft) return
    await runAnnotationWrite(
      async (signal) => {
        setCreationResult(undefined)
        setActionNotice(undefined)
        const result = await createAnnotations(
          {
            type: annotationDraft.type,
            pages: annotationDraft.selection.pages,
            sessionId,
            ref: documentRef,
            color: String(form.get('color') ?? DEFAULT_ANNOTATION_COLOR),
            comment: String(form.get('comment') ?? ''),
          },
          signal,
        )
        if (signal.aborted) return
        setAnnotationDraft(undefined)
        setSelection(undefined)
        setCreationResult(result)
        if (result.kind === 'settled') refreshAnnotations()
      },
      (cause) => {
        setActionNotice(t('annotationSaveFailed', { message: messageOf(cause) }))
        if (asRecord(remoteErrorOf(cause)?.details)?.code === 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE')
          return
        setAnnotationDraft(undefined)
        setSelection(undefined)
        refreshAnnotations()
      },
    )
  }

  const insertSelection = (
    excerpt: PdfSelection,
    action: 'quote' | 'ask' | 'translateInChat' | 'translationQuote',
    options?: { translation?: ReaderTranslationResult; language?: string },
  ) => {
    if (!inputActions || tabSignal.aborted) return false
    const pages = excerpt.pages.slice(0, MAX_EXCERPT_PAGES)
    const pageListTruncated = pages.length < excerpt.pages.length
    const pageList = `${pages.map(({ pageIndex }) => pageIndex + 1).join(', ')}${pageListTruncated ? ', …' : ''}`
    const withGeometry =
      excerpt.canAnnotate &&
      pages.length > 0 &&
      !pageListTruncated &&
      pages.reduce((count, page) => count + page.rects.length, 0) <= MAX_EXCERPT_RECTS
    const source = pageList
      ? t('quoteSource', { ref: documentRef, pages: pageList })
      : t('quoteDocumentSource', { ref: documentRef })
    const translation = options?.translation
    const provenance = pdfSource && {
      ...pdfSource,
      sourceType: 'selection',
      precision: withGeometry ? 'region' : pages.length > 0 ? 'page' : 'document',
      ...(pageListTruncated ? { pageListTruncated } : {}),
      ...(excerpt.textTruncated ? { textTruncated: true } : {}),
      ...(translation && {
        translation: { target: translation.target, engine: translation.engine },
      }),
      pages: pages.map(({ pageIndex, pageLabel, rects }) => ({
        pageIndex,
        pageLabel,
        ...(withGeometry ? { rects } : {}),
      })),
    }
    const intent =
      action === 'ask'
        ? t('askPrompt')
        : options?.language !== undefined
          ? t('translationPrompt', { language: options.language })
          : undefined
    const body =
      translation === undefined
        ? excerpt.text
        : `${excerpt.text}\n\n${t('translationResult')}\n${translation.text}`
    const draft = [
      intent,
      source,
      body,
      excerpt.textTruncated && t('selectionTextTruncated'),
      provenance && JSON.stringify(provenance),
    ]
      .filter(Boolean)
      .join('\n\n')
    if (
      !inputActions.insertQuote(draft, {
        label: t(action),
        title: pdfSource?.title ?? tab.navigation.params?.title ?? t('title'),
        ...(pageList ? { detail: t('selectionPages', { pages: pageList }) } : {}),
        body,
      })
    ) {
      setActionNotice(t('quoteFailed'))
      return false
    }
    inputActions.persistDraft()
    setActionNotice(undefined)
    return true
  }

  const toggleOutline = () => {
    const open = !outlineOpen
    const collapse = open && usesPanelDrawers(readerNode.current)
    updatePanels({
      ...panels.current,
      outline: open,
      ...(collapse ? { info: false, infoTab: undefined } : {}),
    })
    saveReadingState.current()
  }

  const toggleRightPanel = (panel: NonNullable<ReadingState['panels']['infoTab']>) => {
    const next = rightPanel === panel ? undefined : panel
    updatePanels({
      ...panels.current,
      info: next !== undefined,
      infoTab: next,
    })
    saveReadingState.current()
  }

  // Selection actions take the page edge away from the text they act on.
  const actionsSide = selection?.nearBottom ? 'top' : 'bottom'
  const quotedAnnotation = quoteTarget?.annotationRef
    ? annotationRows.find(({ ref }) => ref === quoteTarget.annotationRef)
    : undefined

  return (
    <section className={css.reader} ref={readerNode} aria-label={t('title')}>
      {view && (
        <ReaderToolbar
          t={t}
          view={view}
          pageInput={pageInput}
          onPageInput={setPageInput}
          onGoTo={(page) => controls.current?.goTo(page)}
          outlineOpen={outlineOpen}
          onToggleOutline={toggleOutline}
          onCapture={() => setCaptureOpen(true)}
          inert={captureOpen}
          quote={
            inputActions
              ? {
                  open: Boolean(quoteTarget && !quoteTarget.annotationRef),
                  toggle: () =>
                    setQuoteTarget((current) =>
                      current && !current.annotationRef ? undefined : {},
                    ),
                }
              : undefined
          }
          annotations={
            canReadAnnotations
              ? {
                  open: annotationsOpen,
                  toggle: () => toggleRightPanel('annotations'),
                }
              : undefined
          }
          details={
            canReadDetails
              ? { open: rightPanel === 'details', toggle: () => toggleRightPanel('details') }
              : undefined
          }
        />
      )}
      {quoteTarget &&
        view &&
        pdfSource &&
        inputActions &&
        controls.current &&
        (!quoteTarget.annotationRef || (canReadAnnotations && quotedAnnotation)) && (
          <ReaderQuote
            key={`${view.fingerprint}:${quotedAnnotation?.ref ?? ''}:${quotedAnnotation?.version ?? ''}`}
            t={t}
            source={pdfSource}
            view={view}
            outline={outline}
            annotation={quotedAnnotation}
            tabSignal={tabSignal}
            inputActions={inputActions}
            review={reviews && { store: reviews, sessionId }}
            read={controls.current.readExcerpt}
            pageLabel={controls.current.pageLabel}
            onClose={() => setQuoteTarget(undefined)}
          />
        )}
      {translation && (
        <ReaderTranslation
          key={`${canTranslate && canUseSession}:${translation.text}`}
          t={t}
          text={translation.text}
          tabSignal={tabSignal}
          cache={translationCache.current}
          onClose={() => setTranslation(undefined)}
          modelTranslation={
            canTranslate && canUseSession
              ? (text, target, signal) => translate({ sessionId, text, target }, signal)
              : undefined
          }
          onQuote={
            inputActions
              ? (result) =>
                  insertSelection(translation, 'translationQuote', { translation: result })
              : undefined
          }
          onModelRequest={
            inputActions
              ? (language) => insertSelection(translation, 'translateInChat', { language })
              : undefined
          }
        />
      )}
      {creationResult && (
        // One receipt for one write: a failed page is part of the same
        // announcement, so the region stays polite instead of interrupting.
        <div className={css.status} role="status">
          {creationResult.kind === 'declined' ? (
            t('annotationsDeclined')
          ) : (
            <ul>
              {creationResult.pages.map((entry) => (
                <li
                  key={entry.pageIndex}
                  className={entry.status === 'committed-unverified' ? css.warning : undefined}
                >
                  {entry.status === 'applied'
                    ? t('annotationCreated', { page: entry.pageIndex + 1 })
                    : entry.status === 'failed'
                      ? t('annotationCreateFailed', {
                          page: entry.pageIndex + 1,
                          message: entry.message,
                        })
                      : t('annotationCreateUnverified', { page: entry.pageIndex + 1 })}
                  {entry.status === 'committed-unverified' && entry.ref !== undefined && (
                    <details className={css.disclosure}>
                      <summary>{t('annotationUnverifiedDetail')}</summary>
                      <p className={css.status}>
                        {t('annotationUnverifiedRef', { ref: entry.ref })}
                      </p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {actionNotice && (
        <p className={css.status} role="status">
          {actionNotice}
        </p>
      )}
      {evidenceLocation && (evidenceLocation.kind !== 'region' || targetArtifact) && (
        <div className={css.status}>
          <span role="status">
            {evidenceLocation.kind === 'region'
              ? t('evidenceArtifactRegion')
              : evidenceLocation.kind === 'page' && targetArtifact
                ? t('evidenceArtifactPage')
                : evidenceLocation.kind === 'page' && evidenceLocation.endPageIndex !== undefined
                  ? t('evidencePageSpan', {
                      first: evidenceLocation.pageIndex + 1,
                      last: evidenceLocation.endPageIndex + 1,
                    })
                  : t(evidenceStatusKey[evidenceLocation.kind])}
          </span>
          {evidenceLocation.kind === 'locating' && (
            <Button variant="ghost" size="sm" onClick={evidenceLocation.cancel}>
              {t('cancel')}
            </Button>
          )}
          {evidenceLocation.kind === 'ambiguous' && (
            <select
              className={css.field}
              aria-label={t('evidenceChoosePage')}
              value=""
              onChange={(event) => controls.current?.goTo(Number(event.currentTarget.value))}
            >
              <option value="" disabled>
                {t('evidenceChoosePage')}
              </option>
              {evidenceLocation.pages.map((pageIndex) => (
                <option key={pageIndex} value={pageIndex + 1}>
                  {t('recentPage', { page: pageIndex + 1 })}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {(citationChanged || citationUnverified || citationMissingPage) && (
        <p className={css.status} role="status">
          {t(
            citationUnverified
              ? 'quoteFingerprintUnverified'
              : citationChanged
                ? 'quoteAttachmentChanged'
                : 'quotePageUnavailable',
          )}
        </p>
      )}
      {passwordRequest && (
        <form
          className={`${css.status} ${css.failure}`}
          aria-label={t('passwordUnlock')}
          onSubmit={(event) => {
            event.preventDefault()
            const password = new FormData(event.currentTarget).get('pdf-password')
            if (typeof password !== 'string' || !password) return
            event.currentTarget.reset()
            setPasswordRequest(undefined)
            passwordRequest.submit(password)
          }}
        >
          <label className={css.fieldLabel}>
            {t('passwordRequired')}
            <input
              className={css.field}
              type="password"
              name="pdf-password"
              autoComplete="off"
              autoFocus
              required
              aria-invalid={passwordRequest.incorrect || undefined}
              aria-describedby={passwordRequest.incorrect ? 'reader-password-error' : undefined}
            />
          </label>
          {passwordRequest.incorrect && (
            <p id="reader-password-error" role="alert">
              {t('passwordIncorrect')}
            </p>
          )}
          <div className={css.controls}>
            <Button size="sm" variant="outline" type="button" onClick={passwordRequest.cancel}>
              {t('cancel')}
            </Button>
            <Button size="sm" variant="primary" type="submit">
              {t('passwordUnlock')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <div className={`${css.status} ${css.failure}`}>
          <p role="alert" className={css.failureMessage}>
            <StateDot state="error" />
            {t('failed', { message: error })}
          </p>
          <div className={css.controls}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAttempt((current) => current + 1)}
            >
              {t('retry')}
            </Button>
            {location && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  tab.actions.openResource(fileAddressFor(sessionId, undefined, location.path), {
                    replaceTab: true,
                  })
                }
              >
                {t('native')}
              </Button>
            )}
          </div>
        </div>
      )}
      {!passwordRequest && !error && !view && (
        <p className={`${css.status} ${css.loading}`} role="status" aria-busy="true">
          <StateDot state="ongoing" size={28} />
          {t('loading')}
        </p>
      )}
      <div className={css.body}>
        {view && outlineOpen && (
          <ReaderPanel
            t={t}
            side="left"
            label={t('outline')}
            layout={panelState.outlineLayout}
            inert={captureOpen}
            save={(outlineLayout) => {
              updatePanels({ ...panels.current, outlineLayout })
              saveReadingState.current()
            }}
          >
            <nav aria-label={t('outline')}>
              {outlineError ? (
                <p role="alert">{t('outlineFailed')}</p>
              ) : outline.length === 0 ? (
                <p className={css.empty}>{t('outlineEmpty')}</p>
              ) : (
                <OutlineEntries
                  items={outline}
                  activeId={view.sectionId}
                  navigate={(destination) => {
                    void controls.current
                      ?.goToOutline(destination)
                      .catch(() => setOutlineError(true))
                  }}
                />
              )}
            </nav>
          </ReaderPanel>
        )}
        <div className={css.pageArea}>
          <div className={css.surface} ref={host} {...(captureOpen ? { inert: '' } : {})} />
          {view && !selection && (
            <ReaderFloatBar
              t={t}
              inert={captureOpen}
              zoom={zoomFactor}
              fitMode={fitMode}
              query={query}
              findStatus={findStatus}
              onQuery={(value) => {
                setQuery(value)
                setFindStatus(undefined)
              }}
              onFind={(backwards) => {
                if (!query.trim()) {
                  setFindStatus(undefined)
                  return
                }
                setFindStatus({ state: 'pending', current: 0, total: 0 })
                controls.current?.find(query, backwards)
              }}
              onZoom={(factor) => controls.current?.zoom(factor)}
              onFit={(mode) => controls.current?.fit(mode)}
              onRotate={(step) => controls.current?.rotate(step)}
              onOpenZotero={
                canOpenZotero
                  ? () => {
                      const url = pdfUrlOf(documentRef, { page: String(view.page) })
                      if (url)
                        void openProtocol(url).then(
                          (ok) => setActionNotice(ok ? undefined : t('zoteroFailed')),
                          () => setActionNotice(t('zoteroFailed')),
                        )
                    }
                  : undefined
              }
            />
          )}
          {selection && !annotationDraft && (
            <div
              className={css.actionBar}
              data-side={actionsSide}
              role="group"
              aria-label={t('selection')}
            >
              {selection.textTruncated && <span role="status">{t('selectionTextTruncated')}</span>}
              <Button
                size="sm"
                onClick={() => {
                  void writeClipboard(selection.text).then(
                    (copied) => setActionNotice(t(copied ? 'copied' : 'copyFailed')),
                    () => setActionNotice(t('copyFailed')),
                  )
                }}
              >
                {t('copy')}
              </Button>
              {inputActions && (
                <>
                  <Button
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSelection(selection, 'quote')}
                  >
                    {t('quote')}
                  </Button>
                  <Button
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSelection(selection, 'ask')}
                  >
                    {t('ask')}
                  </Button>
                </>
              )}
              {openParsedPassage &&
                canReadParsed &&
                pdfSource &&
                !selection.textTruncated &&
                selection.text.length <= 2_000 && (
                  <Button
                    size="sm"
                    disabled={locatingSelection}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void locateSelectionInParsed()}
                  >
                    {t('locateInParsed')}
                  </Button>
                )}
              {(inputActions ||
                (canTranslate && canUseSession) ||
                browserTranslationProvider()) && (
                <Button
                  size="sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setTranslation(selection)}
                >
                  {t('translate')}
                </Button>
              )}
              {canAnnotateSelection &&
                (!selection.canAnnotate || selection.pages.length > ZOTERO_WRITE_OBJECT_BATCH) && (
                  <span role="status">{t('selectionAnnotationUnavailable')}</span>
                )}
              {canAnnotateSelection &&
                selection.canAnnotate &&
                selection.pages.length <= ZOTERO_WRITE_OBJECT_BATCH &&
                !annotationDraft && (
                  <>
                    <Button
                      size="sm"
                      disabled={annotationBusy}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setAnnotationDraft({ type: 'highlight', selection })}
                    >
                      {t('addHighlight')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={annotationBusy}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setAnnotationDraft({ type: 'underline', selection })}
                    >
                      {t('addUnderline')}
                    </Button>
                  </>
                )}
            </div>
          )}
          {annotationDraft && canAnnotateSelection && (
            <form
              className={css.actionBar}
              data-side={actionsSide}
              aria-label={t(annotationDraft.type === 'highlight' ? 'addHighlight' : 'addUnderline')}
              onSubmit={(event) => {
                event.preventDefault()
                if (!annotationBusy) void saveSelection(new FormData(event.currentTarget))
              }}
            >
              <fieldset disabled={annotationBusy} className={`${css.fieldset} ${css.controls}`}>
                <legend>
                  {t('selectionPages', {
                    pages: annotationDraft.selection.pages
                      .map((page) => page.pageIndex + 1)
                      .join(', '),
                  })}
                </legend>
                <label>
                  {t('annotationColor')}{' '}
                  <input
                    className={css.swatch}
                    type="color"
                    name="color"
                    defaultValue={DEFAULT_ANNOTATION_COLOR}
                  />
                </label>
                <AnnotationComment
                  t={t}
                  signal={tabSignal}
                  suggest={
                    canSuggestAnnotation &&
                    suggestAnnotation &&
                    !annotationDraft.selection.textTruncated &&
                    annotationDraft.selection.text.length <= ZOTERO_READER_TRANSLATION_SOURCE_CHARS
                      ? (signal) =>
                          suggestAnnotation(
                            { sessionId, text: annotationDraft.selection.text },
                            signal,
                          )
                      : undefined
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setAnnotationDraft(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button size="sm" variant="primary" type="submit">
                  {annotationBusy ? t('annotationSaving') : t('annotationSave')}
                </Button>
              </fieldset>
            </form>
          )}
          {captureOpen && pdfSource && controls.current && (
            <ReaderCapture
              t={t}
              defaultIncludeSource={defaultCaptureWatermark?.() ?? false}
              tabSignal={tabSignal}
              source={pdfSource}
              capture={controls.current.capture}
              locateInParsed={openParsedPassage && canReadParsed ? locateInParsed : undefined}
              readParsedText={readParsedText && canReadParsed ? readCaptureText : undefined}
              inputActions={inputActions}
              onClose={() => setCaptureOpen(false)}
            />
          )}
        </div>
        {view &&
          ((rightPanel === 'details' && canReadDetails) ||
            (annotationsOpen && canReadAnnotations)) && (
            <ReaderPanel
              t={t}
              side="right"
              label={t(rightPanel === 'details' ? 'details' : 'annotations')}
              layout={panelState.infoLayout}
              inert={captureOpen}
              action={
                rightPanel === 'annotations' ? (
                  <Tooltip portal label={t('refresh')}>
                    <IconButton
                      shape="square"
                      icon={<IconRefreshOutlineRegular size={14} />}
                      aria-label={t('refresh')}
                      disabled={annotationBusy}
                      onClick={refreshAnnotations}
                    />
                  </Tooltip>
                ) : undefined
              }
              save={(infoLayout) => {
                updatePanels({ ...panels.current, infoLayout })
                saveReadingState.current()
              }}
            >
              {rightPanel === 'details' && canReadDetails && (
                <ReaderDetails
                  t={t}
                  sessionId={sessionId}
                  documentRef={documentRef}
                  tabSignal={tabSignal}
                  details={details}
                  readAnnotations={canReadAnnotations ? annotations : undefined}
                  visits={history.visits}
                  readNote={canReadNotes ? readNote : undefined}
                  readNoteImage={readNoteImage}
                  writeNote={canWriteNotes && canUseSession ? writeNote : undefined}
                  translate={canTranslate && canUseSession ? translate : undefined}
                  journalMetrics={
                    canReadJournalMetrics && tab.visible !== false ? journalMetrics : undefined
                  }
                  citationCopy={citationCopy}
                  canExport={canExport}
                  inputActions={inputActions}
                  resolve={resolve}
                  switchingDisabled={annotationBusy}
                  onSwitch={({ ref, title }, position) =>
                    tab.actions.openResource(readerAddress(sessionId, ref), {
                      replaceTab: true,
                      params: { title, ...(position ? { position } : {}) },
                    })
                  }
                />
              )}
              {annotationsOpen && canReadAnnotations && (
                <aside aria-label={t('annotations')}>
                  {annotationError && (
                    <>
                      <p role="alert">{t('annotationFailed')}</p>
                      <Button
                        size="sm"
                        onClick={() => setAnnotationRevision((revision) => revision + 1)}
                      >
                        {t('retry')}
                      </Button>
                    </>
                  )}
                  {annotationNotice && (
                    <p className={annotationNotice.warning ? css.warning : undefined} role="status">
                      {annotationNotice.message}
                    </p>
                  )}
                  <div className={css.annotationFilters} role="group" aria-label={t('filter')}>
                    <Pill
                      active={!annotationFilter}
                      aria-pressed={!annotationFilter}
                      onClick={() => setAnnotationFilter('')}
                    >
                      {t('allTypes')}
                    </Pill>
                    {[...new Set(annotationRows.map((row) => row.type).filter(Boolean))].map(
                      (type) => (
                        <Pill
                          key={type}
                          active={annotationFilter === type}
                          aria-pressed={annotationFilter === type}
                          onClick={() => setAnnotationFilter(type)}
                        >
                          {type}
                        </Pill>
                      ),
                    )}
                  </div>
                  <div className={css.annotationFilters} role="group" aria-label={t('filterColor')}>
                    <Pill
                      active={!annotationColorFilter}
                      aria-pressed={!annotationColorFilter}
                      onClick={() => setAnnotationColorFilter('')}
                    >
                      {t('allColors')}
                    </Pill>
                    {[...new Set(annotationRows.map((row) => annotationColorOf(row.color)))].map(
                      (color) => (
                        <Pill
                          key={color}
                          active={annotationColorFilter === color}
                          aria-pressed={annotationColorFilter === color}
                          aria-label={t('filterColorValue', { color })}
                          title={color}
                          onClick={() => setAnnotationColorFilter(color)}
                        >
                          <span
                            className={css.annotationColorSwatch}
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                        </Pill>
                      ),
                    )}
                  </div>
                  {chosenAnnotations.length > 1 && (
                    <div className={css.controls} role="group" aria-label={t('annotationOverlap')}>
                      {chosenAnnotations.map((row) => (
                        <Button
                          key={row.ref}
                          size="sm"
                          onClick={() => {
                            setSelectedAnnotation(row.ref)
                            setAnnotationChoices([])
                          }}
                        >
                          {row.text
                            ? row.text.slice(0, 80)
                            : t(row.type === 'underline' ? 'underline' : 'highlight')}
                        </Button>
                      ))}
                    </div>
                  )}
                  {annotationRows.length === 0 && !annotationError && (
                    <p className={css.empty}>{t('annotationEmpty')}</p>
                  )}
                  {inputActions && pdfSource && (
                    <ReaderBatchQuote
                      t={t}
                      kind="annotation"
                      entries={annotationRows}
                      source={pdfSource}
                      pageCount={view.count}
                      tabSignal={tabSignal}
                      inputActions={inputActions}
                    />
                  )}
                  <ul className={css.annotationList}>
                    {visibleAnnotations.map((row) => {
                      const ref = refFieldsOf(row.ref)
                      const versionedTextAnnotation =
                        row.version !== undefined &&
                        (row.type === 'highlight' || row.type === 'underline') &&
                        ref?.kind === 'annotation' &&
                        ref.libraryType === 'user' &&
                        Number(ref.libraryId) === 0
                      return (
                        <li
                          key={row.ref}
                          className={css.annotationRow}
                          data-selected={selectedAnnotation === row.ref || undefined}
                          ref={selectedAnnotation === row.ref ? selectedAnnotationRow : undefined}
                        >
                          {row.position && row.position.pageIndex < view.count ? (
                            <Button
                              size="sm"
                              aria-pressed={selectedAnnotation === row.ref}
                              onClick={() => {
                                setAnnotationChoices([])
                                setSelectedAnnotation(row.ref)
                                controls.current?.goTo(row.position!.pageIndex + 1)
                              }}
                            >
                              {row.pageLabel
                                ? t('annotationPage', {
                                    label: row.pageLabel,
                                    page: row.position.pageIndex + 1,
                                  })
                                : String(row.position.pageIndex + 1)}
                            </Button>
                          ) : (
                            <span>{t('annotationUnlocated')}</span>
                          )}
                          {(row.type === 'highlight' || row.type === 'underline') && (
                            <span className={css.controls}>
                              <span
                                className={css.annotationColorSwatch}
                                style={{ backgroundColor: annotationColorOf(row.color) }}
                                aria-hidden="true"
                              />
                              {t(row.type)}
                            </span>
                          )}
                          {row.text && <blockquote>{row.text}</blockquote>}
                          {row.comment && <p>{row.comment}</p>}
                          {inputActions && (row.text || row.comment) && (
                            <Button
                              size="sm"
                              onClick={() => setQuoteTarget({ annotationRef: row.ref })}
                            >
                              {t('quoteAnnotation')}
                            </Button>
                          )}
                          {row.tags?.length ? (
                            <p>{t('annotationTags', { tags: row.tags.join(', ') })}</p>
                          ) : null}
                          {versionedTextAnnotation &&
                            canEditAnnotations &&
                            (annotationEdit?.ref === row.ref ? (
                              <AnnotationEditor
                                row={annotationEdit}
                                t={t}
                                busy={annotationBusy}
                                onSave={saveAnnotation}
                                onClose={() => closeAnnotationEdit(annotationEdit.ref)}
                              />
                            ) : (
                              <Button
                                size="sm"
                                data-edit-ref={row.ref}
                                disabled={annotationBusy}
                                onClick={() => {
                                  setAnnotationDelete(undefined)
                                  setAnnotationEdit(row)
                                  setAnnotationNotice(undefined)
                                }}
                              >
                                {t('annotationEdit')}
                              </Button>
                            ))}
                          {versionedTextAnnotation &&
                            canRemoveAnnotations &&
                            (annotationDelete?.ref === row.ref ? (
                              // The host approval card already gates this write; a
                              // second modal here would ask the same question twice.
                              <div role="group" aria-label={t('annotationDelete')}>
                                <p>{t('annotationDeletePrompt')}</p>
                                <div className={css.controls}>
                                  <Button
                                    ref={deleteCancel}
                                    size="sm"
                                    variant="outline"
                                    disabled={annotationBusy}
                                    onClick={() => {
                                      setAnnotationDelete(undefined)
                                      restoreAnnotationFocus('deleteRef', annotationDelete.ref)
                                    }}
                                  >
                                    {t('cancel')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={annotationBusy}
                                    onClick={() => void removeAnnotation()}
                                  >
                                    {annotationBusy
                                      ? t('annotationDeleting')
                                      : t('annotationDeleteConfirm')}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                data-delete-ref={row.ref}
                                disabled={annotationBusy}
                                onClick={() => {
                                  setAnnotationEdit(undefined)
                                  setAnnotationDelete(row)
                                  setAnnotationNotice(undefined)
                                }}
                              >
                                {t('annotationDelete')}
                              </Button>
                            ))}
                        </li>
                      )
                    })}
                  </ul>
                  {annotationOffset !== undefined && (
                    <Button size="sm" onClick={() => setRequestedOffset(annotationOffset)}>
                      {t('more')}
                    </Button>
                  )}
                </aside>
              )}
            </ReaderPanel>
          )}
      </div>
    </section>
  )
}

function OutlineEntries({
  items,
  activeId,
  navigate,
}: {
  readonly items: readonly PdfOutline[]
  readonly activeId?: string
  readonly navigate: (destination: NonNullable<PdfOutline['destination']>) => void
}) {
  return (
    <ul className={css.outlineEntries}>
      {items.map((item) => {
        const { title, destination, children } = item
        return (
          <li key={item.id} className={item.id === activeId ? css.currentOutlineEntry : undefined}>
            {destination === null ? (
              <span className={css.outlineLabel} title={title}>
                {title}
              </span>
            ) : (
              <Button
                size="sm"
                className={css.outlineEntry}
                title={title}
                aria-current={item.id === activeId ? 'location' : undefined}
                onClick={() => navigate(destination)}
              >
                <span className={css.outlineLabel}>{title}</span>
              </Button>
            )}
            {children.length > 0 && (
              <OutlineEntries items={children} activeId={activeId} navigate={navigate} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
