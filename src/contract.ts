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
 * Gateway returns `RemoteResult.value` unvalidated: result codecs are host
 * registry/wire identity, not a second browser-side validator.
 *
 * The Remote namespace carries the one fact the settings plane does not: live
 * connectivity of the configured Zotero provider. Configuration rides the
 * shared configuration form (`ctx.configForms`), not this channel.
 * @module dsh-zotero/contract
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'

/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE }

/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
  readonly providerId: string
  /**
   * The authority the probe dialled, e.g. `127.0.0.1:23119`. Optional on the
   * wire view only because one answer has no endpoint to report: a service that
   * is not composed at all dialled nothing. Every answer that reached a
   * provider carries one, on the connected and the disconnected arm alike.
   */
  readonly endpoint?: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  /** The answering Zotero build (`X-Zotero-Version`); the only version fact that names a release. */
  readonly zoteroVersion?: string
  /** The write state; absent when the serving provider wires no write capability. */
  readonly write?: { readonly enabled: boolean; readonly authorized: boolean }
  /**
   * What the probe wants explained, localized by the client. Present only when
   * there is something to explain: a connected probe carries none. The
   * host-internal status keeps a total field with the {@link ZOTERO_DIAGNOSIS_OK}
   * sentinel; the wire producer strips it so a success never renders a
   * diagnosis box.
   */
  readonly diagnosis?: string
}

/** The attachment location view returned by the resolveAttachment Remote invocation. */
export interface ZoteroAttachmentLocationView {
  readonly ref: string
  readonly kind: 'file' | 'url'
  readonly title: string
  readonly contentType: string
  readonly path?: string
  readonly url?: string
}

/** Package identity every Typert contribution from this plugin claims. */
export const ZOTERO_REMOTE_PACKAGE = 'dsh-zotero'

/**
 * Success sentinel the host status probe writes into its total `diagnosis`
 * field (`src/local/provider.ts`). The wire view strips it — a connected probe
 * has nothing to diagnose — so this constant is the single spelling both the
 * writer and the stripper compare against.
 */
export const ZOTERO_DIAGNOSIS_OK = 'ok'

/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export const ZOTERO_STATUS_TYPE_SYMBOL = 'dsh-zotero#ZoteroStatusView'

/** Strict codec type symbol for the string ref parameter. */
export const ZOTERO_REF_PARAM_TYPE_SYMBOL = 'dsh-zotero#AttachmentRef'

/** Strict codec type symbol for {@link ZoteroAttachmentLocationView}. */
export const ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL = 'dsh-zotero#ZoteroAttachmentLocationView'

/** Globally stable invocation id for the status probe. */
export const ZOTERO_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/status'

/** Globally stable invocation id for resolveAttachment. */
export const ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID = 'dsh-zotero#zotero/resolveAttachment'

/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here, never as a second literal.
 */
export const ZOTERO_STATUS_SERVICE_KEY = 'zoteroRemote'

/** Wire method name for the status probe. */
export const ZOTERO_STATUS_METHOD = 'status'

/** Wire method name for resolveAttachment. */
export const ZOTERO_RESOLVE_ATTACHMENT_METHOD = 'resolveAttachment'

/** Invocation kind for direct service calls (no Context receiver). */
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
 * differs by side. Every structural field is copied, so callers never share a
 * mutable reference with {@link ZOTERO_STATUS_ENDPOINT}.
 * @param result - the strict result codec for {@link ZoteroStatusView}.
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

/**
 * Build one resolveAttachment invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the ref string.
 * @param result - the strict result codec for {@link ZoteroAttachmentLocationView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroResolveAttachmentInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    parameters: [
      {
        name: 'ref',
        wire: 'ref',
        source: 'json',
        codec: param,
      },
    ],
    result,
  }
}

/** The status header when the local API answered the probe. */
export const ZOTERO_STATUS_CONNECTED = 'Zotero local API: connected'

/** The status header when Zotero could not be reached at all. */
export const ZOTERO_STATUS_DISCONNECTED = 'Zotero local API: not connected'

/** The value a status line reports when the answering build named none. */
export const ZOTERO_STATUS_NOT_REPORTED = 'not reported'

/**
 * The Server-ID line for a build that does not identify its database. Refs and
 * cursors pin to that identity, so its absence is a fact about what this
 * Zotero can support rather than a missing detail.
 */
export const ZOTERO_STATUS_SERVER_ID_UNREPORTED =
  'Server ID: not reported — this build does not identify its database, so refs and cursors cannot be pinned to it'

/** Status line field labels shared between host formatting and client parsing. */
export const ZOTERO_STATUS_FIELD_VERSION = 'Zotero version'
export const ZOTERO_STATUS_FIELD_API = 'API version'
export const ZOTERO_STATUS_FIELD_SCHEMA = 'Schema version'
export const ZOTERO_STATUS_FIELD_SERVER_ID = 'Server ID'
export const ZOTERO_STATUS_FIELD_WRITE = 'Write'
/** The dialled authority, reported on both the connected and the failed probe. */
export const ZOTERO_STATUS_FIELD_ENDPOINT = 'Local API'

/** Canonical status values for the Write field. */
export const ZOTERO_STATUS_WRITE_DISABLED = 'disabled'
export const ZOTERO_STATUS_WRITE_ENABLED_STORED = 'enabled (key stored)'
export const ZOTERO_STATUS_WRITE_ENABLED_PENDING = 'enabled (no key yet)'
