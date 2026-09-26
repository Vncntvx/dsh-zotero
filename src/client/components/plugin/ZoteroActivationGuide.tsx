/**
 * Guidance modal rendered when enabling dsh-zotero (plugins.bundle.activation slot).
 * Directs users to enable Zotero's local API in Advanced Preferences to prevent 403 errors,
 * with live connectivity self-check and direct navigation into the details page.
 * @module dsh-zotero/client/components/plugin/ZoteroActivationGuide
 */

import type { ReactNode } from 'react'
import { Button, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ZOTERO_REMOTE_PACKAGE, type ZoteroStatusView } from '../../../contract.ts'
import { DiagnosisBox } from '../DiagnosisBox.tsx'
import { useZoteroProbe } from '../useZoteroProbe.ts'
import type { PluginActivationOwnerProps } from './types.ts'
import css from './plugin-cards.module.css'

export interface ZoteroActivationGuideProps extends PluginActivationOwnerProps {
  readonly t?: TranslateNS<'zotero'>
  readonly probe?: () => Promise<RemoteResult<ZoteroStatusView>>
}

interface ZoteroActivationGuideBodyProps {
  readonly onDismiss: () => void
  readonly onOpenDetails: () => void
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * Slot entry: packageName and dependencies guard so hook count never varies.
 */
export function ZoteroActivationGuide({
  packageName,
  onDismiss,
  onOpenDetails,
  t,
  probe,
}: ZoteroActivationGuideProps): ReactNode {
  if (packageName !== ZOTERO_REMOTE_PACKAGE || !t || !probe) return null
  return (
    <ZoteroActivationGuideBody
      onDismiss={onDismiss}
      onOpenDetails={onOpenDetails}
      t={t}
      probe={probe}
    />
  )
}

function ZoteroActivationGuideBody({
  onDismiss,
  onOpenDetails,
  t,
  probe,
}: ZoteroActivationGuideBodyProps): ReactNode {
  const { state, runProbe } = useZoteroProbe(probe, { initialAutoRun: true })

  const connected = state.data?.connected === true
  const version = state.data?.zoteroVersion
  const diagnosis = state.error

  const statusState = state.loading ? 'ongoing' : connected ? 'done' : 'error'
  const statusText = state.loading
    ? t('checking')
    : connected
      ? version
        ? t('activationReadyVersion', { version })
        : t('activationReady')
      : t('statusUnavailable')

  return (
    <Modal
      open={true}
      className={css.activationModal}
      title={t('activationTitle')}
      description={t('activationDescription')}
      closeLabel={t('activationClose')}
      onClose={onDismiss}
      footer={
        <div className={css.activationFooter}>
          <Button
            variant="outline"
            size="sm"
            disabled={state.loading}
            onClick={() => {
              void runProbe()
            }}
          >
            {t('activationCheckAgain')}
          </Button>
          <div className={css.activationFooterActions}>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {connected ? t('activationDone') : t('activationLater')}
            </Button>
            <Button variant="primary" size="sm" onClick={onOpenDetails} data-modal-autofocus>
              {t('activationDetails')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={css.activationContent} data-zotero-activation-guide>
        <ol className={css.activationSteps}>
          <li className={css.activationStep}>
            <span className={css.activationStepIndex}>1</span>
            <div className={css.activationStepBody}>
              <span className={css.activationStepText}>{t('activationStep1')}</span>
            </div>
          </li>
          <li className={css.activationStep}>
            <span className={css.activationStepIndex}>2</span>
            <div className={css.activationStepBody}>
              <span className={css.activationStepText}>{t('activationStep2')}</span>
              <p className={css.activationStepNote}>{t('activationStep2Note')}</p>
            </div>
          </li>
        </ol>

        <div className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('activationStatusLabel')}</span>
          </div>
          <div className={css.statusRow} data-state={connected ? 'connected' : 'disconnected'}>
            <StateDot state={statusState} />
            <span>{statusText}</span>
          </div>
          {diagnosis !== undefined ? <DiagnosisBox diagnosis={diagnosis} t={t} /> : null}
        </div>
      </div>
    </Modal>
  )
}
