/**
 * The connection view: the pure-data shape of the status probe's outcome
 * that the workspace view renders. Loading, connected, unavailable (the
 * instance answered but reported no connection), and remote-error (the probe
 * itself failed) — `checkedAt` is the absolute acquisition time. This is the
 * boundary between the controller (probe, session reads) and the view
 * (fixture-renderable presentation).
 * @module dsh-zotero/client/components/workspace/connection
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../../remote.ts'

/** The connection view the workspace renders; fixture-constructible. */
export type ConnectionView =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'connected'
      readonly data: ZoteroStatusView
      readonly checkedAt: string
    }
  | {
      readonly kind: 'unavailable'
      readonly data: ZoteroStatusView
      readonly checkedAt: string
    }
  | { readonly kind: 'remote-error'; readonly message: string }

/** The failure diagnosis line of one non-connected connection view. */
export function connectionDiagnosisOf(
  connection: ConnectionView,
  t: TranslateNS<'zotero'>,
): string {
  if (connection.kind === 'remote-error') return connection.message
  if (connection.kind === 'unavailable') {
    const diagnosis = connection.data.diagnosis
    return diagnosis === '' ? t('statusUnavailable') : `${t('diagnosisLabel')}: ${diagnosis}`
  }
  return ''
}
