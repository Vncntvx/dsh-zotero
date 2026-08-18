/**
 * The workspace view: the Sources panel's pure presentation surface, driven
 * entirely by props (workspace, connection, session id, refresh, prefill).
 * Fixtures render it directly — visual iteration never needs a live session
 * or a real Zotero. The surface is a master-detail pair: the source sidebar
 * (filter bar plus a listbox of source rows) and the inspector (overview,
 * evidence, and exports panels of the selected source). The top lens bar
 * splits 文献 | 导出: the sources workspace and the session-wide export
 * artifacts page. Selection follows the fixed invariants (see below), the
 * keyboard contract is listbox semantics with roving tabindex, and narrow
 * surfaces collapse to one pane at a time through the mobile pane state.
 * @module dsh-zotero/client/components/workspace/ZoteroWorkspaceView
 */

import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../../sources/model.ts'
import {
  exportedRefCountOf,
  filterCountsOf,
  filterSources,
  type SourceFilter,
} from '../../sources/selectors.ts'
import { WorkspaceToolbar } from './WorkspaceToolbar.tsx'
import type { ConnectionView } from './connection.ts'
import { SourceSidebar } from './SourceSidebar.tsx'
import { SourceInspector } from './SourceInspector.tsx'
import { WorkspaceEmptyState } from './WorkspaceEmptyState.tsx'
import { ExportsPage } from './ExportsPage.tsx'
import { EvidenceOverview } from './EvidenceOverview.tsx'
import css from './workspace.module.css'

/** The workspace view's top-level lenses: the sources workspace or the exports page. */
export type WorkspaceLensId = 'sources' | 'exports'

/** The lens bar's entries: id plus its locale key. */
const LENSES: readonly {
  readonly id: WorkspaceLensId
  readonly key: 'lensSources' | 'lensExports'
}[] = [
  { id: 'sources', key: 'lensSources' },
  { id: 'exports', key: 'lensExports' },
]

/** The narrow-surface navigation state: one pane at a time. */
export type MobilePane = 'list' | 'detail'

export interface ZoteroWorkspaceViewProps {
  readonly workspace: SourceWorkspace
  readonly connection: ConnectionView
  readonly sessionId: string
  /** Composer prefill; absent on surfaces without an input. */
  readonly setDraft?: (text: string) => void
  readonly onRefresh: () => void
  readonly t: TranslateNS<'zotero'>
}

/** The selected source's key, or undefined when nothing is selected. */
export type SelectedKey = string | undefined

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
 * rows. A selection a filter hid is kept — filtering narrows the left list
 * only, never the document the inspector is showing, which notes the hidden
 * state — and only a selection the workspace no longer contains falls back to
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
  return visible.length === 0 ? undefined : visible[0]!.key
}

/** The minimal item shape the selection logic needs. */
export interface SourceItemLike {
  readonly key: string
}

/** The workspace view: toolbar, lens bar, and the master-detail surface. */
export function ZoteroWorkspaceView({
  workspace,
  connection,
  sessionId,
  setDraft,
  onRefresh,
  t,
}: ZoteroWorkspaceViewProps) {
  const [lens, setLens] = useState<WorkspaceLensId>('sources')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [selection, setSelection] = useState<SelectionState>({ key: undefined, focusIndex: 0 })
  const [mobilePane, setMobilePane] = useState<MobilePane>('list')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const listRef = useRef<HTMLElement>(null)

  const counts = useMemo(() => filterCountsOf(workspace.sources), [workspace.sources])
  const visible = useMemo(
    () => filterSources(workspace.sources, filter),
    [workspace.sources, filter],
  )
  const selectedKey = effectiveSelectionOf(selection, workspace.sources, visible)
  // The exports lens counts distinct exported documents, not export calls.
  const exportedCount = useMemo(() => exportedRefCountOf(workspace.exports), [workspace.exports])

  // Session switches reset the whole surface: the parent keys this view by
  // the session id, so this state never survives a session change.
  void sessionId

  if (evidenceOpen) {
    return (
      <div className={css.view} data-conversation-composer-overlay>
        <WorkspaceToolbar connection={connection} onRefresh={onRefresh} t={t} />
        <EvidenceOverview
          workspace={workspace}
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
      <WorkspaceToolbar connection={connection} onRefresh={onRefresh} t={t} />
      <div className={css.lensBar} role="group">
        {LENSES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={clsx(css.lensTab, lens === entry.id && css.lensTabActive)}
            aria-pressed={lens === entry.id}
            data-workspace-lens={entry.id}
            onClick={() => {
              setLens(entry.id)
            }}
          >
            {t(entry.key)}
            {entry.id === 'exports' && exportedCount > 0 && (
              <span className={css.lensTabCount}>{exportedCount}</span>
            )}
          </button>
        ))}
      </div>
      {lens === 'exports' ? (
        <ExportsPage workspace={workspace} t={t} />
      ) : workspace.sources.length === 0 ? (
        <WorkspaceEmptyState setDraft={setDraft} t={t} />
      ) : (
        <div className={css.workspace} data-pane={mobilePane}>
          <SourceSidebar
            workspace={workspace}
            filter={filter}
            counts={counts}
            visible={visible}
            selection={selection}
            selectedKey={selectedKey}
            setFilter={setFilter}
            setSelection={setSelection}
            setMobilePane={setMobilePane}
            onOpenEvidence={() => {
              setEvidenceOpen(true)
            }}
            listRef={listRef}
            t={t}
          />
          <SourceInspector
            workspace={workspace}
            selectedKey={selectedKey}
            selectionHidden={
              selectedKey !== undefined && !visible.some((item) => item.key === selectedKey)
            }
            setMobilePane={setMobilePane}
            setDraft={setDraft}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
