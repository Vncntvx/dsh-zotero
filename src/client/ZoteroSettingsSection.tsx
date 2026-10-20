/**
 * The Zotero settings page: rendered in the Plugins manager detail page
 * (`plugins.bundle.config` slot, keyed by package name). It edits every field
 * of the `zotero` namespace and `scholarly` namespace across a unified 5-tab
 * interface.
 *
 * Tab 1: General (conversation tab, personal library write gate, default style/locale)
 * Tab 2: Connection (API URL, timeout, max requests, cache TTL)
 * Tab 3: Search & Extraction (query/concurrency quotas, passage and fulltext limits)
 * Tab 4: Scholarly Search (API keys, Polite Pool email, scholarly quotas)
 * Tab 5: Advanced (output limits, background job policy, diagnostics)
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
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import { ScholarlySettingsForm } from './ScholarlySettingsForm.tsx'
import type { SettingsTabId, ZoteroCardFace } from './zotero-card-controller.ts'
import type { ScholarlyCardFace, ScholarlyCardState } from './scholarly-form-controller.ts'
import css from './ZoteroSettingsSection.module.css'

/** Props the renderer binds for the Zotero settings page in plugins.bundle.config. */
export type ZoteroSettingsSectionProps = PropsRuntime<'plugins.bundle.config'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace> & {
    readonly useScholarlyCard?: SnapshotSelectorHook<ScholarlyCardState>
    readonly scholarly?: ScholarlyCardFace
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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('features')
  const zoteroState = props.useZoteroCard((snapshot) => snapshot)
  const scholarlyState = props.useScholarlyCard
    ? props.useScholarlyCard((snapshot) => snapshot)
    : undefined
  const labels = useMemo(() => formLabels(t), [t])

  const tabItems: readonly [SegmentedTab<SettingsTabId>, ...SegmentedTab<SettingsTabId>[]] =
    useMemo(
      () => [
        {
          value: 'features',
          label: t('tabFeatures'),
          id: 'zotero-tab-features',
          panelId: 'zotero-panel-features',
        },
        {
          value: 'connection',
          label: t('tabConnection'),
          id: 'zotero-tab-connection',
          panelId: 'zotero-panel-connection',
        },
        {
          value: 'search',
          label: t('tabSearch'),
          id: 'zotero-tab-search',
          panelId: 'zotero-panel-search',
        },
        {
          value: 'scholarly',
          label: t('tabScholarly'),
          id: 'zotero-tab-scholarly',
          panelId: 'zotero-panel-scholarly',
        },
        {
          value: 'advanced',
          label: t('tabAdvanced'),
          id: 'zotero-tab-advanced',
          panelId: 'zotero-panel-advanced',
        },
      ],
      [t],
    )

  return (
    <div className={css.page} data-zotero-config-page>
      <div className={css.head}>
        <h2 className={css.title}>{t('title')}</h2>
      </div>
      <p className={css.description}>{t('description')}</p>

      <div className={css.tabsContainer}>
        <SegmentedTabs
          items={tabItems}
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as SettingsTabId)}
          label={t('configTabsLabel')}
        />
      </div>

      <div className={css.tabPanel} hidden={activeTab === 'scholarly'}>
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
          />
        </SettingsForm>
      </div>

      <div className={css.tabPanel} hidden={activeTab !== 'scholarly'}>
        {props.scholarly && scholarlyState ? (
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
            <p className={css.description}>{t('unavailable')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
