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
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  SupportedLocalLibrary,
  ZoteroAttachmentLocationView,
  ZoteroStatusView,
} from '../../../contract.ts'
import type { ZoteroLocaleKey } from '../../locales.ts'
import { ZoteroSurfaceBoundary } from '../ZoteroSurfaceBoundary.tsx'
import { useZoteroProbe } from '../useZoteroProbe.ts'
import { writeStatusLabel } from '../write-label.ts'
import { useLibraryFeed, type LibraryFeedFace } from './useLibraryFeed.ts'
import {
  clearLibrarySessionMemory,
  readLibrarySessionMemory,
  writeLibrarySessionView,
} from './library-storage.ts'
import { LIBRARY_SORTS, libraryKeyOf, type LibrarySelectorState } from './library-model.ts'
import { LibraryTree } from './LibraryTree.tsx'
import { LibraryItemList } from './LibraryItemList.tsx'
import { LibraryInspector } from './LibraryInspector.tsx'
import { LibraryFilters } from './LibraryFilters.tsx'
import { LibraryWrite } from './LibraryWrite.tsx'
import type {
  ZoteroLibraryWriteRequestView,
  ZoteroLibraryWriteResultView,
} from '../../../contract.ts'
import css from './library.module.css'

/**
 * The injected face: the wire calls plus the right-sidebar opener. The panel
 * mounts beside the session (right sidebar), so the harness's session-adjacent
 * seams — the right reader for local files and the session composer for the
 * chat actions — are always reachable.
 */
export interface ZoteroLibraryPanelFace extends LibraryFeedFace {
  readonly status: () => Promise<RemoteResult<ZoteroStatusView>>
  readonly resolveAttachment: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly openResource: (url: string) => void
  readonly write: (
    request: ZoteroLibraryWriteRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryWriteResultView>>
}

export type ZoteroLibraryPanelProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<ZoteroLibraryPanelFace> &
  PropsLocale<'zotero'>

export function ZoteroLibraryPanel(props: ZoteroLibraryPanelProps) {
  const { t } = props
  return (
    <ZoteroSurfaceBoundary t={t} surface="library">
      <ZoteroLibraryPanelBody {...props} />
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
  const sessionKey = props.sessionId
  const initialView = readLibrarySessionMemory(sessionKey)

  // The connectivity lamp: the shared probe hook owns the in-flight, unmount,
  // and rejection guards. One probe on open, another on every refresh.
  const {
    state: probeState,
    settled,
    runProbe,
  } = useZoteroProbe(props.status, {
    initialAutoRun: true,
    initialData: initialView?.lastProbeData,
  })

  const face = useMemo<ZoteroLibraryPanelFace>(
    () => ({
      status: props.status,
      browse: props.browse,
      search: props.search,
      item: props.item,
      childPage: props.childPage,
      invalidate: props.invalidate,
      write: props.write,
      resolveAttachment: props.resolveAttachment,
      openResource: props.openResource,
    }),
    [
      props.status,
      props.browse,
      props.search,
      props.item,
      props.childPage,
      props.invalidate,
      props.write,
      props.resolveAttachment,
      props.openResource,
    ],
  )
  const connected = probeState.data?.connected === true
  // A cached snapshot paints the lamp; only this mount's own answer opens the
  // wire. An offline or failed probe therefore never sends a first batch.
  const confirmed = settled && connected
  // The chat actions ride the session-scope input face; the pane-tab runtime
  // always carries it (session scope).
  const inputActions: InputActions | undefined = props.inputActions
  // Lanes read the wire only through a confirmed connection: an offline or
  // failed probe gates every request, and the body renders the offline note.
  const feed = useLibraryFeed(
    face,
    confirmed ? probeState.data?.serverId : undefined,
    confirmed,
    props.sessionId,
  )
  // The session view's only writer: the detail payload and the probe snapshot
  // are one record, so neither can clear the other through a partial merge.
  useEffect(() => {
    const inspector = feed.inspector?.phase === 'ready' ? feed.inspector : undefined
    if (inspector === undefined && probeState.data === undefined) {
      clearLibrarySessionMemory(props.sessionId)
      return
    }
    writeLibrarySessionView(props.sessionId, { inspector, lastProbeData: probeState.data })
  }, [feed.inspector, probeState.data, props.sessionId])
  useEffect(() => {
    if (feed.refreshToken > 0) void runProbe()
  }, [feed.refreshToken, runProbe])

  // The pane-tab slot is session-scoped: `props.sessionId` names the
  // conversation this tab belongs to, so file reads and write approvals anchor
  // to it — never to whatever session happens to sit first in the host list.
  const sessionRunning = props.useSession((snapshot) => snapshot.running && !snapshot.removed)
  // A removed session owns no view; the panel unmounts in the same batch, so
  // this is best effort — the plugin teardown clears whatever it misses.
  const sessionRemoved = props.useSession((snapshot) => snapshot.removed)
  useEffect(() => {
    if (sessionRemoved) clearLibrarySessionMemory(props.sessionId)
  }, [sessionRemoved, props.sessionId])
  const cwd = props.useSessions((snapshot) => snapshot.byId[props.sessionId]?.cwd)
  // Local-file reading rides the right reader this session hosts. A missing
  // workspace root is fine: `fileAddressFor` resolves absolute paths as-is.
  const openFile = (path: string): void => {
    try {
      props.openResource(fileAddressFor(props.sessionId, cwd, path))
    } catch (error) {
      // The harness refuses with this message when no session surface
      // is mounted; map it to the panel's hint. Other errors rethrow.
      if (error instanceof Error && error.message.includes('no session surface is mounted')) {
        throw new Error(t('libraryNoSessionForOpen'))
      }
      throw error
    }
  }

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
    <div className={css.panel}>
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

        <span className={css.spacer} />

        <div className={css.statusGroup}>
          <StateDot state={probeState.loading ? 'ongoing' : connected ? 'done' : 'error'} />
          <span
            className={css.statusText}
            role="status"
            title={connected ? undefined : (probeState.error ?? probeState.data?.diagnosis)}
          >
            {probeState.loading || (probeState.data === undefined && probeState.error === undefined)
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
                  <button
                    type="button"
                    className={css.toolButton}
                    aria-label={t('detailsLabel')}
                    onClick={() => setDiagMenuOpen(!diagMenuOpen)}
                  >
                    <IconEllipsisOutlineMedium className={css.actionIcon} />
                  </button>
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
            <button
              type="button"
              className={css.toolButton}
              onClick={() => feed.refresh()}
              aria-label={t('refresh')}
            >
              <IconRefreshOutlineMedium className={css.actionIcon} />
            </button>
          </Tooltip>
        </div>

        <div className={css.toolbarBreak} aria-hidden="true" />
      </header>

      {/* An answered-but-offline probe (or a failed one) replaces the whole
       * workspace: the lanes stay gated and the note carries the diagnosis.
       * Until this mount's probe answers, the cached snapshot may still paint
       * the workspace, with every request still gated. */}
      {settled &&
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
                flatTree={feed.flatTree}
                expanded={feed.expanded}
                toggleCollection={feed.toggleCollection}
                selection={feed.selection}
                selectScope={handleSelectScope}
                savedSearches={feed.savedSearches}
                rootLane={feed.treeLane(undefined)}
                treeLane={feed.treeLane}
                pageTree={feed.pageTree}
                retryTree={feed.retryTree}
                pageSavedSearches={feed.pageSavedSearches}
                retrySavedSearches={feed.retrySavedSearches}
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
                t={t}
                face={face}
                library={feed.currentLibrary}
                value={feed.filters}
                change={feed.setFilters}
                enabled={connected}
              />

              {feed.mode === 'everything' && (
                <div className={css.everywhereHint}>
                  <IconSearchOutlineMedium className={css.hintIcon} />
                  <span>{t('libraryEverythingHint')}</span>
                </div>
              )}

              <LibraryItemList
                t={t}
                list={feed.list}
                selection={feed.selection}
                offset={feed.offset}
                gotoOffset={feed.gotoOffset}
                selectedRef={feed.selectedRef}
                selectItem={handleSelectItem}
                retry={feed.retryList}
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
              {probeState.data?.write?.enabled === true && feed.currentLibrary.type === 'user' && (
                <LibraryWrite
                  // The write targets ride the inspected scope, so a selection
                  // change remounts the form: a draft ref can never outlive
                  // the item it was typed against.
                  key={`${feed.selectedRef ?? ''}|${feed.selection.kind === 'collection' ? feed.selection.ref : ''}|${feed.selection.kind === 'savedSearch' ? feed.selection.ref : ''}`}
                  t={t}
                  write={props.write}
                  sessionId={props.sessionId}
                  sessionRunning={sessionRunning}
                  selectedRef={feed.selectedRef}
                  collectionRef={
                    feed.selection.kind === 'collection' ? feed.selection.ref : undefined
                  }
                  searchRef={feed.selection.kind === 'savedSearch' ? feed.selection.ref : undefined}
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
                openFile={openFile}
                resolveAttachment={props.resolveAttachment}
              />
            </div>
          </div>
        </>
      )}
    </div>
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
          <button
            type="button"
            className={css.selectorButton}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('librarySelectLibrary')}
            title={currentName}
            onClick={() => setOpen((prev) => !prev)}
          >
            <span className={css.selectorLabel}>{currentName}</span>
            <IconChevronDownOutlineRegular size={12} className={css.dropdownChevron} />
          </button>
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
          <button
            type="button"
            className={css.selectorButton}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('librarySortLabel')}
            title={currentLabel}
            onClick={() => setOpen((prev) => !prev)}
          >
            <IconChevronsUpDownOutlineMedium size={14} className={css.sortIcon} />
            <span className={css.sortLabel}>{currentLabel}</span>
          </button>
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
