/**
 * The `/zotero` status snapshot as a durable session fact.
 *
 * A command handler answers with text, so structured status travels through
 * {@link CommandResult.sourceEventSeq}: the handler appends the domain event
 * defined here, and the client reads the value through a session projection
 * (`docs/subsystems/commands.md`).
 *
 * The event carries the same {@link ZoteroStatusView} the Remote `status`
 * endpoint serves, produced by the same projection function, so the live probe
 * and the logged snapshot agree on every field.
 * @module dsh-zotero/session-events
 */

import type { ZoteroStatusView } from './contract.js'
import { ZOTERO_DIAGNOSIS_OK } from './contract.js'
import type { ZoteroStatus } from './types.js'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One `/zotero` connectivity snapshot. The version tag lets a later
     * projection bump `stateVersion` without an older log being misread.
     */
    'zotero/status': { readonly version: 1; readonly status: ZoteroStatusView }
  }
}

/**
 * Fold a host-internal status record into the wire view.
 *
 * Absent optional facts stay absent: the strict codec rejects undefined keys,
 * and a connected probe carries no diagnosis. The success sentinel is stripped
 * for the same reason the Remote endpoint strips it: it marks "nothing to
 * explain" internally and must never reach a renderer.
 * @param status - the provider's own status record.
 * @returns the view shared by the Remote endpoint and the logged event.
 */
export function toStatusView(status: ZoteroStatus): ZoteroStatusView {
  return {
    providerId: status.providerId,
    ...(status.endpoint === undefined ? {} : { endpoint: status.endpoint }),
    connected: status.connected,
    ...(status.apiVersion === undefined ? {} : { apiVersion: status.apiVersion }),
    ...(status.serverId === undefined ? {} : { serverId: status.serverId }),
    ...(status.schemaVersion === undefined ? {} : { schemaVersion: status.schemaVersion }),
    ...(status.zoteroVersion === undefined ? {} : { zoteroVersion: status.zoteroVersion }),
    ...(status.write === undefined ? {} : { write: status.write }),
    ...(status.diagnosis === undefined || status.diagnosis === ZOTERO_DIAGNOSIS_OK
      ? {}
      : { diagnosis: status.diagnosis }),
  }
}
