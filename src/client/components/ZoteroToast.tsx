/**
 * Protocol-launch failure notice for every Zotero surface.
 *
 * The toast is the user-visible half of the face's `openProtocol`: the Host
 * owns platform dispatch, and a failure must reach the person who clicked,
 * not only the diagnostics ring. The shell overlay owns placement; this entry
 * only renders the current notice.
 * @module dsh-zotero/client/components/ZoteroToast
 */

import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroProtocolNotice, ZoteroSurfaceNotice } from '../actions/client-face.ts'

/** Props of the `shell.overlay` entry: the notice hook, its dismissal, and copy. */
export type ZoteroToastProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'zotero'> &
  InjectFace<{
    hooks: { readonly toast: HostObservable<ZoteroProtocolNotice | null> }
    readonly dismiss: () => void
  }>

/**
 * Render the current protocol-launch failure, or nothing.
 * @param props - the notice hook, its dismissal, and the locale seat.
 * @returns the warning banner while a notice is set.
 */
export function ZoteroToast({ useToast, dismiss, t }: ZoteroToastProps): ReactNode {
  const notice = useToast((current) => current)
  if (notice === null) return null
  return (
    <Toast
      key={`zotero-protocol-${String(notice.seq)}`}
      text={t('openInZoteroFailed')}
      icon={<IconWarningOutlineRegular />}
      onDone={dismiss}
    />
  )
}

/** Props of the panel-notice overlay entry: the notice hook and its dismissal. */
export type ZoteroSurfaceToastProps = PropsRuntime<'shell.overlay'> &
  InjectFace<{
    hooks: { readonly toast: HostObservable<ZoteroSurfaceNotice | null> }
    readonly dismiss: () => void
  }>

/**
 * Render the notice a panel raised, or nothing.
 *
 * The entry lives in the shell overlay rather than inside the panel so the
 * notice survives the panel: closing the parsed tab or the manager must not
 * drop the report of what it just did. The text arrives already worded by the
 * panel that raised it, in the reader's language.
 * @param props - the notice hook and its dismissal.
 * @returns the toast while a notice is set.
 */
export function ZoteroSurfaceToast({ useToast, dismiss }: ZoteroSurfaceToastProps): ReactNode {
  const notice = useToast((current) => current)
  if (notice === null) return null
  return (
    <Toast
      key={`zotero-surface-${String(notice.seq)}`}
      text={notice.text}
      tone={notice.tone}
      onDone={dismiss}
    />
  )
}
