/**
 * The Zotero settings form body: 4 partitioned tabs holding all 37 Zotero
 * configuration fields, as elevated cards.
 *
 * Tab 1: General & Features (conversation tab, personal library write gate, default style/locale)
 * Tab 2: Local Connection (API URL, timeout, max requests, cache TTL)
 * Tab 3: Local Search & Passages (query/concurrency quotas, passage and fulltext limits)
 * Tab 4: Advanced & Tasks (output limits, background job policy, diagnostics)
 *
 * The form renders inside the `plugins.bundle.config` slot on the Zotero
 * plugin details page. The official `<SettingsForm>` supplies the chrome
 * (status lines, failed notice, save button); this module owns the segmented
 * tabs, group cards, and per-field controls.
 * @module dsh-zotero/client/ZoteroSettingsForm
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  SegmentedTabs,
  SettingsValueField,
  type SegmentedTab,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { BooleanField } from './fields.tsx'
import { writeRiskCopy } from './risk-gate.ts'
import {
  BOOLEAN_FIELD_KEYS,
  FIELD_GROUPS,
  NUMERIC_FIELD_KEYS,
  SETTINGS_TABS,
  type FieldKey,
  type GroupKey,
  type SettingsTabId,
  type ZoteroCardState,
} from './zotero-card-controller.ts'
import type { ZoteroLocaleKey } from './locales.ts'
import css from './ZoteroSettingsForm.module.css'

/** Field-editing actions, wired from the surface's card face. */
type ZoteroFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

/** What the form body needs from its surface: copy, snapshot, and actions. */
interface ZoteroSettingsFormProps {
  /** Locale reader bound to the plugin dictionary. */
  t: (key: ZoteroLocaleKey) => string
  /** The card snapshot, from the surface's bound selector. */
  state: ZoteroCardState
  /** The form's staged-edit actions. */
  actions: ZoteroFormActions
  /** Controlled active tab identifier. */
  activeTab?: SettingsTabId
  /** Fired when the active tab changes. */
  onTabChange?: (tab: SettingsTabId) => void
  /** Whether to render the internal SegmentedTabs (false when hoisted). */
  showTabs?: boolean
}

/** Field map by group key, for quick lookups. */
const FIELDS_BY_GROUP: ReadonlyMap<GroupKey, readonly FieldKey[]> = new Map(
  FIELD_GROUPS.map(({ key, fields }) => [key, fields]),
)

/**
 * Render the 4-tab settings view.
 * @param props - copy, snapshot, and staged-edit actions.
 * @returns the tabbed form view.
 */
export function ZoteroSettingsForm(props: ZoteroSettingsFormProps) {
  const { t, state, actions, showTabs = true } = props
  const [internalTab, setInternalTab] = useState<SettingsTabId>('features')
  const activeTab = props.activeTab ?? internalTab

  const handleTabChange = (next: string) => {
    const tabId = next as SettingsTabId
    if (props.onTabChange) {
      props.onTabChange(tabId)
    } else {
      setInternalTab(tabId)
    }
  }

  const tabItems: readonly [SegmentedTab<SettingsTabId>, ...SegmentedTab<SettingsTabId>[]] =
    useMemo(
      () =>
        SETTINGS_TABS.filter((tab) => tab.id !== 'scholarly').map((tab) => ({
          value: tab.id,
          label: t(tab.labelKey),
          id: `zotero-tab-${tab.id}`,
          panelId: `zotero-panel-${tab.id}`,
        })) as [SegmentedTab<SettingsTabId>, ...SegmentedTab<SettingsTabId>[]],
      [t],
    )

  const groupFieldsOf = (group: GroupKey): readonly FieldKey[] => FIELDS_BY_GROUP.get(group) ?? []

  return (
    <>
      {showTabs && (
        <div className={css.tabsContainer}>
          <SegmentedTabs
            items={tabItems}
            value={activeTab}
            onChange={handleTabChange}
            label={t('configTabsLabel')}
          />
        </div>
      )}

      {SETTINGS_TABS.filter((tab) => tab.groupKeys.length > 0).map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`zotero-panel-${tab.id}`}
          aria-labelledby={`zotero-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          className={css.tabPanel}
        >
          {tab.groupKeys.map((group) =>
            renderGroupSection(t, state, actions, group, groupFieldsOf(group)),
          )}
        </div>
      ))}
    </>
  )
}

function renderGroupSection(
  t: (key: ZoteroLocaleKey) => string,
  state: ZoteroCardState,
  actions: ZoteroFormActions,
  groupKey: GroupKey,
  fields: readonly FieldKey[],
): ReactNode {
  return (
    <section key={groupKey} className={css.group} aria-label={t(groupKey)}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t(groupKey)}</h3>
        <p className={css.groupNote}>{t(`${groupKey}Desc`)}</p>
      </div>
      <div className={css.fields}>{fields.map((key) => field(t, state, actions, key))}</div>
    </section>
  )
}

/**
 * One field control bound to the form's state and actions.
 * @param t - locale reader.
 * @param state - the card snapshot.
 * @param actions - staged-edit actions.
 * @param key - the field key, naming both the copy and the state member.
 * @returns the labelled control.
 */
function field(
  t: (key: ZoteroLocaleKey) => string,
  state: ZoteroCardState,
  actions: ZoteroFormActions,
  key: FieldKey,
): ReactNode {
  const shared = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    // Disabled while the Host is read-only **or** a save is crossing the wire:
    // SettingsFormModel.save() clears every staged draft on success, so an edit
    // typed during the round-trip would be dropped with them.
    disabled: !state.writable || state.saving,
    ...state[key],
    onEdit: (text: string) => {
      actions.edit(key, text)
    },
    onReset: () => {
      actions.resetField(key)
    },
  }
  if (BOOLEAN_FIELD_KEYS.has(key)) {
    return (
      <BooleanField
        key={key}
        label={t(key)}
        hint={t(`${key}Hint`)}
        risk={key === 'writeEnabled' ? writeRiskCopy(t) : undefined}
        {...shared}
      />
    )
  }
  return (
    <SettingsValueField
      key={key}
      id={`zotero-settings-${key}`}
      label={t(key)}
      hint={t(`${key}Hint`)}
      invalidLabel={t('invalidNumber')}
      numeric={NUMERIC_FIELD_KEYS.has(key)}
      {...shared}
    />
  )
}
