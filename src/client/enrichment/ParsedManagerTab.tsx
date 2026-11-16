/**
 * The parsed-document manager: one session-scoped right-sidebar tab that lists
 * every committed artifact and owns open / reparse / discard actions. The list
 * is a single host-side inventory call; no per-target probe, HEAD or MinerU
 * request runs behind the rows. The chrome follows the Host's own list
 * semantics: flat rows (no card), a row checkbox whose accessible name is the
 * selection action, pills for state narrowing, and "show more" instead of a
 * pager.
 * @module dsh-zotero/client/enrichment/ParsedManagerTab
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconCloseOutlineRegular,
  IconDeliverDocRegular,
  IconEyeOutlineRegular,
  IconLinkOutlineRegular,
  IconPaperclipOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  Pill,
  StateDot,
  Tag,
  fileSizeText,
  relativeTime,
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
import { messageOf } from '../error-text.ts'
import { parseParsedManagerTabAddress } from '../parsed-manager-tab.ts'
import { typedRemoteResult } from './parse-controller.ts'
import {
  formatCount,
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
import { IconButton } from '../components/IconButton.tsx'
import css from './parsed-manager.module.css'

const PAGE_SIZE = 50
/** The widest window this panel materializes; "show more" stops there. */
const MAX_WINDOW = 200
/** The Host's panel search cadence (workspace search, plugin market). */
const SEARCH_DEBOUNCE_MS = 250
/** Selection resets when the visible window changes. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

type StateFilter = 'all' | ZoteroParsedDocumentState

const FILTERS: readonly StateFilter[] = ['all', 'indexed', 'orphan', 'broken']

const FILTER_LABELS = {
  all: 'parsedManagerFilterAll',
  indexed: 'parsedManagerFilterIndexed',
  orphan: 'parsedManagerFilterOrphan',
  broken: 'parsedManagerFilterBroken',
} as const

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

/** The host buckets the age; the words stay here, beside the row that shows them. */
const AGO_LABELS = {
  minutes: 'parsedManagerAgoMinutes',
  hours: 'parsedManagerAgoHours',
  days: 'parsedManagerAgoDays',
  months: 'parsedManagerAgoMonths',
  years: 'parsedManagerAgoYears',
} as const

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
  /**
   * Raise one transient notice in the shell overlay. It lives there, not in
   * this tab, so closing the manager does not take the report with it.
   */
  readonly notify: (text: string, tone?: 'success') => void
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
  const { management, parse, openParsed, discarded, notify } = props
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
  const [filter, setFilter] = useState<StateFilter>('all')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [list, setList] = useState<ZoteroListParsedDocumentsResultView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION)
  const [confirming, setConfirming] = useState<{ ids: readonly string[]; title?: string }>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [revision, setRevision] = useState(0)
  /** Aborts on unmount, like every other owned read. */
  const discardAbort = useRef<AbortController>()
  const moreAbort = useRef<AbortController>()
  const listGeneration = useRef(0)
  useEffect(
    () => () => {
      discardAbort.current?.abort()
      moreAbort.current?.abort()
    },
    [],
  )

  const requestOf = useCallback(
    (offset: number, limit: number) => ({
      sessionId,
      offset,
      limit,
      ...(filter === 'all' ? {} : { state: filter }),
      ...(appliedQuery === '' ? {} : { query: appliedQuery }),
    }),
    [sessionId, filter, appliedQuery],
  )

  // Typing narrows the listing after the Host's cadence; the window and its
  // selection belong to the old filter, so both start over.
  useEffect(() => {
    if (query === appliedQuery) return
    const timer = setTimeout(() => {
      setAppliedQuery(query)
      setSelected(EMPTY_SELECTION)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, appliedQuery])

  const loadFirst = useCallback(
    (signal: AbortSignal) => {
      if (!sessionId || !listAllowed || !deployment.mounted) return
      setBusy(true)
      setError(undefined)
      void management
        .listParsedDocuments(requestOf(0, PAGE_SIZE), signal)
        .then((result) => {
          if (!signal.aborted) setList(typedRemoteResult(result))
        })
        .catch((cause: unknown) => {
          if (!signal.aborted) setError(messageOf(cause))
        })
        .finally(() => {
          if (!signal.aborted) setBusy(false)
        })
    },
    [management, sessionId, listAllowed, deployment.mounted, requestOf],
  )

  useEffect(() => {
    const generation = ++listGeneration.current
    moreAbort.current?.abort()
    moreAbort.current = undefined
    setLoadingMore(false)
    const abort = new AbortController()
    loadFirst(abort.signal)
    return () => {
      abort.abort()
      if (listGeneration.current === generation) listGeneration.current++
    }
  }, [loadFirst, revision, parseSurface.revision])

  const changeFilter = (next: StateFilter) => {
    setFilter(next)
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

  /** One more page behind the rows already on screen; the window only grows. */
  const showMore = async (loaded: readonly ZoteroParsedDocumentRowView[]) => {
    if (loadingMore) return
    const generation = listGeneration.current
    const abort = new AbortController()
    moreAbort.current = abort
    setLoadingMore(true)
    setError(undefined)
    try {
      const page = typedRemoteResult(
        await management.listParsedDocuments(requestOf(loaded.length, PAGE_SIZE), abort.signal),
      )
      if (abort.signal.aborted || generation !== listGeneration.current) return
      setList(() => ({ rows: [...loaded, ...page.rows], total: page.total }))
    } catch (cause) {
      if (!abort.signal.aborted && generation === listGeneration.current) setError(messageOf(cause))
    } finally {
      if (moreAbort.current === abort) moreAbort.current = undefined
      if (!abort.signal.aborted && generation === listGeneration.current) setLoadingMore(false)
    }
  }

  /** Re-read the window the reader was looking at in one request. */
  const reloadWindow = async (target: number, signal: AbortSignal, generation: number) => {
    if (signal.aborted || generation !== listGeneration.current) return
    const limit = Math.min(MAX_WINDOW, Math.max(PAGE_SIZE, target))
    const result = typedRemoteResult(
      await management.listParsedDocuments(requestOf(0, limit), signal),
    )
    if (!signal.aborted && generation === listGeneration.current) setList(result)
  }

  /**
   * Discard one or many artifacts in sequence: one request per id, so a
   * failure is attributable and the survivors stay selected. The window is
   * re-read at its previous size, so a removal never strands the reader on a
   * page that no longer holds anything.
   */
  const discardRows = async (ids: readonly string[], loaded: number) => {
    if (discardAbort.current !== undefined) return
    const generation = listGeneration.current
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
          if (generation === listGeneration.current) setError(messageOf(cause))
        }
        if (generation === listGeneration.current)
          setProgress({ done: discardedCount + goneCount + failed.length, total: ids.length })
      }
      if (generation === listGeneration.current) setSelected(new Set(failed))
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
      await reloadWindow(Math.max(0, loaded - removed), abort.signal, generation)
    } catch (cause) {
      if (!abort.signal.aborted && generation === listGeneration.current) setError(messageOf(cause))
    } finally {
      discardAbort.current = undefined
      if (!abort.signal.aborted && generation === listGeneration.current) {
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
  const total = list?.total ?? 0
  const allLoadedSelected = rows.length > 0 && rows.every((row) => selected.has(row.artifactId))
  const filtering = filter !== 'all' || appliedQuery !== ''
  /** One clock per render, so every row ages against the same moment. */
  const now = Date.now()
  const titleOf = (row: ZoteroParsedDocumentRowView): string =>
    row.title !== undefined && row.title.trim() !== '' ? row.title : shortArtifactId(row.artifactId)
  const agoOf = (at: number): string => {
    const age = relativeTime(at, now)
    return age.unit === 'now'
      ? props.t('parsedManagerAgoNow')
      : props.t(AGO_LABELS[age.unit], { count: age.n })
  }
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
      agoOf(row.committedAt),
      fileSizeText(totalBytesOf(row)),
      props.t('parsedManagerChars', { count: formatCount(row.characterCount) }),
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
        <div className={css.filters} role="group" aria-label={props.t('parsedManagerFilterLabel')}>
          {FILTERS.map((value) => (
            <Pill
              key={value}
              active={filter === value}
              aria-pressed={filter === value}
              disabled={!listAllowed}
              onClick={() => changeFilter(value)}
            >
              {props.t(FILTER_LABELS[value])}
            </Pill>
          ))}
        </div>
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
          {query !== '' && (
            <IconButton
              shape="round"
              size="sm"
              icon={<IconCloseOutlineRegular size={12} />}
              aria-label={props.t('parsedManagerClearSearch')}
              title={props.t('parsedManagerClearSearch')}
              onClick={() => setQuery('')}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className={clsx(css.textSeat, css.urlParseCompact)}
            aria-label={props.t('libraryParseUrl')}
            disabled={parseSurface.openUrl === undefined}
            onClick={() => parseSurface.openUrl?.()}
          >
            <IconLinkOutlineRegular size={13} className={css.urlParseGlyph} />
            <span className={css.urlParseLabel}>{props.t('libraryParseUrl')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={props.t('parsedManagerRefresh')}
            aria-busy={busy}
            disabled={busy || !listAllowed}
            icon={
              busy ? (
                <StateDot state="ongoing" size={13} />
              ) : (
                <IconRefreshOutlineRegular size={13} />
              )
            }
            onClick={() => setRevision((previous) => previous + 1)}
          />
        </div>
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
        <div className={css.skeleton} role="status" aria-label={props.t('parsedManagerLoading')}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={css.skeletonRow} aria-hidden="true" />
          ))}
        </div>
      )}
      {listAllowed && list !== undefined && rows.length === 0 && (
        <div className={css.empty}>
          <span className={css.emptyIcon} aria-hidden="true">
            <IconDeliverDocRegular size={24} />
          </span>
          <p className={css.emptyTitle}>
            {props.t(filtering ? 'parsedManagerEmptyFiltered' : 'parsedManagerEmpty')}
          </p>
          {!filtering && <p className={css.hint}>{props.t('parsedManagerEmptyHint')}</p>}
        </div>
      )}
      {listAllowed && list !== undefined && total > 0 && (
        <div className={css.listBar}>
          <span className={css.listBarText}>{props.t('parsedManagerTotal', { count: total })}</span>
          {selected.size > 0 && (
            <span className={css.listBarText}>
              {props.t('parsedManagerSelected', { count: selected.size })}
            </span>
          )}
          <span className={css.listBarSpacer} />
          {progress !== undefined ? (
            <span className={css.listBarText} role="status">
              {props.t('parsedManagerBatchDeleting', { ...progress })}
            </span>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || rows.length === 0}
                onClick={() =>
                  setSelected(
                    allLoadedSelected
                      ? EMPTY_SELECTION
                      : new Set(rows.map((row) => row.artifactId)),
                  )
                }
              >
                {props.t(allLoadedSelected ? 'parsedManagerDeselectAll' : 'parsedManagerSelectAll')}
              </Button>
              {selected.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<IconTrashOutlineRegular size={13} />}
                    disabled={!discardAllowed || busy}
                    onClick={() => setConfirming({ ids: [...selected] })}
                  >
                    {props.t('parsedManagerDeleteSelected')}
                  </Button>
                  <IconButton
                    shape="round"
                    size="sm"
                    icon={<IconCloseOutlineRegular size={12} />}
                    aria-label={props.t('parsedManagerClearSelection')}
                    title={props.t('parsedManagerClearSelection')}
                    disabled={busy}
                    onClick={() => setSelected(EMPTY_SELECTION)}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
      <ul className={css.list}>
        {rows.map((row) => {
          const title = titleOf(row)
          const meta = metaOf(row)
          const isSelected = selected.has(row.artifactId)
          return (
            <li className={clsx(css.row, { [css.rowSelected]: isSelected })} key={row.artifactId}>
              <div className={css.rowHead}>
                {/* The Host's list rows pair a bare checkbox with a visible
                 * title and name the control after the action, because the
                 * primitive Checkbox cannot separate its label from its name. */}
                <label className={css.rowSelect}>
                  <input
                    type="checkbox"
                    className={css.rowCheck}
                    checked={isSelected}
                    disabled={!discardAllowed || busy}
                    aria-label={props.t('parsedManagerSelectRow', { title })}
                    onChange={(event) => toggleRow(row.artifactId, event.target.checked)}
                  />
                  <span className={css.rowTitle} title={row.title ?? row.artifactId}>
                    {title}
                  </span>
                </label>
                {row.state !== 'indexed' && (
                  <Tag tone={STATE_TONES[row.state]}>{props.t(STATE_LABELS[row.state])}</Tag>
                )}
              </div>
              <div className={css.rowMeta}>
                {meta !== '' && (
                  <span className={css.metaText} title={formatDateTime(row.committedAt)}>
                    <span className={css.metaIcon} aria-hidden="true">
                      {row.sourceKind === 'url' ? (
                        <IconLinkOutlineRegular size={12} />
                      ) : (
                        <IconPaperclipOutlineRegular size={12} />
                      )}
                    </span>
                    <span className={css.metaCopy}>{meta}</span>
                  </span>
                )}
                <span className={css.actions}>
                  <IconButton
                    shape="square"
                    icon={<IconEyeOutlineRegular size={14} />}
                    aria-label={props.t('parsedManagerOpen')}
                    title={props.t('parsedManagerOpen')}
                    disabled={!row.actionable || row.state === 'broken'}
                    onClick={() => openParsed(sessionId, row.artifactId, title)}
                  />
                  <IconButton
                    shape="square"
                    icon={<IconSparkleRegular size={14} />}
                    aria-label={props.t('libraryParsedReparse')}
                    title={props.t('libraryParsedReparse')}
                    disabled={!row.actionable || parseSurface.openArtifact === undefined}
                    onClick={() => parseSurface.openArtifact?.(row.artifactId, title)}
                  />
                  <IconButton
                    shape="square"
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
      {list !== undefined && rows.length < Math.min(total, MAX_WINDOW) && (
        <Button
          variant="outline"
          size="sm"
          className={css.more}
          aria-busy={loadingMore}
          disabled={loadingMore || busy}
          onClick={() => void showMore(rows)}
        >
          {props.t('parsedManagerShowMore')}
        </Button>
      )}
      <Modal
        open={pendingDelete !== undefined}
        onClose={() => setConfirming(undefined)}
        title={props.t(
          batchConfirm ? 'parsedManagerBatchDeleteTitle' : 'parsedManagerDeleteTitle',
          {
            count: pendingDelete?.ids.length ?? 0,
          },
        )}
        description={props.t(
          batchConfirm ? 'parsedManagerBatchDeleteDescription' : 'parsedManagerDeleteDescription',
          { count: pendingDelete?.ids.length ?? 0, title: pendingDelete?.title ?? '' },
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
                variant="outline"
                className={css.dangerAction}
                disabled={busy}
                onClick={() => {
                  setConfirming(undefined)
                  void discardRows(pendingDelete.ids, rows.length)
                }}
              >
                {props.t('parsedManagerDeleteConfirm')}
              </Button>
            </>
          )
        }
      />
      {parseSurface.dialog}
    </section>
  )
}
