/**
 * The source inspector: the detail surface of the selected source. Three
 * panels — Overview (identity and search provenance), Passages (the
 * retrieval summary, passages, and per-source availability), and Exports
 * (the item's export artifacts) — switch through the inspector's own tab
 * row: light text tabs (no pill chrome, so the three hierarchy levels —
 * top lens tabs, filter pills, detail tabs — read differently at a glance)
 * carrying the panel's count when there is something to count. A selection
 * hidden by the current filter keeps rendering with a note instead of
 * vanishing. The narrow-surface back action returns to the list pane.
 * @module dsh-zotero/client/components/workspace/SourceInspector
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceItem, SourceWorkspace } from '../../sources/model.ts'
import type { MobilePane } from './ZoteroWorkspaceView.tsx'
import { SourceOverview } from './SourceOverview.tsx'
import { SourceEvidence } from './SourceEvidence.tsx'
import { SourceExports } from './SourceExports.tsx'
import css from './workspace.module.css'

/** The inspector's panels. */
export type InspectorPanelId = 'overview' | 'evidence' | 'exports'

/**
 * The panel tab entries of one item: id, locale key, and the count shown
 * beside the label (omitted when zero — an empty panel's onboarding note
 * states more than a "0" would).
 */
function panelEntriesOf(item: SourceItem): readonly {
  readonly id: InspectorPanelId
  readonly key: 'panelOverview' | 'panelEvidence' | 'panelExports'
  readonly count: number | undefined
}[] {
  return [
    { id: 'overview', key: 'panelOverview', count: undefined },
    { id: 'evidence', key: 'panelEvidence', count: item.evidence.length },
    { id: 'exports', key: 'panelExports', count: item.exports.length },
  ]
}

export interface SourceInspectorProps {
  readonly workspace: SourceWorkspace
  readonly selectedKey: string | undefined
  /** True when the selection is hidden by the active filter. */
  readonly selectionHidden: boolean
  readonly setMobilePane: (pane: MobilePane) => void
  readonly setDraft?: (text: string) => void
  readonly t: TranslateNS<'zotero'>
}

/** The inspector: panel tabs plus the selected source's active panel. */
export function SourceInspector({
  workspace,
  selectedKey,
  selectionHidden,
  setMobilePane,
  setDraft,
  t,
}: SourceInspectorProps) {
  const [panel, setPanel] = useState<InspectorPanelId>('overview')
  const selected = workspace.sources.find((item) => item.key === selectedKey)

  if (selected === undefined) {
    return (
      <main className={css.inspector}>
        <p className={css.emptyNote}>{t('inspectorEmptyNote')}</p>
      </main>
    )
  }

  return (
    <main className={css.inspector}>
      <div className={css.inspectorHead}>
        <button
          type="button"
          className={css.backAction}
          onClick={() => {
            setMobilePane('list')
          }}
        >
          {t('backToList')}
        </button>
        <div className={css.inspectorTitleWrap}>
          <span className={css.inspectorTitle}>{selected.title ?? selected.ref}</span>
          <span className={css.inspectorMeta}>
            {[selected.creators, selected.year, selected.venue].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      {selectionHidden && <p className={css.warning}>{t('selectionHiddenNote')}</p>}
      <div className={css.inspectorTabs} role="group">
        {panelEntriesOf(selected).map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={clsx(css.detailTab, panel === entry.id && css.detailTabActive)}
            aria-pressed={panel === entry.id}
            data-inspector-panel={entry.id}
            onClick={() => {
              setPanel(entry.id)
            }}
          >
            {t(entry.key)}
            {entry.count !== undefined && entry.count > 0 && (
              <span className={css.detailTabCount}>{entry.count}</span>
            )}
          </button>
        ))}
      </div>
      <div className={css.inspectorBody}>
        {panel === 'overview' ? (
          <SourceOverview item={selected} t={t} setDraft={setDraft} />
        ) : panel === 'evidence' ? (
          <SourceEvidence item={selected} t={t} />
        ) : (
          <SourceExports item={selected} t={t} />
        )}
      </div>
    </main>
  )
}
