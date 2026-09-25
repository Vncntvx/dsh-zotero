/**
 * Custom section rendered at the bottom of the plugin manager detail page
 * (plugins.detail.section slot). Shows readiness status and quick usage tips.
 * @module dsh-zotero/client/components/plugin/ZoteroPluginDetailSection
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../../remote.ts'
import { formatDiagnosis } from './diagnosis.ts'
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

interface ProbeSummary {
  readonly loading: boolean
  readonly connected?: boolean
  readonly version?: string
  readonly diagnosis?: string
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
  const [state, setState] = useState<ProbeSummary>({ loading: true })
  // Monotonic token: only the latest probe may write, so a slow refresh
  // cannot overwrite a newer one.
  const probeSeq = useRef(0)

  const runProbe = useCallback(async (): Promise<void> => {
    const seq = ++probeSeq.current
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const res = await probe()
      if (seq !== probeSeq.current) return
      if (res.ok && res.value.connected) {
        setState({
          loading: false,
          connected: true,
          version: res.value.zoteroVersion,
        })
      } else {
        setState({
          loading: false,
          connected: false,
          diagnosis: res.ok ? res.value.diagnosis : res.error.message,
        })
      }
    } catch (err) {
      if (seq !== probeSeq.current) return
      setState({
        loading: false,
        connected: false,
        diagnosis: err instanceof Error ? err.message : String(err),
      })
    }
  }, [probe])

  useEffect(() => {
    void runProbe()
  }, [runProbe])

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
          <div
            className={css.statusRow}
            data-state={state.connected ? 'connected' : 'disconnected'}
          >
            <span>
              {state.loading
                ? `● ${t('checking')}`
                : state.connected
                  ? `● ${t('statusConnectedNote')}`
                  : `○ ${t('statusUnavailable')}`}
            </span>
          </div>
          {state.version ? (
            <p className={css.statusDetail}>
              {t('zoteroVersionLabel')}: {state.version}
            </p>
          ) : null}
          {state.diagnosis ? <DiagnosisBox diagnosis={state.diagnosis} t={t} /> : null}
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

function DiagnosisBox({
  diagnosis,
  t,
}: {
  readonly diagnosis: string
  readonly t: TranslateNS<'zotero'>
}): ReactNode {
  const formatted = formatDiagnosis(diagnosis, t)
  return (
    <div className={css.diagnosisBox}>
      <div className={css.diagnosisHead}>
        <span className={css.diagnosisLabelText}>{t('diagnosisLabel')}:</span>
        {formatted.rawCode ? <code className={css.diagnosisCode}>{formatted.rawCode}</code> : null}
      </div>
      <p className={css.diagnosisMessage}>{formatted.message}</p>
    </div>
  )
}
