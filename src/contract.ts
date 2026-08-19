/**
 * The zotero wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in typert.ts) and the client contribution
 * (`ctx.remote.$mount` in client/remote.ts).
 *
 * The Remote namespace carries the one fact the settings plane does not: live
 * connectivity of the configured Zotero provider, which the dedicated web tab
 * renders as its status strip. The configuration surface no longer rides this
 * channel — the browser half reads and writes the `zotero` settings namespace
 * through the harness's own settings scope (`ctx.settingsScope`), which rc.7
 * serves for every registered namespace — so the namespace view, patch, and
 * field-clearing endpoints are gone.
 * @module dsh-zotero/contract
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'

/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
  readonly providerId: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  readonly diagnosis: string
}

/** Wire codec: one status view (strict; absent optional facts stay absent). */
const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    diagnosis: z.string(),
  })
  .readonly()

/** The zotero Remote namespace's strict invocation descriptors. */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-zotero#zotero/status',
    service: 'zoteroRemote',
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroStatusView',
      schema: zoteroStatusSchema,
    },
  },
]
