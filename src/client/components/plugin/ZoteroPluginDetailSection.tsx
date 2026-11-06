/**
 * Custom section rendered at the bottom of the plugin manager detail page
 * (plugins.detail.section slot). Shows readiness status.
 * @module dsh-zotero/client/components/plugin/ZoteroPluginDetailSection
 */

import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZOTERO_REMOTE_PACKAGE } from '../../../contract.ts'
import { DiagnosisBox } from '../DiagnosisBox.tsx'
import { useZoteroProbe } from '../useZoteroProbe.ts'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { ZoteroSurfaceBoundary } from '../ZoteroSurfaceBoundary.tsx'
import type { ZoteroClientFace } from '../../actions/client-face.ts'
import type { ZoteroProbeFace } from './faces.ts'
import css from './plugin-cards.module.css'

export interface ZoteroPluginDetailSectionProps
  extends PluginDetailProps, PropsLocale<'zotero'>, ZoteroProbeFace {
  readonly useZoteroClient: () => ZoteroClientFace
}

type DetailSectionBodyProps = Pick<ZoteroPluginDetailSectionProps, 'probe'> & PropsLocale<'zotero'>

/**
 * Slot entry: subject guard only, so the body's hook count never varies with
 * which plugin the Plugins page is showing.
 */
export function ZoteroPluginDetailSection({
  subject,
  t,
  probe,
  useZoteroClient,
}: ZoteroPluginDetailSectionProps): ReactNode {
  const pkgName = subject.kind === 'bundle' || subject.kind === 'row' ? subject.pkg.name : undefined
  if (pkgName !== ZOTERO_REMOTE_PACKAGE) {
    return null
  }
  const client = useZoteroClient()
  return (
    <ZoteroSurfaceBoundary
      t={t}
      surface="detail"
      resetKey={pkgName}
      report={client.reportClientError}
    >
      <ZoteroPluginDetailSectionBody t={t} probe={probe} />
    </ZoteroSurfaceBoundary>
  )
}

function ZoteroPluginDetailSectionBody({ t, probe }: DetailSectionBodyProps): ReactNode {
  const { state, runProbe } = useZoteroProbe(probe, {
    initialAutoRun: true,
  })

  const connected = state.data?.connected ?? false
  const version = state.data?.zoteroVersion
  const diagnosis = state.error ?? state.data?.diagnosis

  return (
    <section className={css.section} data-zotero-plugin-section>
      <div className={css.sectionHead}>
        <h4 className={css.sectionTitle}>{t('detailSectionTitle')}</h4>
      </div>
      <div className={css.sectionGrid}>
        <div className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('detailsLabel')}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={state.loading}
              onClick={() => {
                void runProbe()
              }}
            >
              {state.loading ? t('checking') : t('refresh')}
            </Button>
          </div>
          <div className={css.statusRow} data-state={connected ? 'connected' : 'disconnected'}>
            <StateDot state={state.loading ? 'ongoing' : connected ? 'done' : 'error'} />
            <span>
              {state.loading
                ? t('checking')
                : connected
                  ? t('statusConnectedNote')
                  : t('statusUnavailable')}
            </span>
          </div>
          {version ? (
            <p className={css.statusDetail}>
              {t('zoteroVersionLabel')}: {version}
            </p>
          ) : null}
          {diagnosis ? <DiagnosisBox diagnosis={diagnosis} t={t} /> : null}
        </div>
      </div>
    </section>
  )
}
