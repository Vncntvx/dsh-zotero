/**
 * The Zotero settings page: rendered in the Plugins manager detail page
 * (`plugins.bundle.config` slot, keyed by package name). It renders the visible
 * settings of the `zotero`, `library`, `scholarly`, `enrichment`, and `reader`
 * namespaces across a unified 5-tab interface, one tab per component.
 *
 * Tab 1: General (conversation tab, personal library write gate, Local API
 * connection, search and reading budgets, background jobs, diagnostics)
 * Tab 2: Literature panel (panel preferences and shared CSL defaults)
 * Tab 3: Scholarly Search (API keys, Polite Pool email, scholarly quotas)
 * Tab 4: Document Enrichment (MinerU mode, token, output directory, and
 * semantic model controls)
 * Tab 5: Document reading (reading history and position persistence)
 *
 * All five tab panels remain mounted in the DOM to prevent unmount-triggered
 * discard of uncommitted drafts when navigating between tabs. Visibility is
 * toggled via CSS hidden attributes. Each tab renders one harness `SettingsForm`
 * and therefore one save; the Literature panel tab composes the `library` and
 * `zotero` namespaces into that save the same way the harness composes its
 * Subagent settings card.
 *
 * @module dsh-zotero/client/ZoteroSettingsSection
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  SegmentedTabs,
  SettingsForm,
  type SegmentedTab,
  type SettingsFormLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView, ZoteroWriteGrantRevokeView } from '../contract.ts'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import { ScholarlySettingsForm } from './ScholarlySettingsForm.tsx'
import { SETTINGS_TABS, type SettingsTabId, type ZoteroCardFace } from './zotero-card-controller.ts'
import type { ScholarlyCardFace, ScholarlyCardState } from './scholarly-form-controller.ts'
import type { EnrichmentCardFace, EnrichmentCardState } from './enrichment-form-controller.ts'
import type { LibraryCardFace, LibraryCardState } from './library-form-controller.ts'
import type { ReaderCardFace, ReaderCardState } from './reader-settings-controller.ts'
import { LibrarySettingsForm } from './LibrarySettingsForm.tsx'
import { EnrichmentSettingsForm } from './EnrichmentSettingsForm.tsx'
import { ReaderSettingsForm } from './ReaderSettingsForm.tsx'
import { CitationDefaultsForm } from './CitationDefaultsForm.tsx'
import type { CitationCardFace, CitationCardState } from './citation-form-controller.ts'
import { composeSettingsForm, type ComposedSettingsPart } from './composed-settings.ts'
import css from './ZoteroSettingsSection.module.css'

/** Props the renderer binds for the Zotero settings page in plugins.bundle.config. */
export type ZoteroSettingsSectionProps = PropsRuntime<'plugins.bundle.config'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace> & {
    readonly useScholarlyCard?: SnapshotSelectorHook<ScholarlyCardState>
    readonly scholarly?: ScholarlyCardFace
    readonly useEnrichmentCard?: SnapshotSelectorHook<EnrichmentCardState>
    readonly enrichment?: EnrichmentCardFace
    readonly useLibraryCard?: SnapshotSelectorHook<LibraryCardState>
    readonly useReaderCard?: SnapshotSelectorHook<ReaderCardState>
    readonly useCitationCard: SnapshotSelectorHook<CitationCardState>
    readonly citation: CitationCardFace
    readonly library?: LibraryCardFace
    readonly reader?: ReaderCardFace
    readonly probe?: () => Promise<RemoteResult<ZoteroStatusView>>
    readonly revokeWriteGrant?: () => Promise<RemoteResult<ZoteroWriteGrantRevokeView>>
  }

/** The five labels the official form chrome renders, from the plugin dictionary. */
export function formLabels(t: TranslateNS<'zotero'>): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/**
 * Render the unified 5-tab Zotero settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the page, with the official chrome around its grouped form.
 */
export function ZoteroSettingsSection(props: ZoteroSettingsSectionProps): ReactNode {
  const { t } = props
  const citationState = props.useCitationCard((snapshot) => snapshot)
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')
  const zoteroState = props.useZoteroCard((snapshot) => snapshot)
  const scholarlyState = props.useScholarlyCard
    ? props.useScholarlyCard((snapshot) => snapshot)
    : undefined
  const enrichmentState = props.useEnrichmentCard
    ? props.useEnrichmentCard((snapshot) => snapshot)
    : undefined
  const libraryState = props.useLibraryCard
    ? props.useLibraryCard((snapshot) => snapshot)
    : undefined
  const readerState = props.useReaderCard ? props.useReaderCard((snapshot) => snapshot) : undefined
  const labels = useMemo(() => formLabels(t), [t])
  const library = props.library
  const libraryAvailable =
    library !== undefined && libraryState !== undefined && libraryState.available
  const libraryParts: ComposedSettingsPart[] = [
    { state: citationState, save: props.citation.save, discard: props.citation.discard },
  ]
  if (library !== undefined && libraryState !== undefined)
    libraryParts.unshift({ state: libraryState, save: library.save, discard: library.discard })
  const libraryTab = composeSettingsForm(libraryParts)

  const tabItems: readonly [SegmentedTab<SettingsTabId>, ...SegmentedTab<SettingsTabId>[]] =
    useMemo(
      () =>
        SETTINGS_TABS.map((tab) => ({
          value: tab.id,
          label: t(tab.labelKey),
          id: `zotero-tab-${tab.id}`,
          panelId: `zotero-panel-${tab.id}`,
        })) as [SegmentedTab<SettingsTabId>, ...SegmentedTab<SettingsTabId>[]],
      [t],
    )

  return (
    <div className={css.page} data-zotero-config-page>
      <div className={css.tabsContainer}>
        <SegmentedTabs
          items={tabItems}
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as SettingsTabId)}
          label={t('configTabsLabel')}
        />
      </div>

      <div
        className={css.tabPanel}
        role="tabpanel"
        id="zotero-panel-general"
        aria-labelledby="zotero-tab-general"
        hidden={activeTab !== 'general'}
      >
        <SettingsForm
          labels={labels}
          state={zoteroState}
          onSave={props.save}
          onDiscard={props.discard}
        >
          <ZoteroSettingsForm
            t={t}
            state={zoteroState}
            actions={props}
            probe={props.probe}
            revokeWriteGrant={props.revokeWriteGrant}
          />
        </SettingsForm>
      </div>

      <div
        className={css.tabPanel}
        hidden={activeTab !== 'library'}
        role="tabpanel"
        id="zotero-panel-library"
        aria-labelledby="zotero-tab-library"
      >
        <SettingsForm
          labels={labels}
          state={libraryTab.state}
          onSave={libraryTab.save}
          onDiscard={libraryTab.discard}
        >
          {libraryAvailable ? (
            <div data-library-preferences>
              <LibrarySettingsForm
                t={t}
                state={{ ...libraryState, saving: libraryTab.state.saving }}
                actions={library}
              />
            </div>
          ) : (
            <p className={css.note} role="status">
              {t('libraryDisabled')}
            </p>
          )}
          {citationState.available ? (
            <CitationDefaultsForm
              t={t}
              state={{ ...citationState, saving: libraryTab.state.saving }}
              actions={props.citation}
            />
          ) : null}
        </SettingsForm>
      </div>

      <div
        className={css.tabPanel}
        role="tabpanel"
        id="zotero-panel-scholarly"
        aria-labelledby="zotero-tab-scholarly"
        hidden={activeTab !== 'scholarly'}
      >
        {props.scholarly && scholarlyState?.available ? (
          <SettingsForm
            labels={labels}
            state={scholarlyState}
            onSave={props.scholarly.save}
            onDiscard={props.scholarly.discard}
          >
            <ScholarlySettingsForm t={t} state={scholarlyState} actions={props.scholarly} />
          </SettingsForm>
        ) : (
          <p className={css.note} role="status">
            {t('scholarlyDisabled')}
          </p>
        )}
      </div>

      <div
        className={css.tabPanel}
        role="tabpanel"
        id="zotero-panel-enrichment"
        aria-labelledby="zotero-tab-enrichment"
        hidden={activeTab !== 'enrichment'}
      >
        {props.enrichment && enrichmentState?.available ? (
          <SettingsForm
            labels={labels}
            state={enrichmentState}
            onSave={props.enrichment.save}
            onDiscard={props.enrichment.discard}
          >
            <EnrichmentSettingsForm t={t} state={enrichmentState} actions={props.enrichment} />
          </SettingsForm>
        ) : (
          <p className={css.note} role="status">
            {t('enrichmentDisabled')}
          </p>
        )}
      </div>

      <div
        className={css.tabPanel}
        role="tabpanel"
        id="zotero-panel-reader"
        aria-labelledby="zotero-tab-reader"
        hidden={activeTab !== 'reader'}
      >
        {props.reader && readerState?.available ? (
          <SettingsForm
            labels={labels}
            state={readerState}
            onSave={props.reader.save}
            onDiscard={props.reader.discard}
          >
            <ReaderSettingsForm t={t} state={readerState} actions={props.reader} />
          </SettingsForm>
        ) : (
          <p className={css.note} role="status">
            {t('readerDisabled')}
          </p>
        )}
      </div>
    </div>
  )
}
