/**
 * The parsed-document manager: one session-scoped right-sidebar tab that lists
 * every committed artifact and owns open / reparse / discard actions. The list
 * is a single host-side inventory call; no per-target probe, HEAD or MinerU
 * request runs behind the rows. Rows name the paper by the Markdown H1 the
 * parse captured, narrow by state and text, and can be discarded in bulk — one
 * request per selected artifact, so a failure never hides inside a batch.
 * @module dsh-zotero/client/enrichment/ParsedManagerTab
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button,
  Checkbox,
  IconEyeOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  SegmentedControl,
  Tag,
  Toast,
  fileSizeText,
  type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  ZoteroListParsedDocumentsResultView,
  ZoteroParsedDocumentRowView,
  ZoteroParsedDocumentState,
} from '../../contract.ts'
import { formatDateTime, joinNonEmpty } from '../../sources/presenters.js'
import { parseParsedManagerTabAddress } from '../parsed-manager-tab.ts'
import { typedRemoteResult } from './parse-controller.ts'
import {
  maxPageOf,
  shortArtifactId,
  sourceDescriptorOf,
  totalBytesOf,
} from './parsed-manager-model.ts'
import {
  useDocumentParseSurface,
  type DocumentParseDeployment,
  type DocumentParseSurfacePort,
  type ParsedDocumentManagementRemote,
} from './parse-surface.tsx'
import { LibraryPager } from '../components/library/LibraryPager.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { useTransientToast } from '../components/use-transient-toast.ts'
import css from './parsed-manager.module.css'

const PAGE_SIZE = 50
/** The library panel's own search cadence, kept in step so both feel alike. */
const SEARCH_DEBOUNCE_MS = 300
/** Selection never outlives the window it was made in; this is the empty one. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

type StateFilter = 'all' | ZoteroParsedDocumentState

const STATE_LABELS = {
  indexed: 'parsedManagerStateIndexed',
  orphan: 'parsedManagerStateOrphan',
  broken: 'parsedManagerStateBroken',
} as const

const STATE_TONES: Record<ZoteroParsedDocumentState, TagTone> = {
  indexed: 'success',
  orphan: 'warning',
  broken: 'danger',
}

const BROKEN_LABELS: Record<
  NonNullable<ZoteroParsedDocumentRowView['broken']>['code'],
  'parsedManagerBrokenMissingMeta' | 'parsedManagerBrokenUnreadableMeta'
> = {
  'missing-meta': 'parsedManagerBrokenMissingMeta',
  'unreadable-meta': 'parsedManagerBrokenUnreadableMeta',
}

export interface ParsedManagerTabFace {
  readonly management: ParsedDocumentManagementRemote
  readonly parse: DocumentParseSurfacePort
  /** Open a stored artifact as the existing parsed-document tab. */
  readonly openParsed: (sessionId: string, artifactId: string, title: string) => void
  /** Notify already-open parsed tabs that an artifact was discarded. */
  readonly discarded: (sessionId: string, artifactId: string) => void
}

export type ParsedManagerTabProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<ParsedManagerTabFace> &
  PropsLocale<'zotero'>

export function ParsedManagerTitle(
  props: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'zotero'>,
) {
  const tab = props.useTabInfo().tab
  const target = parseParsedManagerTabAddress(tab.navigation.address)
  return target === undefined ? props.t('tabParsedManagerFallback') : props.t('tabParsedManager')
}

export function ParsedManagerTab(props: ParsedManagerTabProps) {
  const tab = props.useTabInfo().tab
  const target = parseParsedManagerTabAddress(tab.navigation.address)
  const sessionId = target?.sessionId ?? ''
  const { management, parse, openParsed, discarded } = props
  const listAllowed = props.useAccess('zotero/listParsedDocuments')
  const discardAllowed = props.useAccess('zotero/discardParsedDocument')
  const startAllowed = props.useAccess('zotero/startDocumentParse')
  const readAllowed = props.useAccess('zotero/documentArtifact')
  const cancelAllowed = props.useAccess('job/kill')
  const deployment = useSyncExternalStore<DocumentParseDeployment>(
    parse.deployment.subscribe,
    parse.deployment.getSnapshot,
  )
  const sessionRemoved = props.useSession((snapshot) => snapshot.removed)
  const parseSurface = useDocumentParseSurface(
    parse,
    {
      sessionId,
      sessionAllowed: deployment.mounted && sessionId !== '' && !sessionRemoved,
      readAllowed,
      startAllowed,
      cancelAllowed,
    },
    props.t,
  )
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<StateFilter>('all')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [list, setList] = useState<ZoteroListParsedDocumentsResultView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION)
  const [confirming, setConfirming] = useState<{ ids: readonly string[]; title?: string }>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [revision, setRevision] = useState(0)
  const { toast, notify, clear } = useTransientToast()
  /** The in-flight discard aborts when the tab unmounts, like every other owned read. */
  const discardAbort = useRef<AbortController>()
  useEffect(
    () => () => {
      discardAbort.current?.abort()
    },
    [],
  )

  // Typing narrows the listing after the library panel's cadence; the window
  // and its selection belong to the old filter, so both start over.
  useEffect(() => {
    if (query === appliedQuery) return
    const timer = setTimeout(() => {
      setAppliedQuery(query)
      setPage(0)
      setSelected(EMPTY_SELECTION)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, appliedQuery])

  const load = useCallback(
    (signal: AbortSignal) => {
      if (!sessionId || !listAllowed || !deployment.mounted) return
      setBusy(true)
      setError(undefined)
      void management
        .listParsedDocuments(
          {
            sessionId,
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
            ...(filter === 'all' ? {} : { state: filter }),
            ...(appliedQuery === '' ? {} : { query: appliedQuery }),
          },
          signal,
        )
        .then((result) => {
          if (signal.aborted) return
          const value = typedRemoteResult(result)
          setList(value)
          // A window past the end means concurrent removals shrank the listing
          // under an older offset; step back to the last page instead of
          // leaving an empty page on screen.
          const last = maxPageOf(value.total, PAGE_SIZE)
          if (page > last) setPage(last)
        })
        .catch((cause: unknown) => {
          if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (!signal.aborted) setBusy(false)
        })
    },
    [management, sessionId, listAllowed, deployment.mounted, page, filter, appliedQuery],
  )

  useEffect(() => {
    const abort = new AbortController()
    load(abort.signal)
    return () => abort.abort()
  }, [load, revision, parseSurface.revision])

  const changeFilter = (next: StateFilter) => {
    setFilter(next)
    setPage(0)
    setSelected(EMPTY_SELECTION)
  }

  const toggleRow = (artifactId: string, next: boolean) => {
    setSelected((previous) => {
      const updated = new Set(previous)
      if (next) updated.add(artifactId)
      else updated.delete(artifactId)
      return updated
    })
  }

  /**
   * Discard one or many artifacts in sequence: one request per id, so a
   * failure is attributable and the survivors stay selected. The filtered
   * total shrinks by the rows the listing actually held, and the page steps
   * back when that leaves the current window past the end.
   */
  const discardRows = async (ids: readonly string[]) => {
    const abort = new AbortController()
    discardAbort.current = abort
    setBusy(true)
    setError(undefined)
    setProgress({ done: 0, total: ids.length })
    let discardedCount = 0
    let goneCount = 0
    const failed: string[] = []
    try {
      for (const artifactId of ids) {
        // The tab can only be abandoned while a request is in flight, so the
        // check after each await is the one that matters.
        try {
          const value = typedRemoteResult(
            await management.discardParsedDocument({ sessionId, artifactId }, abort.signal),
          )
          if (abort.signal.aborted) return
          if (value.kind === 'discarded') {
            discardedCount += 1
            discarded(sessionId, artifactId)
          } else goneCount += 1
        } catch (cause) {
          if (abort.signal.aborted) return
          failed.push(artifactId)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
        setProgress({ done: discardedCount + goneCount + failed.length, total: ids.length })
      }
      setSelected(new Set(failed))
      const removed = discardedCount + goneCount
      if (ids.length === 1) {
        notify(
          props.t(discardedCount === 1 ? 'parsedManagerDeleted' : 'parsedManagerMissing'),
          discardedCount === 1 ? 'success' : undefined,
        )
      } else if (failed.length === 0) {
        notify(props.t('parsedManagerBatchDeleted', { count: removed }), 'success')
      } else {
        notify(props.t('parsedManagerBatchPartial', { removed, failed: failed.length }))
      }
      const last = maxPageOf(Math.max(0, (list?.total ?? 0) - discardedCount), PAGE_SIZE)
      if (page > last) setPage(last)
      setRevision((previous) => previous + 1)
    } finally {
      if (discardAbort.current === abort) discardAbort.current = undefined
      if (!abort.signal.aborted) {
        setBusy(false)
        setProgress(undefined)
      }
    }
  }

  if (target === undefined || !deployment.mounted)
    return (
      <section className={css.surface}>
        <p className={css.status}>{props.t('parsedManagerUnavailable')}</p>
      </section>
    )

  const rows = list?.rows ?? []
  const pageIds = rows.map((row) => row.artifactId)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const filtering = filter !== 'all' || appliedQuery !== ''
  const titleOf = (row: ZoteroParsedDocumentRowView): string =>
    row.title !== undefined && row.title.trim() !== '' ? row.title : shortArtifactId(row.artifactId)
  const metaOf = (row: ZoteroParsedDocumentRowView): string => {
    // A broken row has no metadata to describe; its reason line is the copy.
    if (row.state === 'broken') return ''
    const source = sourceDescriptorOf(row)
    return joinNonEmpty(
      source === ''
        ? undefined
        : row.sourceKind === 'attachment'
          ? props.t('parsedManagerSourceAttachment', { key: source })
          : source,
      row.committedAt > 0 ? formatDateTime(row.committedAt) : undefined,
      fileSizeText(totalBytesOf(row)),
      props.t('parsedManagerChars', { count: row.characterCount }),
      row.pageCount === undefined
        ? undefined
        : props.t('libraryParsedPages', { count: row.pageCount }),
      row.images.length === 0
        ? undefined
        : props.t('parsedManagerImages', { count: row.images.length }),
      row.mode === 'pro' ? props.t('parsedManagerModePro') : undefined,
    )
  }
  const pendingDelete = confirming
  const batchConfirm = pendingDelete !== undefined && pendingDelete.ids.length > 1

  return (
    <section className={css.surface} aria-busy={busy}>
      <header className={css.toolbar}>
        <SegmentedControl
          id="zotero-parsed-manager-state"
          className={css.filterControl}
          label={props.t('parsedManagerFilterLabel')}
          value={filter}
          onChange={changeFilter}
          disabled={!listAllowed}
          options={[
            { value: 'all', label: props.t('parsedManagerFilterAll') },
            { value: 'indexed', label: props.t('parsedManagerStateIndexed') },
            { value: 'orphan', label: props.t('parsedManagerStateOrphan') },
            { value: 'broken', label: props.t('parsedManagerStateBroken') },
          ]}
        />
        <div className={css.toolbarRow}>
          <Input
            className={css.search}
            icon={<IconSearchOutlineRegular size={14} />}
            type="search"
            placeholder={props.t('parsedManagerSearchPlaceholder')}
            aria-label={props.t('parsedManagerSearchPlaceholder')}
            value={query}
            disabled={!listAllowed}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            icon={<IconSparkleRegular size={14} />}
            disabled={parseSurface.openUrl === undefined}
            onClick={() => parseSurface.openUrl?.()}
          >
            {props.t('libraryParseUrl')}
          </Button>
          <IconButton
            shape="square"
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={props.t('parsedManagerRefresh')}
            title={props.t('parsedManagerRefresh')}
            disabled={busy || !listAllowed}
            onClick={() => setRevision((previous) => previous + 1)}
          />
        </div>
        {(list !== undefined || progress !== undefined || selected.size > 0) && (
          <div className={css.statusLine} role={progress === undefined ? undefined : 'status'}>
            {progress !== undefined ? (
              <span>{props.t('parsedManagerBatchDeleting', { ...progress })}</span>
            ) : selected.size > 0 ? (
              <>
                <span>{props.t('parsedManagerSelected', { count: selected.size })}</span>
                <span className={css.statusLineActions}>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<IconTrashOutlineRegular size={14} />}
                    disabled={!discardAllowed || busy}
                    onClick={() => setConfirming({ ids: [...selected] })}
                  >
                    {props.t('parsedManagerDeleteSelected')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setSelected(EMPTY_SELECTION)}
                  >
                    {props.t('parsedManagerClearSelection')}
                  </Button>
                </span>
              </>
            ) : (
              <span>{props.t('parsedManagerTotal', { count: list?.total ?? 0 })}</span>
            )}
          </div>
        )}
      </header>
      {error !== undefined && (
        <div className={css.errorRow}>
          <p className={css.error} role="alert">
            {props.t('parsedManagerError', { message: error })}
          </p>
          {listAllowed && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setRevision((previous) => previous + 1)}
            >
              {props.t('parsedManagerRetry')}
            </Button>
          )}
        </div>
      )}
      {!listAllowed && <p className={css.status}>{props.t('parsedManagerDenied')}</p>}
      {listAllowed && list === undefined && busy && (
        <p className={css.status}>{props.t('parsedManagerLoading')}</p>
      )}
      {listAllowed && list !== undefined && rows.length === 0 && (
        <div className={css.empty}>
          <p className={css.status}>
            {props.t(filtering ? 'parsedManagerEmptyFiltered' : 'parsedManagerEmpty')}
          </p>
          {!filtering && <p className={css.hint}>{props.t('parsedManagerEmptyHint')}</p>}
        </div>
      )}
      {rows.length > 0 && (
        <div className={css.listHeader}>
          <Checkbox
            className={css.selectAll}
            checked={allOnPageSelected}
            label={props.t('parsedManagerSelectPage')}
            disabled={!discardAllowed || busy}
            onChange={(next) => setSelected(next ? new Set(pageIds) : EMPTY_SELECTION)}
          />
        </div>
      )}
      <ul className={css.list}>
        {rows.map((row) => {
          const title = titleOf(row)
          const meta = metaOf(row)
          const isSelected = selected.has(row.artifactId)
          return (
            <li
              className={isSelected ? `${css.row} ${css.rowSelected}` : css.row}
              key={row.artifactId}
            >
              <div className={css.rowHead}>
                <Checkbox
                  className={css.rowSelect}
                  checked={isSelected}
                  label={title}
                  title={row.title ?? row.artifactId}
                  disabled={!discardAllowed || busy}
                  onChange={(next) => toggleRow(row.artifactId, next)}
                />
                {row.state !== 'indexed' && (
                  <Tag tone={STATE_TONES[row.state]}>{props.t(STATE_LABELS[row.state])}</Tag>
                )}
              </div>
              <div className={css.rowMeta}>
                {meta !== '' && <span className={css.metaText}>{meta}</span>}
                <span className={css.actions}>
                  <IconButton
                    shape="square"
                    size="sm"
                    icon={<IconEyeOutlineRegular size={14} />}
                    aria-label={props.t('parsedManagerOpen')}
                    title={props.t('parsedManagerOpen')}
                    disabled={!row.actionable || row.state === 'broken'}
                    onClick={() => openParsed(sessionId, row.artifactId, title)}
                  />
                  <IconButton
                    shape="square"
                    size="sm"
                    icon={<IconSparkleRegular size={14} />}
                    aria-label={props.t('libraryParsedReparse')}
                    title={props.t('libraryParsedReparse')}
                    disabled={!row.actionable || parseSurface.openArtifact === undefined}
                    onClick={() => parseSurface.openArtifact?.(row.artifactId, title)}
                  />
                  <IconButton
                    shape="square"
                    size="sm"
                    icon={<IconTrashOutlineRegular size={14} />}
                    aria-label={props.t('parsedManagerDelete')}
                    title={props.t('parsedManagerDelete')}
                    disabled={!discardAllowed || busy}
                    onClick={() => setConfirming({ ids: [row.artifactId], title })}
                  />
                </span>
              </div>
              {row.broken !== undefined && (
                <p className={css.broken}>
                  {props.t(BROKEN_LABELS[row.broken.code])}
                  {row.broken.detail !== undefined && (
                    <span className={css.brokenDetail}>{row.broken.detail}</span>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {list !== undefined && rows.length > 0 && (
        <LibraryPager
          t={props.t}
          label={props.t('tabParsedManager')}
          offset={page * PAGE_SIZE}
          limit={PAGE_SIZE}
          total={list.total}
          returned={rows.length}
          nextOffset={(page + 1) * PAGE_SIZE < list.total ? (page + 1) * PAGE_SIZE : undefined}
          busy={busy}
          onPage={(offset) => {
            setPage(Math.floor(offset / PAGE_SIZE))
            setSelected(EMPTY_SELECTION)
          }}
        />
      )}
      <Modal
        open={confirming !== undefined}
        onClose={() => setConfirming(undefined)}
        title={props.t(
          batchConfirm ? 'parsedManagerBatchDeleteTitle' : 'parsedManagerDeleteTitle',
          {
            count: confirming?.ids.length ?? 0,
          },
        )}
        description={props.t(
          batchConfirm ? 'parsedManagerBatchDeleteDescription' : 'parsedManagerDeleteDescription',
          { count: confirming?.ids.length ?? 0, title: confirming?.title ?? '' },
        )}
        closeLabel={props.t('parsedManagerDeleteCancel')}
        footer={
          // The confirm action only exists while a target does, so the ids are
          // read from the target that opened it rather than re-checked.
          pendingDelete === undefined ? undefined : (
            <>
              <Button variant="outline" onClick={() => setConfirming(undefined)}>
                {props.t('parsedManagerDeleteCancel')}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  setConfirming(undefined)
                  void discardRows(pendingDelete.ids)
                }}
              >
                {props.t('parsedManagerDeleteConfirm')}
              </Button>
            </>
          )
        }
      />
      {toast !== null && (
        <Toast key={toast.seq} tone={toast.tone} text={toast.text} onDone={clear} />
      )}
      {parseSurface.dialog}
    </section>
  )
}
