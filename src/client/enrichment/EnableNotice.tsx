/**
 * Root-overlay disclosure for the moment the enrichment component is enabled.
 *
 * It explains what enabling permits and does not gate the component; every
 * parse still needs an explicit submission of one document.
 * @module dsh-zotero/client/enrichment/EnableNotice
 */

import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnrichmentEnableNoticeFace } from './enable-notice.ts'

export type EnrichmentEnableNoticeProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'zotero'> &
  InjectFace<EnrichmentEnableNoticeFace>

/**
 * Render the disclosure while the component's enable transition is open.
 * @param props - the notice hook, its dismissal, and the locale seat.
 * @returns the modal, or nothing after dismissal.
 */
export function EnrichmentEnableNotice({
  useEnrichmentEnableNotice,
  dismiss,
  t,
}: EnrichmentEnableNoticeProps): ReactNode {
  const open = useEnrichmentEnableNotice((state) => state.open)
  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={t('enrichmentEnableNoticeTitle')}
      description={t('enrichmentEnableNoticeDescription')}
      closeLabel={t('enrichmentEnableNoticeClose')}
      footer={
        <Button variant="primary" onClick={dismiss}>
          {t('enrichmentEnableNoticeConfirm')}
        </Button>
      }
    />
  )
}
