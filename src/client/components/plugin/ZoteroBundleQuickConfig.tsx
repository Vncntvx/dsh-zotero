/**
 * Quick toggles for core Zotero plugin settings rendered in the Plugins manager
 * detail page (plugins.bundle.config slot). Enabling writes is gated behind the
 * shared risk acknowledgement so the sensitive flip cannot land by accident.
 * @module dsh-zotero/client/components/plugin/ZoteroBundleQuickConfig
 */

import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { RiskConfirmation, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useRiskGate, writeRiskCopy } from '../../risk-gate.ts'
import css from './plugin-cards.module.css'

export interface ZoteroBundleQuickConfigProps {
  readonly view?: 'summary' | 'page'
  readonly form?: ConfigForm<Record<string, unknown>>
  readonly t?: TranslateNS<'zotero'>
}

/** Required face once the slot has supplied form and translator. */
interface QuickConfigBodyProps {
  readonly form: ConfigForm<Record<string, unknown>>
  readonly t: TranslateNS<'zotero'>
}

/**
 * Slot entry: keep the early-out in a hook-free shell so the body's hook
 * count never varies with props.
 */
export function ZoteroBundleQuickConfig({
  view,
  form,
  t,
}: ZoteroBundleQuickConfigProps): ReactNode {
  if (view && view !== 'page') return null
  if (!form || !t) return null
  return <ZoteroBundleQuickConfigBody form={form} t={t} />
}

function ZoteroBundleQuickConfigBody({ form, t }: QuickConfigBodyProps): ReactNode {
  const gate = useRiskGate()
  const subscribe = useCallback(
    (onStoreChange: () => void) => form.subscribe(onStoreChange),
    [form],
  )
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const ready = snapshot.status === 'ready'
  const webEnabled = snapshot.value?.webEnabled !== false
  const writeEnabled = snapshot.value?.writeEnabled === true

  const setField = (path: 'webEnabled' | 'writeEnabled', value: boolean): void => {
    const current = form.getSnapshot()
    form.mutate([{ op: 'set', path: [path], value }], current.revision)
  }

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
