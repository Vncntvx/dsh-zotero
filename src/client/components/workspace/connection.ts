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
import { diagnosisLine } from '../plugin/diagnosis.ts'
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
  // Both failure kinds route through diagnosisLine, so a raw English probe
  // string never renders bare inside the zh interface: known codes become
  // localized sentences, and the label prefix stays registrant-localized.
  if (connection.kind === 'remote-error') return diagnosisLine(connection.message, t)
  if (connection.kind === 'unavailable') {
    const diagnosis = connection.data.diagnosis
    return diagnosis === '' ? t('diagnosisUnknown') : diagnosisLine(diagnosis, t)
  }
  return ''
}
