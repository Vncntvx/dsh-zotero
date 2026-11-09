/**
 * The workspace view: the Sources panel's pure presentation surface, driven
 * entirely by props (workspace, connection, session id, refresh, prefill).
 * Fixtures render it directly, so visual iteration never needs a live session
 * or a real Zotero. The surface is a master-detail pair: the source sidebar
 * (filter bar plus a listbox of source rows) and the inspector (overview,
 * evidence, and exports panels of the selected source). The top lens bar
 * splits 文献 | 导出: the sources workspace and the session-wide export
 * artifacts page. Selection follows the fixed invariants (see below), the
 * keyboard contract is listbox semantics with roving tabindex, and narrow
 * surfaces collapse to one pane at a time through the mobile pane state.
 * @module dsh-zotero/client/components/workspace/ZoteroWorkspaceView
 */

import { useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAttachmentLocationView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroSourcePageResultView,
} from '../../../contract.ts'
import type { SourceItem, SourceWorkspace } from '../../../sources/model.js'
import { mapTuple } from '../../segmented-tabs.ts'
import { filterSources, type SourceFilter } from '../../sources/selectors.ts'
import { WorkspaceToolbar } from './WorkspaceToolbar.tsx'
import type { ConnectionView } from './connection.ts'
import { SourceSidebar } from './SourceSidebar.tsx'
import { SourceInspector } from './SourceInspector.tsx'
import { WorkspaceEmptyState } from './WorkspaceEmptyState.tsx'
import { ExportsPage } from './ExportsPage.tsx'
import { EvidenceOverview } from './EvidenceOverview.tsx'
import { SourceAuditPanel } from './SourceAuditPanel.tsx'
import { useSourcePage, type SourcePageCall } from './useSourcePage.ts'
import css from './workspace.module.css'

/** The workspace view's top-level lenses: the sources workspace or the exports page. */
type WorkspaceLensId = 'sources' | 'exports'

/** The lens bar's entries: id plus its locale key. A tuple, so the tab row can be built without asserting it is non-empty. */
const LENSES: readonly [
  { readonly id: 'sources'; readonly key: 'lensSources' },
  { readonly id: 'exports'; readonly key: 'lensExports' },
] = [
  { id: 'sources', key: 'lensSources' },
  { id: 'exports', key: 'lensExports' },
]

/** The narrow-surface navigation state: one pane at a time. */
export type MobilePane = 'list' | 'detail'

interface ZoteroWorkspaceViewProps {
  readonly workspace: SourceWorkspace
  readonly connection: ConnectionView
  readonly canExport?: boolean
  readonly exportCitation?: (
    request: ZoteroLibraryExportRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryExportResultView>>
  /** The session the trail belongs to; the paging endpoint is session-scoped. */
  readonly sessionId?: string
  /** The bounded-list pager; absent leaves every list at the view's head. */
  readonly sourcePage?: SourcePageCall
  /** Open one URL attachment's PDF into the right reader; absent keeps the resolved-path fallback. */
  readonly openPdf?: (ref: string) => Promise<void>
  /** Composer prefill; absent on surfaces without an input. */
  readonly setDraft?: (text: string) => void
  readonly onRefresh: () => void
  readonly t: TranslateNS<'zotero'>
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly openProtocol?: (url: string) => Promise<boolean>
}

/** The selected source's key, or undefined when nothing is selected. */
type SelectedKey = string | undefined

/**
 * The selection state of the master list: the user's chosen source key plus
 * the current listbox focus index. The key survives filtering (the inspector
 * keeps showing a hidden selection with a note); the focus index walks the
 * visible rows.
 */
export interface SelectionState {
  readonly key: SelectedKey
  readonly focusIndex: number
}

/** The filter bar's entries: filter id plus its locale key, in bar order. */
export const FILTERS: readonly {
  readonly id: SourceFilter
  readonly key:
    | 'filterAll'
    | 'filterPdf'
    | 'filterRetrieved'
    | 'filterEvidence'
    | 'filterExported'
    | 'filterIssues'
}[] = [
  { id: 'all', key: 'filterAll' },
  { id: 'pdf', key: 'filterPdf' },
  { id: 'retrieved', key: 'filterRetrieved' },
  { id: 'evidence', key: 'filterEvidence' },
  { id: 'exported', key: 'filterExported' },
  { id: 'issues', key: 'filterIssues' },
]

/**
 * Resolve the effective selection against the workspace union and the visible
 * rows. A selection a filter hid is kept: filtering narrows the left list
 * only, never the document the inspector is showing, which notes the hidden
 * state. Only a selection the workspace no longer contains falls back to
 * the first visible row.
 */
export function effectiveSelectionOf(
  selection: SelectionState,
  workspace: readonly SourceItemLike[],
  visible: readonly SourceItemLike[],
): SelectedKey {
  if (selection.key !== undefined && workspace.some((item) => item.key === selection.key)) {
    return selection.key
  }
  return visible[0]?.key
}

/** The minimal item shape the selection logic needs. */
interface SourceItemLike {
  readonly key: string
}

/**
 * The rows the accepted pages contributed for one source's row list.
 *
 * The page carries the paged source itself, so the rows come from its first
 * entry; the caller appends them to the rows the view already shows.
 * @param pages - the accepted pages, oldest first.
 * @param rows - the row list to collect.
 * @returns the collected rows.
 */
export function appendedSourceRows<K extends 'searches' | 'evidence' | 'exports'>(
  pages: readonly ZoteroSourcePageResultView[],
  rows: K,
): SourceItem[K] {
  const collected: unknown[] = []
  for (const page of pages) {
    const item = page.workspace.sources[0]
    if (item === undefined) continue
    collected.push(...(item[rows] as readonly unknown[]))
  }
  return collected as SourceItem[K]
}

/** The workspace view: toolbar, lens bar, and the master-detail surface. */
export function ZoteroWorkspaceView({
  workspace,
  connection,
  canExport,
  exportCitation,
  sessionId,
  sourcePage,
  openPdf,
  setDraft,
  onRefresh,
  t,
  openFile,
  resolveAttachment,
  openProtocol,
}: ZoteroWorkspaceViewProps) {
  const [lens, setLens] = useState<WorkspaceLensId>('sources')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [selection, setSelection] = useState<SelectionState>({ key: undefined, focusIndex: 0 })
  const [mobilePane, setMobilePane] = useState<MobilePane>('list')
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  // The filter bar reads the workspace's own aggregates, computed host-side
  // over ALL sources before the view was windowed; a windowed source the
  // list does not show still counts.
  const counts = workspace.filterCounts
  const visible = useMemo(
    () => filterSources(workspace.sources, filter),
    [workspace.sources, filter],
  )
  const selectedKey = useMemo(
    () => effectiveSelectionOf(selection, workspace.sources, visible),
    [selection, workspace.sources, visible],
  )
  const selectedItem = useMemo(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey],
  )
  // The exports lens counts distinct exported documents, not export calls.
  const exportedCount = workspace.exportedRefCount

  // The projection's view is windowed: the rows behind that window are fetched
  // one page at a time. Each pager asks only when its own list is truncated,
  // so a session that fits the window never issues a request.
  const sourcesPager = useSourcePage(sourcePage, {
    sessionId,
    target: { kind: 'sources', filter },
    offset: visible.length,
    total: counts[filter],
    enabled: counts[filter] > visible.length,
  })
  const evidencePager = useSourcePage(sourcePage, {
    sessionId,
    target: { kind: 'source', key: selectedKey ?? '', rows: 'evidence' },
    offset: selectedItem?.evidence.length ?? 0,
    total: selectedItem?.evidenceTotal ?? 0,
    enabled: (selectedItem?.evidenceTotal ?? 0) > (selectedItem?.evidence.length ?? 0),
  })
  const sourceExportsPager = useSourcePage(sourcePage, {
    sessionId,
    target: { kind: 'source', key: selectedKey ?? '', rows: 'exports' },
    offset: selectedItem?.exports.length ?? 0,
    total: selectedItem?.exportsTotal ?? 0,
    enabled: (selectedItem?.exportsTotal ?? 0) > (selectedItem?.exports.length ?? 0),
  })
  const searchesPager = useSourcePage(sourcePage, {
    sessionId,
    target: { kind: 'source', key: selectedKey ?? '', rows: 'searches' },
    offset: selectedItem?.searches.length ?? 0,
    total: selectedItem?.searchesTotal ?? 0,
    enabled: (selectedItem?.searchesTotal ?? 0) > (selectedItem?.searches.length ?? 0),
  })
  const sessionExportsPager = useSourcePage(sourcePage, {
    sessionId,
    target: { kind: 'session', rows: 'exports' },
    offset: workspace.exports.length,
    total: workspace.exportTotal,
    enabled: workspace.exportTotal > workspace.exports.length,
  })

  // The paged rows join the view's own head: the head is the list's prefix,
  // so appending the pages behind it yields the complete list.
  const pagedSources = useMemo(
    () => sourcesPager.pages.flatMap((page) => page.workspace.sources),
    [sourcesPager.pages],
  )
  const listedSources = useMemo(
    () => [...workspace.sources, ...pagedSources],
    [workspace.sources, pagedSources],
  )
  const listedVisible = useMemo(() => [...visible, ...pagedSources], [visible, pagedSources])
  const pagedItem = useMemo(() => {
    if (selectedItem === undefined) return undefined
    return {
      ...selectedItem,
      evidence: [
        ...selectedItem.evidence,
        ...appendedSourceRows(evidencePager.pages, 'evidence'),
      ] as SourceItem['evidence'],
      exports: [
        ...selectedItem.exports,
        ...appendedSourceRows(sourceExportsPager.pages, 'exports'),
      ] as SourceItem['exports'],
      searches: [
        ...selectedItem.searches,
        ...appendedSourceRows(searchesPager.pages, 'searches'),
      ] as SourceItem['searches'],
    }
  }, [evidencePager.pages, searchesPager.pages, selectedItem, sourceExportsPager.pages])
  const pagedWorkspace = useMemo(
    () => ({
      ...workspace,
      sources: listedSources.map((item) => (item.key === selectedKey ? (pagedItem ?? item) : item)),
      exports: [
        ...workspace.exports,
        ...sessionExportsPager.pages.flatMap((page) => page.workspace.exports),
      ],
    }),
    [listedSources, pagedItem, selectedKey, sessionExportsPager.pages, workspace],
  )

  const lensTabItems = useMemo(
    () =>
      mapTuple(LENSES, (entry) => ({
        value: entry.id,
        label: (
          <span data-workspace-lens={entry.id}>
            {t(entry.key)}
            {entry.id === 'exports' && exportedCount > 0 && (
              <span className={css.lensTabCount}>{exportedCount}</span>
            )}
          </span>
        ),
        id: `workspace-lens-${entry.id}`,
        panelId: `workspace-lens-${entry.id}-panel`,
      })),
    [exportedCount, t],
  )

  if (evidenceOpen) {
    return (
      <div className={css.view} data-conversation-composer-overlay>
        <WorkspaceToolbar
          connection={connection}
          onRefresh={onRefresh}
          t={t}
          workspace={workspace}
          lens={lens}
          setLens={setLens}
          lensTabItems={lensTabItems}
        />
        <EvidenceOverview
          workspace={pagedWorkspace}
          openFile={openFile}
          resolveAttachment={resolveAttachment}
          openProtocol={openProtocol}
          onBack={() => {
            setEvidenceOpen(false)
          }}
          t={t}
        />
      </div>
    )
  }

  return (
    <div
      className={css.view}
      data-conversation-composer-overlay
      onKeyDown={(event) => {
        // Esc in the narrow detail pane returns to the list. On wide
        // surfaces the pane state is inert, so the key does nothing.
        if (event.key === 'Escape' && mobilePane === 'detail') {
          setMobilePane('list')
        }
      }}
    >
      <WorkspaceToolbar
        connection={connection}
        onRefresh={onRefresh}
        t={t}
        workspace={pagedWorkspace}
        lens={lens}
        setLens={setLens}
        lensTabItems={lensTabItems}
      />
      {lens === 'exports' ? (
        <ExportsPage workspace={pagedWorkspace} pager={sessionExportsPager} t={t} />
      ) : listedSources.length === 0 ? (
        <WorkspaceEmptyState setDraft={setDraft} t={t} />
      ) : (
        <div className={css.workspace} data-pane={mobilePane}>
          <SourceSidebar
            workspace={workspace}
            filter={filter}
            counts={counts}
            visible={listedVisible}
            pager={sourcesPager}
            selection={selection}
            selectedKey={selectedKey}
            setFilter={setFilter}
            setSelection={setSelection}
            setMobilePane={setMobilePane}
            onOpenEvidence={() => {
              setEvidenceOpen(true)
            }}
            t={t}
          />
          <SourceInspector
            // A new selection opens on Overview: remounting on the key resets
            // the panel during render, so the previous source's tab (e.g.
            // Exports) never strands the next source on an empty panel. An
            // effect would paint that stale tab first and correct it after.
            key={selectedKey}
            workspace={pagedWorkspace}
            selectedKey={selectedKey}
            selectionHidden={
              selectedKey !== undefined && !listedVisible.some((item) => item.key === selectedKey)
            }
            setMobilePane={setMobilePane}
            setDraft={setDraft}
            openFile={openFile}
            resolveAttachment={resolveAttachment}
            openProtocol={openProtocol}
            openPdf={openPdf}
            evidencePager={evidencePager}
            exportsPager={sourceExportsPager}
            t={t}
          />
          <aside className={css.auditSidebar}>
            {pagedItem && (
              // A narrow container hides this aside with CSS while the tree
              // keeps it mounted; the citation export must not fire for a
              // surface the user cannot see, so the pane state gates it.
              <div hidden={mobilePane === 'list'}>
                <SourceAuditPanel
                  item={pagedItem}
                  canExport={canExport === true && mobilePane === 'detail'}
                  exportCitation={mobilePane === 'detail' ? exportCitation : undefined}
                  pager={searchesPager}
                  t={t}
                />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
