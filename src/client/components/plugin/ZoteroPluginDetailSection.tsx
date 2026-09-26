/**
 * Custom section rendered at the bottom of the plugin manager detail page
 * (plugins.detail.section slot). Shows readiness status and quick usage tips.
 * @module dsh-zotero/client/components/plugin/ZoteroPluginDetailSection
 */

import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../../remote.ts'
import { DiagnosisBox } from '../DiagnosisBox.tsx'
import { useZoteroProbe } from '../useZoteroProbe.ts'
import type { PluginDetailProps } from './types.ts'
import css from './plugin-cards.module.css'

export interface ZoteroPluginDetailSectionProps extends PluginDetailProps {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

interface DetailSectionBodyProps {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * Slot entry: subject guard only, so the body's hook count never varies with
 * which plugin the Plugins page is showing.
 */
export function ZoteroPluginDetailSection({
  subject,
  t,
  probe,
}: ZoteroPluginDetailSectionProps): ReactNode {
  if (subject.kind !== 'bundle' || subject.pkg.name !== 'dsh-zotero') {
    return null
  }
  return <ZoteroPluginDetailSectionBody t={t} probe={probe} />
}

function ZoteroPluginDetailSectionBody({ t, probe }: DetailSectionBodyProps): ReactNode {
  const { state, runProbe } = useZoteroProbe(probe, {
    initialAutoRun: true,
  })

  const connected = state.data?.connected ?? false
  const version = state.data?.zoteroVersion
  const diagnosis = state.error ?? state.data?.diagnosis

  const tips = ['tipNoKey', 'tipFulltext', 'tipSettingsNav'] as const

  return (
    <section className={css.section} data-zotero-plugin-section>
      <div className={css.sectionHead}>
        <h4 className={css.sectionTitle}>{t('detailSectionTitle')}</h4>
      </div>
      <div className={css.sectionGrid}>
        <div className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('detailsLabel')}</span>
            <button
              type="button"
              className={css.refreshButton}
              disabled={state.loading}
              onClick={() => {
                void runProbe()
              }}
            >
              {state.loading ? t('checking') : t('refresh')}
            </button>
          </div>
          <div className={css.statusRow} data-state={connected ? 'connected' : 'disconnected'}>
            <span>
              {state.loading
                ? `● ${t('checking')}`
                : connected
                  ? `● ${t('statusConnectedNote')}`
                  : `○ ${t('statusUnavailable')}`}
            </span>
          </div>
          {version ? (
            <p className={css.statusDetail}>
              {t('zoteroVersionLabel')}: {version}
            </p>
          ) : null}
          {diagnosis ? <DiagnosisBox diagnosis={diagnosis} t={t} /> : null}
        </div>

        <div className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('tipsLabel')}</span>
          </div>
          <ul className={css.tipList}>
            {tips.map((key) => (
              <li key={key} className={css.tipItem}>
                <span className={css.tipBullet}>💡</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
