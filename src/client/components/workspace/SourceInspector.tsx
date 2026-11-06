/**
 * The source inspector: the detail surface of the selected source. Three
 * panels, Overview (identity and search records), Passages (the
 * retrieval summary, passages, and per-source availability), and Exports
 * (the item's export artifacts), switch through a panel row the host draws
 * (`SegmentedTabs`, size sm) — the same control the workspace's top lens bar
 * uses, so the two navigation levels read as one system rather than three. The
 * row carries the panel's count when there is something to count. A selection
 * hidden by the current filter keeps rendering with a note instead of
 * vanishing. The narrow-surface back action returns to the list pane.
 * @module dsh-zotero/client/components/workspace/SourceInspector
 */

import { useMemo, useState } from 'react'
import { SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import type { SourceItem, SourceWorkspace } from '../../../sources/model.js'
import { mapTuple } from '../../segmented-tabs.ts'
import type { MobilePane } from './ZoteroWorkspaceView.tsx'
import { SourceOverview } from './SourceOverview.tsx'
import { SourceEvidence } from './SourceEvidence.tsx'
import { SourceExports } from './SourceExports.tsx'
import css from './workspace.module.css'

/** The inspector's panels. */
type InspectorPanelId = 'overview' | 'evidence' | 'exports'

/** One panel tab entry: id, locale key, and the count shown beside the label. */
interface PanelEntry {
  readonly id: InspectorPanelId
  readonly key: 'panelOverview' | 'panelEvidence' | 'panelExports'
  readonly count: number | undefined
}

/**
 * The panel tab entries of one item: the count beside the label is omitted
 * when zero, since an empty panel's onboarding note states more than a "0"
 * would. The tuple is what lets the tab row build without asserting that the
 * list is non-empty.
 */
function panelEntriesOf(item: SourceItem): readonly [PanelEntry, PanelEntry, PanelEntry] {
  return [
    { id: 'overview', key: 'panelOverview', count: undefined },
    { id: 'evidence', key: 'panelEvidence', count: item.evidence.length },
    { id: 'exports', key: 'panelExports', count: item.exports.length },
  ]
}

interface SourceInspectorProps {
  readonly workspace: SourceWorkspace
  readonly selectedKey: string | undefined
  /** True when the selection is hidden by the active filter. */
  readonly selectionHidden: boolean
  readonly setMobilePane: (pane: MobilePane) => void
  readonly setDraft?: (text: string) => void
  readonly t: TranslateNS<'zotero'>
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly openProtocol?: (url: string) => Promise<boolean>
}

/** The inspector: panel tabs plus the selected source's active panel. */
export function SourceInspector({
  workspace,
  selectedKey,
  selectionHidden,
  setMobilePane,
  setDraft,
  t,
  openFile,
  resolveAttachment,
  openProtocol,
}: SourceInspectorProps) {
  const [panel, setPanel] = useState<InspectorPanelId>('overview')
  const selected = useMemo(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey],
  )

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
      <InspectorTabs item={selected} panel={panel} setPanel={setPanel} t={t} />
      <div className={css.inspectorBody}>
        {panel === 'overview' ? (
          <SourceOverview
            item={selected}
            t={t}
            setDraft={setDraft}
            openFile={openFile}
            resolveAttachment={resolveAttachment}
            openProtocol={openProtocol}
          />
        ) : panel === 'evidence' ? (
          <SourceEvidence item={selected} t={t} />
        ) : (
          <SourceExports item={selected} t={t} />
        )}
      </div>
    </main>
  )
}

/** The inspector's panel row: the host tab list plus its per-panel counts. */
function InspectorTabs({
  item,
  panel,
  setPanel,
  t,
}: {
  readonly item: SourceItem
  readonly panel: InspectorPanelId
  readonly setPanel: (panel: InspectorPanelId) => void
  readonly t: TranslateNS<'zotero'>
}) {
  const entries = useMemo(() => panelEntriesOf(item), [item])
  const items = useMemo(
    () =>
      mapTuple(entries, (entry) => ({
        value: entry.id,
        label: (
          <span data-inspector-panel={entry.id}>
            {t(entry.key)}
            {entry.count !== undefined && entry.count > 0 && (
              <span className={css.detailTabCount}>{entry.count}</span>
            )}
          </span>
        ),
        id: `inspector-panel-${entry.id}`,
        panelId: `inspector-panel-${entry.id}-panel`,
      })),
    [entries, t],
  )

  return (
    <div className={css.inspectorTabs}>
      <SegmentedTabs
        items={items}
        value={panel}
        onChange={setPanel}
        label={t('inspectorTabsLabel')}
        size="sm"
      />
    </div>
  )
}
