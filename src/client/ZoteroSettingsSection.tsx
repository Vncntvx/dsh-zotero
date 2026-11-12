/**
 * The Zotero settings page: rendered in the Plugins manager detail page
 * (`plugins.bundle.config` slot, keyed by package name). It edits every field
 * of the `zotero`, `library`, `scholarly`, and `enrichment` namespaces across a
 * unified 7-tab interface.
 *
 * Tab 1: General (conversation tab and personal library write gate)
 * Tab 2: Connection (API URL, timeout, max requests, cache TTL)
 * Tab 3: Search & Extraction (query/concurrency quotas, passage and fulltext limits)
 * Tab 4: Library (panel preferences and shared CSL defaults)
 * Tab 5: Scholarly Search (API keys, Polite Pool email, scholarly quotas)
 * Tab 6: Document Enrichment (MinerU mode, token, output directory,
 * Tab 7: Advanced (output limits, background job policy, diagnostics)
 *
 * Both the Zotero and Scholarly SettingsForm containers remain mounted in the DOM
 * to prevent unmount-triggered discard of uncommitted drafts when navigating between
 * tabs. Visibility is toggled via CSS hidden attributes.
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
import { LibrarySettingsForm } from './LibrarySettingsForm.tsx'
import { EnrichmentSettingsForm } from './EnrichmentSettingsForm.tsx'
import { CitationDefaultsForm } from './CitationDefaultsForm.tsx'
import type { CitationCardFace, CitationCardState } from './citation-form-controller.ts'
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
    readonly useCitationCard: SnapshotSelectorHook<CitationCardState>
    readonly citation: CitationCardFace
    readonly library?: LibraryCardFace
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
 * Render the unified 7-tab Zotero settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the page, with the official chrome around its grouped form.
 */
export function ZoteroSettingsSection(props: ZoteroSettingsSectionProps): ReactNode {
  const { t } = props
  const citationState = props.useCitationCard((snapshot) => snapshot)
  const [activeTab, setActiveTab] = useState<SettingsTabId>('features')
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
  const labels = useMemo(() => formLabels(t), [t])

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
        hidden={activeTab === 'scholarly' || activeTab === 'library' || activeTab === 'enrichment'}
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
            activeTab={activeTab}
            showTabs={false}
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
        {props.library && libraryState?.available ? (
          <div data-library-preferences>
            <SettingsForm
              labels={labels}
              state={libraryState}
              onSave={props.library.save}
              onDiscard={props.library.discard}
            >
              <LibrarySettingsForm t={t} state={libraryState} actions={props.library} />
            </SettingsForm>
          </div>
        ) : (
          <p className={css.note} role="status">
            {t('libraryDisabled')}
          </p>
        )}
        <CitationDefaultsForm
          t={t}
          state={citationState}
          actions={props.citation}
          labels={labels}
        />
      </div>

      <div className={css.tabPanel} hidden={activeTab !== 'scholarly'}>
        {props.scholarly && scholarlyState?.available ? (
          <SettingsForm
            labels={labels}
            state={scholarlyState}
            onSave={props.scholarly.save}
            onDiscard={props.scholarly.discard}
          >
            <div
              role="tabpanel"
              id="zotero-panel-scholarly"
              aria-labelledby="zotero-tab-scholarly"
              className={css.tabPanel}
            >
              <ScholarlySettingsForm t={t} state={scholarlyState} actions={props.scholarly} />
            </div>
          </SettingsForm>
        ) : (
          <div
            role="tabpanel"
            id="zotero-panel-scholarly"
            aria-labelledby="zotero-tab-scholarly"
            className={css.tabPanel}
          >
            <p className={css.note} role="status">
              {t('scholarlyDisabled')}
            </p>
          </div>
        )}
      </div>

      <div className={css.tabPanel} hidden={activeTab !== 'enrichment'}>
        {props.enrichment && enrichmentState?.available ? (
          <SettingsForm
            labels={labels}
            state={enrichmentState}
            onSave={props.enrichment.save}
            onDiscard={props.enrichment.discard}
          >
            <div
              role="tabpanel"
              id="zotero-panel-enrichment"
              aria-labelledby="zotero-tab-enrichment"
              className={css.tabPanel}
            >
              <EnrichmentSettingsForm t={t} state={enrichmentState} actions={props.enrichment} />
            </div>
          </SettingsForm>
        ) : (
          <div
            role="tabpanel"
            id="zotero-panel-enrichment"
            aria-labelledby="zotero-tab-enrichment"
            className={css.tabPanel}
          >
            <p className={css.note} role="status">
              {t('enrichmentDisabled')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
