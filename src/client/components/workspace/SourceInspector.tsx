/**
 * The source inspector: the detail surface of the selected source. Three
 * panels — Overview (identity and search provenance), Evidence (the
 * retrieval summary, passages, and per-source availability), and Exports
 * (the item's export artifacts) — switch through the inspector's own tab
 * row. A selection hidden by the current filter keeps rendering with a
 * note instead of vanishing. The narrow-surface back action returns to the
 * list pane.
 * @module dsh-zotero/client/components/workspace/SourceInspector
 */

import { useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../../sources/model.ts'
import type { MobilePane } from './ZoteroWorkspaceView.tsx'
import { SourceOverview } from './SourceOverview.tsx'
import { SourceEvidence } from './SourceEvidence.tsx'
import { SourceExports } from './SourceExports.tsx'
import css from './workspace.module.css'

/** The inspector's panels. */
export type InspectorPanelId = 'overview' | 'evidence' | 'exports'

/** The panel tab entries: id plus its locale key. */
const PANELS: readonly {
  readonly id: InspectorPanelId
  readonly key: 'panelOverview' | 'panelEvidence' | 'panelExports'
}[] = [
  { id: 'overview', key: 'panelOverview' },
  { id: 'evidence', key: 'panelEvidence' },
  { id: 'exports', key: 'panelExports' },
]

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
        {PANELS.map((entry) => (
          <Pill
            key={entry.id}
            active={panel === entry.id}
            aria-pressed={panel === entry.id}
            data-inspector-panel={entry.id}
            onClick={() => {
              setPanel(entry.id)
            }}
          >
            {t(entry.key)}
          </Pill>
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
