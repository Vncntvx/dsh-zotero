/**
 * Quick toggles for core Zotero plugin settings rendered in the Plugins manager
 * detail page (plugins.bundle.config slot). Enabling writes is gated behind the
 * shared risk acknowledgement so the sensitive flip cannot land by accident.
 * @module dsh-zotero/client/components/plugin/ZoteroBundleQuickConfig
 */

import { type ReactNode } from 'react'
import { RiskConfirmation, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useRiskGate, writeRiskCopy } from '../../risk-gate.ts'
import type { QuickConfigField } from './faces.ts'
import css from './plugin-cards.module.css'

/**
 * The upstream owner share minus `form`: the manager page supplies a
 * `ConfigPageForm` only to `plugins.row.config` and `plugins.item` entries,
 * never to a bundle's own config row, whose form arrives through this
 * entry's `inject` face instead.
 */
export interface ZoteroBundleQuickConfigProps extends Omit<PluginConfigViewProps, 'form'> {
  readonly t?: TranslateNS<'zotero'>
  readonly useZoteroQuickConfig?: SnapshotSelectorHook<ConfigFormSnapshot<Record<string, unknown>>>
  readonly setField?: (field: QuickConfigField, value: boolean) => void
}

/** Required face once the slot has supplied snapshot, translator and write edge. */
interface QuickConfigBodyProps {
  readonly t: TranslateNS<'zotero'>
  readonly useZoteroQuickConfig: SnapshotSelectorHook<ConfigFormSnapshot<Record<string, unknown>>>
  readonly setField: (field: QuickConfigField, value: boolean) => void
}

/**
 * Slot entry: keep the early-out in a hook-free shell so the body's hook
 * count never varies with props.
 */
export function ZoteroBundleQuickConfig({
  view,
  t,
  useZoteroQuickConfig,
  setField,
}: ZoteroBundleQuickConfigProps): ReactNode {
  if (view !== 'page') return null
  if (!useZoteroQuickConfig || !setField || !t) return null
  return (
    <ZoteroBundleQuickConfigBody
      t={t}
      useZoteroQuickConfig={useZoteroQuickConfig}
      setField={setField}
    />
  )
}

function ZoteroBundleQuickConfigBody({
  t,
  useZoteroQuickConfig,
  setField,
}: QuickConfigBodyProps): ReactNode {
  const gate = useRiskGate()
  const snapshot = useZoteroQuickConfig((s) => s)
  const ready = snapshot.status === 'ready'
  const webEnabled = snapshot.value?.webEnabled !== false
  const writeEnabled = snapshot.value?.writeEnabled === true

  const onToggleWrite = (next: boolean): void => {
    if (next && !writeEnabled) {
      gate.request()
      return
    }
    setField('writeEnabled', next)
  }

  return (
    <div className={css.quickConfig} data-zotero-quick-config>
      <div className={css.quickConfigHead}>
        <h4 className={css.quickConfigTitle}>{t('quickConfigTitle')}</h4>
        <p className={css.quickConfigDesc}>{t('quickConfigHint')}</p>
      </div>
      <div className={css.quickConfigList}>
        <div className={css.toggleRow}>
          <div className={css.toggleInfo}>
            <span className={css.toggleLabel}>{t('webEnabled')}</span>
            <span className={css.toggleHint}>{t('webEnabledHint')}</span>
          </div>
          <Switch
            checked={webEnabled}
            disabled={!ready}
            label={t('webEnabled')}
            onChange={(next) => {
              setField('webEnabled', next)
            }}
          />
        </div>
        <div className={css.toggleRow}>
          <div className={css.toggleInfo}>
            <span className={css.toggleLabel}>{t('writeEnabled')}</span>
            <span className={css.toggleHint}>{t('writeEnabledHint')}</span>
          </div>
          <Switch
            checked={writeEnabled}
            disabled={!ready}
            label={t('writeEnabled')}
            onChange={onToggleWrite}
          />
        </div>
      </div>
      <RiskConfirmation
        open={gate.confirming}
        {...writeRiskCopy(t)}
        acknowledged={gate.acknowledged}
        disabled={!ready}
        onAcknowledgedChange={gate.setAcknowledged}
        onCancel={gate.cancel}
        onConfirm={() => {
          gate.confirm(() => {
            setField('writeEnabled', true)
          })
        }}
      />
    </div>
  )
}
