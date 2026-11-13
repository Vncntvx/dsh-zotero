/**
 * Root-overlay disclosure for the enrichment component's current enable.
 *
 * It appears while the component is served and this client has not acknowledged
 * the current enable. It explains what enabling permits and does not gate the
 * component; every parse still needs an explicit submission of one document.
 * @module dsh-zotero/client/enrichment/EnableNotice
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EnableNoticeModal } from '../components/EnableNoticeModal.tsx'
import type { EnableNoticeFace } from '../enable-notice.ts'

/** The hook name the enrichment entry publishes its snapshot under. */
export type EnrichmentEnableNoticeFace = EnableNoticeFace<'enrichmentEnableNotice'>

export type EnrichmentEnableNoticeProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'zotero'> &
  InjectFace<EnrichmentEnableNoticeFace>

/**
 * Render the disclosure while this client has not acknowledged it.
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
    <EnableNoticeModal
      open={open}
      title={t('enrichmentEnableNoticeTitle')}
      description={t('enrichmentEnableNoticeDescription')}
      confirmLabel={t('enrichmentEnableNoticeConfirm')}
      closeLabel={t('enrichmentEnableNoticeClose')}
      onDismiss={dismiss}
    />
  )
}
