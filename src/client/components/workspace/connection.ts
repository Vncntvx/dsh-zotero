/**
 * The connection view: the pure-data shape of the status probe's outcome
 * that the workspace view renders. Loading, connected, unavailable (the
 * instance answered but reported no connection), and remote-error (the probe
 * itself failed); `checkedAt` is the absolute acquisition time. This is the
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
  | { readonly kind: 'no-access' }
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
  if (connection.kind === 'no-access') return t('remoteAccessDenied')
  if (connection.kind === 'remote-error') return diagnosisLine(connection.message, t)
  if (connection.kind === 'unavailable') {
    const diagnosis = connection.data.diagnosis
    // Absent (a view shape the wire never sends on a healthy probe) and empty
    // both mean "nothing explainable": the localized unknown keeps the line
    // total instead of rendering a bare fallback.
    return diagnosis ? diagnosisLine(diagnosis, t) : t('diagnosisUnknown')
  }
  return ''
}

/**
 * Whether the Sources tab may render its workspace, and the state line to
 * show instead when it may not. `undefined` means "render the workspace":
 * the composed projection value is present, or the status endpoint declares
 * the registry not composed so folding the loaded chat window is the valid
 * local answer. A failed registration is a hard stop naming its stable code;
 * a composed projection that has not delivered a value yet reports syncing;
 * anything the status endpoint itself could not answer reports why, so a
 * pending registration never silently degrades to the chat-window fold.
 * @param input - the probe's projection state, whether a projection value
 *   exists, and the status-channel access facts.
 * @returns the problem line to render, or undefined to render the workspace.
 */
export function projectionGateOf(input: {
  readonly projection: ZoteroStatusView['sourceProjection'] | undefined
  readonly hasProjected: boolean
  readonly canStatus: boolean
  readonly hasStatus: boolean
  readonly hasProbeError: boolean
  readonly t: TranslateNS<'zotero'>
}): string | undefined {
  const { projection, hasProjected, canStatus, hasStatus, hasProbeError, t } = input
  if (projection?.state === 'failed') {
    return `${t('sourceProjectionFailed')} (${projection.code})`
  }
  if (hasProjected || projection?.state === 'not-composed') return undefined
  if (!canStatus || !hasStatus || hasProbeError) {
    return t('sourceProjectionStatusUnavailable')
  }
  if (projection?.state === 'ready') return t('sourceProjectionSyncing')
  return t('sourceProjectionLoading')
}
