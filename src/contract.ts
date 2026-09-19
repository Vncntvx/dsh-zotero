/**
 * The zotero wire contract's shared structural surface: types, wire identity,
 * and the invocation factory both halves use. This module is dependency-free
 * so the browser bundle can inline it without dragging host-only schema
 * materialization (zod) into the client graph.
 *
 * Boundary codecs are **not** defined here. Host registration materializes
 * strict zod schemas in `src/status-codec.ts`; the client Remote face mounts
 * the same structural endpoint with a host-owned codec factory that never
 * materializes in the browser (see `src/client/status-codec.ts`). Client
 * Gateway returns `RemoteResult.value` unvalidated — result codecs are host
 * registry/wire identity, not a second browser-side validator.
 *
 * The Remote namespace carries the one fact the settings plane does not: live
 * connectivity of the configured Zotero provider. Configuration rides
 * `ctx.settingsScope`, not this channel.
 * @module dsh-zotero/contract
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'

/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE }

/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
  readonly providerId: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  /** The answering Zotero build (`X-Zotero-Version`); the only version fact that names a release. */
  readonly zoteroVersion?: string
  /** The write state; absent when the serving provider wires no write capability. */
  readonly write?: { readonly enabled: boolean; readonly authorized: boolean }
  readonly diagnosis: string
}

/** Package identity every Typert contribution from this plugin claims. */
export const ZOTERO_REMOTE_PACKAGE = 'dsh-zotero'

/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export const ZOTERO_STATUS_TYPE_SYMBOL = 'dsh-zotero#ZoteroStatusView'

/** Globally stable invocation id for the status probe. */
export const ZOTERO_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/status'

/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here — never a second literal.
 */
export const ZOTERO_STATUS_SERVICE_KEY = 'zoteroRemote'

/** Wire method name for the status probe. */
export const ZOTERO_STATUS_METHOD = 'status'

/** Invocation kind for the status probe (direct service call, no Context receiver). */
export const ZOTERO_STATUS_INVOCATION_KIND = 'direct'

/**
 * Structural identity of the `zotero/status` invocation. The only field both
 * halves fill differently is `result` (host owns the zod factory; client
 * mounts a host-owned non-materializing factory). Read-only reference for
 * tests and documentation; descriptors are built through
 * {@link zoteroStatusInvocation}, which copies every field.
 */
export const ZOTERO_STATUS_ENDPOINT = {
  id: ZOTERO_STATUS_INVOCATION_ID,
  service: ZOTERO_STATUS_SERVICE_KEY,
  namespace: ZOTERO_SETTINGS_NAMESPACE,
  method: ZOTERO_STATUS_METHOD,
  invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
  parameters: [],
} as const satisfies Pick<
  InvocationDescriptor,
  'id' | 'service' | 'namespace' | 'method' | 'invocation' | 'parameters'
>

/**
 * Build one status invocation descriptor around a result codec. Host and
 * client both call this so endpoint identity cannot drift; only the codec arm
 * differs by side. Every structural field is copied — callers never share a
 * mutable reference with {@link ZOTERO_STATUS_ENDPOINT}.
 * @param result - the strict (or dual-arm) result codec for {@link ZoteroStatusView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroStatusInvocation(
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_STATUS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_STATUS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    parameters: [],
    result,
  }
}
