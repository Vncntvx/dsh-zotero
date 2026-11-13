/**
 * Root-overlay disclosure for the scholarly component's current enable.
 *
 * It appears while the component is served and this client has not acknowledged
 * the current enable. It explains what enabling permits and does not gate the
 * component; every external request still waits for the agent to call one of
 * its tools, which only exist while the component is mounted.
 * @module dsh-zotero/client/scholarly/EnableNotice
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EnableNoticeModal } from '../components/EnableNoticeModal.tsx'
import type { EnableNoticeFace } from '../enable-notice.ts'

/** The hook name the scholarly entry publishes its snapshot under. */
export type ScholarlyEnableNoticeFace = EnableNoticeFace<'scholarlyEnableNotice'>

export type ScholarlyEnableNoticeProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'zotero'> &
  InjectFace<ScholarlyEnableNoticeFace>

/**
 * Render the disclosure while this client has not acknowledged it.
 * @param props - the notice hook, its dismissal, and the locale seat.
 * @returns the modal, or nothing after dismissal.
 */
export function ScholarlyEnableNotice({
  useScholarlyEnableNotice,
  dismiss,
  t,
}: ScholarlyEnableNoticeProps): ReactNode {
  const open = useScholarlyEnableNotice((state) => state.open)
  return (
    <EnableNoticeModal
      open={open}
      title={t('scholarlyEnableNoticeTitle')}
      description={t('scholarlyEnableNoticeDescription')}
      confirmLabel={t('scholarlyEnableNoticeConfirm')}
      closeLabel={t('scholarlyEnableNoticeClose')}
      onDismiss={dismiss}
    />
  )
}
