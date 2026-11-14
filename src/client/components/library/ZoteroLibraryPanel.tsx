import {
  LibraryPreferencesContext,
  useLibraryPreferenceSource,
  useLibraryPreferences,
  type LibraryPreferenceSource,
} from '../../library-preferences.tsx'
/**
 * The Zotero library panel: a session-scoped right-sidebar tab. It covers the
 * library selector, the collection tree, saved searches, the trash, paged
 * item lists with search and sort, and an inspector whose attachments open in
 * the right sidebar. It mounts while its entry is selected, so requests stop
 * when the panel closes.
 *
 * The pane-tab slot binds the panel to one conversation: file reads anchor to
 * that session's right reader, and the write drawer sends its approval and
 * plan card to that conversation — never to whichever session sits first in
 * the host's list.
 * @module dsh-zotero/client/components/library/ZoteroLibraryPanel
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronsUpDownOutlineMedium,
  IconEllipsisOutlineMedium,
  IconRefreshOutlineMedium,
  IconSearchOutlineMedium,
  Input,
  Menu,
  SegmentedControl,
  StateDot,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from '../IconButton.tsx'
import type { ParsedDocuments } from '../../parsed-documents.ts'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  SupportedLocalLibrary,
  ZoteroAttachmentLocationView,
  ZoteroStatusView,
  ZoteroUrlPdfView,
} from '../../../contract.ts'
import type { ZoteroLocaleKey } from '../../locales.ts'
import { ZoteroSurfaceBoundary } from '../ZoteroSurfaceBoundary.tsx'
import { useZoteroProbe } from '../useZoteroProbe.ts'
import { writeStatusLabel } from '../write-label.ts'
import { useLibraryFeed } from './useLibraryFeed.ts'
import type { LibraryFeedFace, LibraryPanelWireFace } from './library-feed-types.ts'
import { clearLibraryConversationState } from './library-storage.ts'
import type { LibraryViewStore } from './library-view-store.ts'
import { LIBRARY_SORTS, libraryKeyOf, type LibrarySelectorState } from './library-model.ts'
import { LibraryTree } from './LibraryTree.tsx'
import { LibraryItemList } from './LibraryItemList.tsx'
import {
  useDocumentParseSurface,
  type DocumentParseSurfacePort,
} from '../../enrichment/parse-surface.tsx'
import { LibraryInspector } from './LibraryInspector.tsx'
import { LibraryFilters } from './LibraryFilters.tsx'
import { LibraryWrite } from './LibraryWrite.tsx'
import type {
  ZoteroAttachmentRowView,
  ZoteroLibraryWriteRequestView,
  ZoteroLibraryWriteResultView,
} from '../../../contract.ts'
import css from './library.module.css'

/**
 * The injected face: the panel's wire calls plus the right-sidebar opener. The
 * panel mounts beside the session (right sidebar), so the harness's
 * session-adjacent seams — the right reader for local files and the session
 * composer for the chat actions — are always reachable.
 */
export interface ZoteroLibraryPanelFace extends LibraryPanelWireFace {
  /**
   * The panel's in-memory view cache. The client registration owns it and
   * disposes it with the registration, so a panel never outlives its cache and
   * two instances never share one.
   */
  readonly viewStore: LibraryViewStore
  readonly parse?: DocumentParseSurfacePort
  /** The parsed-document provider, for badge invalidation on commit/discard. */
  readonly parsedDocuments?: ParsedDocuments
  readonly readUrlPdf?: (
    request: { ref: string },
    signal: AbortSignal,
  ) => Promise<RemoteResult<ZoteroUrlPdfView>>
  readonly releaseUrlPdf?: (lease: string) => Promise<void>
  readonly forgetPdf?: (address: string) => void
  readonly trackPdf?: (address: string, lease: string, ref: string) => void
  readonly preferenceSource?: LibraryPreferenceSource
  readonly bindRefresh?: (
    sessionId: string,
    tabId: string,
    refresh: () => void,
    clear: () => void,
  ) => () => void
  readonly status: () => Promise<RemoteResult<ZoteroStatusView>>
  readonly resolveAttachment: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly openResource: (url: string) => void
  /**
   * Opens a parsed artifact as its own right-sidebar tab, named after the item
   * rather than the attachment file; absent while enrichment is off.
   */
  readonly openParsed?: (
    attachment: ZoteroAttachmentRowView,
    title: string,
    itemRef: string,
  ) => void
  /** Opens the session's parsed-document manager tab. */
  readonly openParsedManager?: () => void
  readonly write: (
    request: ZoteroLibraryWriteRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryWriteResultView>>
}

export type ZoteroLibraryPanelProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<ZoteroLibraryPanelFace> &
  PropsLocale<'zotero'>

export function ZoteroLibraryPanel(props: ZoteroLibraryPanelProps) {
  const { t } = props
  const client = props.useZoteroClient()
  const accepted = useLibraryPreferenceSource(props.preferenceSource)
  return (
    <ZoteroSurfaceBoundary t={t} surface="library" report={client.reportClientError}>
      {accepted.error ? (
        <p role="alert">{t('libraryConfigError', { message: accepted.error })}</p>
      ) : !accepted.preferences ? (
        <p role="status">{t('libraryConfigLoading')}</p>
      ) : (
        <LibraryPreferencesContext.Provider value={accepted}>
          <ZoteroLibraryPanelBody {...props} />
        </LibraryPreferencesContext.Provider>
      )}
    </ZoteroSurfaceBoundary>
  )
}

/** The sort/direction pairs the select offers, in toolbar order. */
const SORT_OPTIONS: readonly {
  sort: (typeof LIBRARY_SORTS)[number]
  direction: 'asc' | 'desc'
}[] = LIBRARY_SORTS.flatMap((sort) =>
  (['desc', 'asc'] as const).map((direction) => ({ sort, direction })),
)

/** The label each sort field renders. */
const SORT_LABELS = {
  dateModified: 'librarySortDateModified',
  dateAdded: 'librarySortDateAdded',
  date: 'librarySortDate',
  title: 'librarySortTitle',
  creator: 'librarySortCreator',
} as const satisfies Record<(typeof LIBRARY_SORTS)[number], ZoteroLocaleKey>

/** The single value encoding shared by the options and the controlled value. */
function sortValueOf(sort: (typeof LIBRARY_SORTS)[number], direction: 'asc' | 'desc'): string {
  return `${sort}:${direction}`
}

/** The sort select's decoder: only a listed value can reach the feed state. */
const SORT_BY_VALUE = new Map(
  SORT_OPTIONS.map((option) => [sortValueOf(option.sort, option.direction), option]),
)

function ZoteroLibraryPanelBody(props: ZoteroLibraryPanelProps) {
  const { t } = props
  const [diagMenuOpen, setDiagMenuOpen] = useState(false)
  const accepted = useLibraryPreferences()
  const tabInfo = props.useTabInfo?.()
  const occurrenceSignal = useMemo(
    () => tabInfo?.tab.signal ?? new AbortController().signal,
    [tabInfo?.tab.signal],
  )
  const sessionRemoved = props.useSession((snapshot) => snapshot.removed)
  const [cleanupError, setCleanupError] = useState<string>()
  const sessionKey = props.sessionId
  // The cached payload is read before the probe knows the instance, so the key
  // is the pre-probe spelling; once connected the read is exact.
  const initialView = props.viewStore.sessionView(undefined, sessionKey)

  // The connectivity lamp: the shared probe hook owns the in-flight, unmount,
  // and rejection guards. One probe on open, another on every refresh.
  // The panel is a session-scoped surface, but its wire reads target the
  // global resource: the gateway resolves no session id from a browse request.
  // A refused action would fail on every call, so the panel skips the request
  // and renders one localized notice instead. The write drawer reads the
  // session action itself and passes it down as `writeAllowed`.
  const canBrowse = props.useRemoteAccess('zotero/browse')
  const {
    state: probeState,
    settled,
    runProbe,
  } = useZoteroProbe(props.status, {
    initialAutoRun: true,
    initialData: initialView?.lastProbeData,
    enabled: canBrowse,
  })

  // The feed reads only: every non-feed member (probe, export, write, the
  // right reader) is read from props where it is used, so this inner face
  // stays the narrow shape `useLibraryFeed` and the filters rail consume.
  const face = useMemo<LibraryFeedFace>(
    () => ({
      collectionPath: props.collectionPath,
      browse: props.browse,
      search: props.search,
      item: props.item,
      childPage: props.childPage,
      invalidate: props.invalidate,
      setInstance: props.setInstance,
    }),
    [
      props.collectionPath,
      props.browse,
      props.search,
      props.item,
      props.childPage,
      props.invalidate,
      props.setInstance,
    ],
  )
  const connected = probeState.data?.connected === true
  // A cached snapshot paints the lamp; only this mount's own answer opens the
  // wire. An offline or failed probe therefore never sends a first batch.
  const confirmed = settled && connected && canBrowse
  // The chat actions ride the session-scope input face; the pane-tab runtime
  // always carries it (session scope).
  const inputActions: InputActions | undefined = props.inputActions
  // Lanes read the wire only through a confirmed connection: an offline or
  // failed probe gates every request, and the body renders the offline note.
  const memory = props.viewStore.viewMemory(
    occurrenceSignal,
    probeState.data?.serverId ?? '',
    props.sessionId,
  )
  const feed = useLibraryFeed(
    face,
    confirmed ? probeState.data?.serverId : undefined,
    confirmed && !sessionRemoved,
    props.sessionId,
    props.viewStore,
    accepted.preferences,
    memory,
    tabInfo?.tab.visible ?? true,
    initialView,
  )
  // The session view's only writer: the detail payload and the probe snapshot
  // are one record, so neither can clear the other through a partial merge.
  useEffect(() => {
    const inspector = feed.inspector?.phase === 'ready' ? feed.inspector : undefined
    const serverKey = probeState.data?.serverId ?? ''
    if (inspector === undefined && probeState.data === undefined) {
      props.viewStore.clearSessionView(serverKey, props.sessionId)
      return
    }
    props.viewStore.writeSessionView(serverKey, props.sessionId, {
      inspector,
      lastProbeData: probeState.data,
    })
  }, [feed.inspector, probeState.data, props.sessionId, props.viewStore])
  useEffect(() => {
    if (feed.refreshToken > 0) void runProbe()
  }, [feed.refreshToken, runProbe])

  // The pane-tab slot is session-scoped: `props.sessionId` names the
  // conversation this tab belongs to, so file reads and write approvals anchor
  // to it — never to whatever session happens to sit first in the host list.
  const sessionRunning = props.useSession((snapshot) => snapshot.running && !snapshot.removed)
  // A removed session owns no view; the panel unmounts in the same batch, so
  // this is best effort — the plugin teardown clears whatever it misses.
  useEffect(() => {
    if (sessionRemoved) {
      try {
        // A deleted conversation leaves nothing behind: the occurrence state,
        // every instance's cached payload for it, and the durable position.
        props.viewStore.clearConversation(props.sessionId)
        props.viewStore.clearSessionView('', props.sessionId)
        clearLibraryConversationState(props.sessionId)
      } catch (error) {
        setCleanupError(String(error))
      }
    }
  }, [sessionRemoved, props.sessionId])
  const cwd = props.useSessions((snapshot) => snapshot.byId[props.sessionId]?.cwd)
  const client = props.useZoteroClient()
  // The write entry answers the session resource: `zotero/write` carries the
  // owning session, so a peer without the grant on this session must not see
  // a form whose submission the Host would refuse. The read actions resolve
  // the global resource instead, so the panel itself is gated on those.
  const writeAllowed = props.useAccess('zotero/write')
  // The citation export, the attachment lookup, and the desktop hand-off are
  // global-resource actions, so each answers the global grant separately: a
  // peer that may read the library but not export it keeps the list and loses
  // the export control.
  const canExport = props.useRemoteAccess('zotero/export')
  const canResolveAttachment = props.useRemoteAccess('zotero/resolveAttachment')
  const canReadUrlPdf = props.useRemoteAccess('zotero/readUrlPdf')
  const canOpenProtocol = props.useRemoteAccess('zotero/openProtocol')
  const canStartParse = props.useAccess('zotero/startDocumentParse')
  const canReadArtifact = props.useAccess('zotero/documentArtifact')
  const canReadParseReceipt = props.useAccess('zotero/documentParseReceipt')
  const canListParseJobs = props.useAccess('job/list')
  const canFollowParseJobs = props.useAccess('job/follow')
  const canCancelParse = props.useAccess('job/kill')
  const parseSurface = useDocumentParseSurface(
    props.parse,
    {
      sessionId: props.sessionId,
      sessionAllowed: !sessionRemoved,
      startAllowed: canStartParse,
      readAllowed: canReadArtifact && canReadParseReceipt && canListParseJobs && canFollowParseJobs,
      cancelAllowed: canCancelParse,
    },
    t,
  )
  const enrichmentMounted = parseSurface.mounted
  // Local-file reading rides the right reader this session hosts. A missing
  // workspace root is fine: `fileAddressFor` resolves absolute paths as-is.
  const openFile = (path: string): void => {
    try {
      if (!tabInfo?.tab.actions) throw new Error(t('libraryNoSessionForOpen'))
      tabInfo.tab.actions.openResource(fileAddressFor(props.sessionId, cwd, path), {
        destination: accepted.preferences?.localPdfOpenTarget === 'float' ? 'float' : 'sidebar',
      })
    } catch (error) {
      // The harness refuses with this message when no session surface
      // is mounted; map it to the panel's hint. Other errors rethrow.
      if (error instanceof Error && error.message.includes('no session surface is mounted')) {
        throw new Error(t('libraryNoSessionForOpen'))
      }
      throw error
    }
  }

  const readPdf = async (ref: string): Promise<void> => {
    if (!tabInfo?.tab || sessionRemoved) throw new Error(t('libraryNoSessionForOpen'))
    const location = await props.resolveAttachment(ref)
    if (!location.ok) throw new Error(location.error.message)
    if (location.value.kind === 'file') {
      if (accepted.preferences?.localPdfOpenTarget === 'zotero') {
        const { pdfUrlOf } = await import('../../actions/open-zotero.ts')
        const url = pdfUrlOf(ref)
        if (!url || !canOpenProtocol || !(await client.openProtocol(url)))
          throw new Error(t('libraryPdfReaderUnavailable'))
      } else if (location.value.path) openFile(location.value.path)
      else throw new Error(t('pdfFileNotFound'))
      return
    }
    if (!accepted.preferences?.allowUrlPdfRead) throw new Error(t('libraryUrlPdfDisabled'))
    if (!canReadUrlPdf || !props.readUrlPdf) throw new Error(t('libraryPdfReaderUnavailable'))
    const pdf = await props.readUrlPdf({ ref }, tabInfo.tab.signal)
    if (!pdf.ok) throw pdf.error
    const address = fileAddressFor(props.sessionId, cwd, pdf.value.path)
    try {
      tabInfo.tab.signal.throwIfAborted()
      props.trackPdf?.(address, pdf.value.lease, pdf.value.ref)
      tabInfo.tab.actions.openResource(address, {
        destination: accepted.preferences.urlPdfOpenTarget,
      })
    } catch (error) {
      props.forgetPdf?.(address)
      await props.releaseUrlPdf?.(pdf.value.lease)
      throw error
    }
  }

  // Bind the right-sidebar native refresh command to invalidate the panel feed.
  useEffect(() => {
    if (!tabInfo?.tab || sessionRemoved) return
    return props.bindRefresh?.(props.sessionId, tabInfo.tab.id, feed.refresh, () => {
      if (!feed.clearPosition()) throw new Error(t('libraryPositionResetFailed'))
    })
  }, [props.bindRefresh, props.sessionId, tabInfo?.tab?.id, feed.refresh, sessionRemoved])
  useEffect(() => {
    if (!tabInfo?.tab?.actions?.bindCommands) return
    return tabInfo.tab.actions.bindCommands({
      refresh: () => {
        feed.refresh()
      },
    })
  }, [tabInfo?.tab?.actions, feed])

  const handleSelectScope = (selection: Parameters<typeof feed.selectScope>[0]) => {
    feed.selectScope(selection)
  }

  const handleSelectItem = (ref: string | undefined) => {
    feed.selectItem(ref)
  }

  const diagnosticMenuItems: MenuEntry[] = useMemo(() => {
    const data = probeState.data
    const items: MenuEntry[] = []
    if (data?.serverId !== undefined) {
      items.push({ id: 'server', label: `${t('serverIdLabel')} ${data.serverId}`, disabled: true })
    }
    if (data?.zoteroVersion !== undefined) {
      items.push({
        id: 'zoteroVer',
        label: `${t('zoteroVersionLabel')} ${data.zoteroVersion}`,
        disabled: true,
      })
    }
    if (data?.apiVersion !== undefined) {
      items.push({
        id: 'apiVer',
        label: `${t('apiVersionLabel')} ${data.apiVersion}`,
        disabled: true,
      })
    }
    if (data?.write !== undefined) {
      items.push({
        id: 'write',
        label: `${t('writeLabel')} ${writeStatusLabel(data.write, t)}`,
        disabled: true,
      })
    }
    return items
  }, [probeState.data, t])

  return (
    <LibraryPreferencesContext.Provider value={{ ...accepted, memory }}>
      <div className={css.panel}>
        {cleanupError && <p role="alert">{t('libraryPositionError', { message: cleanupError })}</p>}
        {/* Streamlined Responsive Header */}
        <header className={css.toolbar}>
          <div className={css.librarySelectWrap}>
            <LibrarySelect
              t={t}
              state={feed.libraries}
              current={feed.currentLibrary}
              onSelect={feed.selectLibrary}
            />
          </div>

          <Input
            className={css.searchInputWrap}
            icon={<IconSearchOutlineMedium size={14} className={css.searchIcon} />}
            type="search"
            placeholder={t('librarySearchPlaceholder')}
            value={feed.q}
            onChange={(event) => feed.setQ(event.target.value)}
            aria-label={t('librarySearchPlaceholder')}
          />

          <div className={css.searchModeWrap}>
            <SegmentedControl
              id="zotero-search-mode"
              label={t('librarySearchModeLabel')}
              value={feed.mode}
              onChange={feed.setMode}
              options={[
                { value: 'metadata', label: t('librarySearchModeMetadata') },
                { value: 'everything', label: t('librarySearchModeEverything') },
              ]}
            />
          </div>

          <div className={css.sortSelectWrap}>
            <SortSelect
              t={t}
              sort={feed.sort}
              direction={feed.direction}
              onSelect={(sort, direction) => feed.setSort(sort, direction)}
            />
          </div>

          {enrichmentMounted && props.openParsedManager !== undefined && (
            <div className={css.parsedManagerWrap}>
              <Button
                variant="outline"
                size="sm"
                onClick={props.openParsedManager}
                disabled={sessionRemoved}
              >
                {t('libraryParsedManager')}
              </Button>
            </div>
          )}
          <span className={css.spacer} />

          <div className={css.statusGroup}>
            <StateDot state={probeState.loading ? 'ongoing' : connected ? 'done' : 'error'} />
            <span
              className={css.statusText}
              role="status"
              title={connected ? undefined : (probeState.error ?? probeState.data?.diagnosis)}
            >
              {probeState.loading ||
              (probeState.data === undefined && probeState.error === undefined)
                ? t('libraryLoading')
                : connected
                  ? t('libraryConnected')
                  : t('libraryOffline')}
            </span>
          </div>

          {diagnosticMenuItems.length > 0 && (
            <div className={css.diagnosticsWrap}>
              <Menu
                open={diagMenuOpen}
                anchor={
                  <Tooltip label={t('detailsLabel')} side="bottom" delayMs={500}>
                    <IconButton
                      shape="square"
                      icon={<IconEllipsisOutlineMedium className={css.actionIcon} />}
                      aria-label={t('detailsLabel')}
                      onClick={() => setDiagMenuOpen(!diagMenuOpen)}
                    />
                  </Tooltip>
                }
                items={diagnosticMenuItems}
                onClose={() => setDiagMenuOpen(false)}
                align="end"
                portal
              />
            </div>
          )}

          <div className={css.refreshWrap}>
            <Tooltip label={t('refresh')} side="bottom" delayMs={500}>
              <IconButton
                shape="square"
                icon={<IconRefreshOutlineMedium className={css.actionIcon} />}
                onClick={() => feed.refresh()}
                aria-label={t('refresh')}
              />
            </Tooltip>
          </div>

          <div className={css.toolbarBreak} aria-hidden="true" />
        </header>

        {/* An answered-but-offline probe (or a failed one) replaces the whole
         * workspace: the lanes stay gated and the note carries the diagnosis.
         * Until this mount's probe answers, the cached snapshot may still paint
         * the workspace, with every request still gated. */}
        {!canBrowse ? (
          <div className={css.offline} role="note">
            <p className={css.offlineText}>{t('remoteAccessDenied')}</p>
          </div>
        ) : settled &&
          !connected &&
          (probeState.data !== undefined || probeState.error !== undefined) ? (
          <div className={css.offline} role="note">
            <p className={css.offlineText}>{t('libraryOfflineNote')}</p>
            {(probeState.error ?? probeState.data?.diagnosis) !== undefined && (
              <p className={css.offlineDetail}>{probeState.error ?? probeState.data?.diagnosis}</p>
            )}
          </div>
        ) : (
          <>
            {/* Responsive Segmented Tabs in Narrow Mode */}
            <div className={css.narrowNavWrap}>
              <SegmentedControl
                id="zotero-library-narrow-nav"
                label={t('tabLibrary')}
                value={feed.narrowPane}
                onChange={feed.setNarrowPane}
                options={[
                  { value: 'tree', label: t('libraryNavTree') },
                  { value: 'list', label: t('libraryNavList') },
                  { value: 'inspector', label: t('libraryNavInspector') },
                ]}
              />
            </div>

            {/* 3-Column Workspace with Hairline Dividers */}
            {feed.storageError && (
              <p role="alert">
                {t('libraryPositionError', { message: feed.storageError })}
                <Button size="sm" onClick={feed.clearPosition}>
                  {t('libraryPositionReset')}
                </Button>
              </p>
            )}
            <div className={css.columns}>
              <div
                className={clsx(
                  css.columnPane,
                  css.treePane,
                  feed.narrowPane !== 'tree' && css.columnPaneHidden,
                )}
              >
                <LibraryTree
                  t={t}
                  locatedRef={feed.locatedRef}
                  flatTree={feed.flatTree}
                  expanded={feed.expanded}
                  identityOf={feed.identityOf}
                  toggleCollection={feed.toggleCollection}
                  selection={feed.selection}
                  selectScope={handleSelectScope}
                  rootLane={feed.treeLane(undefined)}
                  treeLane={feed.treeLane}
                  loadMoreTree={feed.loadMoreTree}
                  retryTree={feed.retryTree}
                />
              </div>
              <div
                className={clsx(
                  css.columnPane,
                  css.listPane,
                  feed.narrowPane !== 'list' && css.columnPaneHidden,
                )}
              >
                {/* Pill-based Filter Rail */}
                <LibraryFilters
                  key={feed.scopeKey}
                  t={t}
                  face={face}
                  library={feed.currentLibrary}
                  value={feed.filters}
                  change={feed.setFilters}
                  enabled={connected}
                />

                {feed.mode === 'everything' && (
                  <div className={clsx(css.caption, css.everywhereHint)}>
                    <IconSearchOutlineMedium className={css.hintIcon} />
                    <span>{t('libraryEverythingHint')}</span>
                  </div>
                )}

                <LibraryItemList
                  scrollKey={JSON.stringify([
                    'list',
                    feed.scopeKey,
                    feed.q,
                    feed.mode,
                    feed.sort,
                    feed.direction,
                    feed.filters,
                    feed.offset,
                  ])}
                  returnToLibrary={() => feed.selectScope({ kind: 'library' })}
                  filtered={
                    feed.q !== '' ||
                    Object.values(feed.filters).some((value) =>
                      Array.isArray(value) ? value.length > 0 : value !== undefined,
                    )
                  }
                  locate={'ref' in feed.selection ? feed.locate : undefined}
                  locateError={feed.locateError}
                  t={t}
                  list={feed.list}
                  selection={feed.selection}
                  offset={feed.offset}
                  gotoOffset={feed.gotoOffset}
                  selectedRef={feed.selectedRef}
                  selectItem={handleSelectItem}
                  retry={feed.retryList}
                  useContextMenu={props.useContextMenu}
                  parsedArtifact={
                    props.parse !== undefined && canReadArtifact
                      ? {
                          sessionId: props.sessionId,
                          read: props.parse.remote.documentArtifact,
                          revision: parseSurface.revision,
                          documents: props.parsedDocuments,
                        }
                      : undefined
                  }
                />
              </div>
              <div
                className={clsx(
                  css.columnPane,
                  css.inspectorPane,
                  feed.narrowPane !== 'inspector' && css.columnPaneHidden,
                )}
              >
                {/* Write Support Drawer: acts on the inspected scope, so it
                 * lives in the inspector column above the detail. */}
                {probeState.data?.write?.enabled === true &&
                  feed.currentLibrary.type === 'user' && (
                    <LibraryWrite
                      // The write targets ride the inspected scope, so a selection
                      // or inspected row change remounts the form: a draft ref can
                      // never outlive the item it was typed against.
                      key={JSON.stringify([feed.scopeKey, feed.selectedRef ?? null])}
                      t={t}
                      write={props.write}
                      sessionId={props.sessionId}
                      sessionRunning={sessionRunning}
                      writeAllowed={writeAllowed}
                      selectedRef={feed.selectedRef}
                      collectionRef={
                        feed.selection.kind === 'collection' ? feed.selection.ref : undefined
                      }
                      searchRef={
                        feed.selection.kind === 'savedSearch' ? feed.selection.ref : undefined
                      }
                      refreshAffected={feed.refreshAffected}
                    />
                  )}
                <LibraryInspector
                  t={t}
                  inspector={feed.inspector}
                  inputActions={inputActions}
                  retry={feed.retryInspector}
                  pageChild={feed.pageChild}
                  childStates={feed.childStates}
                  retryChild={feed.retryChild}
                  readPdf={canResolveAttachment ? readPdf : undefined}
                  parsePdf={parseSurface.openAttachment}
                  openFile={openFile}
                  resolveAttachment={canResolveAttachment ? props.resolveAttachment : undefined}
                  openProtocol={canOpenProtocol ? client.openProtocol : undefined}
                  exportItem={canExport ? props.export : undefined}
                  {...(props.parse !== undefined &&
                  canReadArtifact &&
                  props.openParsed !== undefined
                    ? {
                        parsedArtifact: {
                          sessionId: props.sessionId,
                          read: props.parse.remote.documentArtifact,
                          revision: parseSurface.revision,
                          documents: props.parsedDocuments,
                          open: props.openParsed,
                        },
                      }
                    : {})}
                />
              </div>
            </div>
          </>
        )}
        {parseSurface.dialog}
      </div>
    </LibraryPreferencesContext.Provider>
  )
}

function LibrarySelect({
  t,
  state,
  current,
  onSelect,
}: {
  t: PropsLocale<'zotero'>['t']
  state: LibrarySelectorState
  current: SupportedLocalLibrary
  onSelect: (library: SupportedLocalLibrary) => void
}) {
  const [open, setOpen] = useState(false)
  if (state.phase === 'loading') {
    return <span className={css.statusText}>{t('libraryLoading')}</span>
  }
  if (state.phase === 'error') {
    return <span className={css.statusText}>{state.message}</span>
  }

  const currentKey = libraryKeyOf(current)
  const currentName =
    state.options.find((option) => libraryKeyOf(option.library) === currentKey)?.name ?? currentKey

  const items: MenuEntry[] = state.options.map((option) => ({
    id: libraryKeyOf(option.library),
    label: option.name,
  }))

  return (
    <Menu
      open={open}
      portal
      dense
      align="start"
      onClose={() => setOpen(false)}
      anchor={
        <Tooltip label={`${t('librarySelectLibrary')}: ${currentName}`} side="bottom" delayMs={500}>
          <Button
            variant="outline"
            size="sm"
            className={css.selectorSeat}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('librarySelectLibrary')}
            title={currentName}
            onClick={() => setOpen((prev) => !prev)}
          >
            <span className={css.selectorLabel}>{currentName}</span>
            <IconChevronDownOutlineRegular size={12} className={css.dropdownChevron} />
          </Button>
        </Tooltip>
      }
      items={items}
      selectedId={currentKey}
      onSelect={(id) => {
        const match = state.options.find((option) => libraryKeyOf(option.library) === id)
        if (match !== undefined) onSelect(match.library)
        setOpen(false)
      }}
    />
  )
}

function SortSelect({
  t,
  sort,
  direction,
  onSelect,
}: {
  t: PropsLocale<'zotero'>['t']
  sort: (typeof LIBRARY_SORTS)[number]
  direction: 'asc' | 'desc'
  onSelect: (sort: (typeof LIBRARY_SORTS)[number], direction: 'asc' | 'desc') => void
}) {
  const [open, setOpen] = useState(false)
  const currentValue = sortValueOf(sort, direction)
  const currentLabel = `${t(SORT_LABELS[sort])} · ${direction === 'asc' ? t('librarySortAsc') : t('librarySortDesc')}`

  const items: MenuEntry[] = SORT_OPTIONS.map((option) => {
    const val = sortValueOf(option.sort, option.direction)
    const label = `${t(SORT_LABELS[option.sort])} · ${option.direction === 'asc' ? t('librarySortAsc') : t('librarySortDesc')}`
    return {
      id: val,
      label,
    }
  })

  return (
    <Menu
      open={open}
      portal
      dense
      align="start"
      onClose={() => setOpen(false)}
      anchor={
        <Tooltip label={`${t('librarySortLabel')}: ${currentLabel}`} side="bottom" delayMs={500}>
          <Button
            variant="outline"
            size="sm"
            className={css.selectorSeat}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('librarySortLabel')}
            title={currentLabel}
            onClick={() => setOpen((prev) => !prev)}
          >
            <IconChevronsUpDownOutlineMedium size={14} className={css.sortIcon} />
            <span className={css.sortLabel}>{currentLabel}</span>
          </Button>
        </Tooltip>
      }
      items={items}
      selectedId={currentValue}
      onSelect={(id) => {
        const option = SORT_BY_VALUE.get(id)
        if (option !== undefined) onSelect(option.sort, option.direction)
        setOpen(false)
      }}
    />
  )
}
