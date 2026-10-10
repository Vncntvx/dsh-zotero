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
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js';
/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE };
/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
    readonly providerId: string;
    /**
     * The authority the probe dialled, e.g. `127.0.0.1:23119`. Optional on the
     * wire view only because one answer has no endpoint to report: a service that
     * is not composed at all dialled nothing. Every answer that reached a
     * provider carries one, on the connected and the disconnected arm alike.
     */
    readonly endpoint?: string;
    readonly connected: boolean;
    readonly apiVersion?: string;
    readonly serverId?: string;
    readonly schemaVersion?: string;
    /** The answering Zotero build (`X-Zotero-Version`); the only version fact that names a release. */
    readonly zoteroVersion?: string;
    /** The write state; absent when the serving provider wires no write capability. */
    readonly write?: {
        readonly enabled: boolean;
        readonly authorized: boolean;
    };
    readonly diagnosis: string;
}
/** Package identity every Typert contribution from this plugin claims. */
export declare const ZOTERO_REMOTE_PACKAGE = "dsh-zotero";
/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export declare const ZOTERO_STATUS_TYPE_SYMBOL = "dsh-zotero#ZoteroStatusView";
/** Globally stable invocation id for the status probe. */
export declare const ZOTERO_STATUS_INVOCATION_ID = "dsh-zotero#zotero/status";
/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here, never as a second literal.
 */
export declare const ZOTERO_STATUS_SERVICE_KEY = "zoteroRemote";
/** Wire method name for the status probe. */
export declare const ZOTERO_STATUS_METHOD = "status";
/** Invocation kind for the status probe (direct service call, no Context receiver). */
export declare const ZOTERO_STATUS_INVOCATION_KIND = "direct";
/**
 * Structural identity of the `zotero/status` invocation. The only field both
 * halves fill differently is `result` (host owns the zod factory; client
 * mounts a host-owned non-materializing factory). Read-only reference for
 * tests and documentation; descriptors are built through
 * {@link zoteroStatusInvocation}, which copies every field.
 */
export declare const ZOTERO_STATUS_ENDPOINT: {
    readonly id: "dsh-zotero#zotero/status";
    readonly service: "zoteroRemote";
    readonly namespace: "zotero";
    readonly method: "status";
    readonly invocation: {
        readonly kind: "direct";
    };
    readonly parameters: readonly [];
};
/**
 * Build one status invocation descriptor around a result codec. Host and
 * client both call this so endpoint identity cannot drift; only the codec arm
 * differs by side. Every structural field is copied, so callers never share a
 * mutable reference with {@link ZOTERO_STATUS_ENDPOINT}.
 * @param result - the strict result codec for {@link ZoteroStatusView}.
 * @returns a complete invocation descriptor.
 */
export declare function zoteroStatusInvocation(result: InvocationDescriptor['result']): InvocationDescriptor;
/** The status header when the local API answered the probe. */
export declare const ZOTERO_STATUS_CONNECTED = "Zotero local API: connected";
/** The status header when Zotero could not be reached at all. */
export declare const ZOTERO_STATUS_DISCONNECTED = "Zotero local API: not connected";
/** The value a status line reports when the answering build named none. */
export declare const ZOTERO_STATUS_NOT_REPORTED = "not reported";
/**
 * The Server-ID line for a build that does not identify its database. Refs and
 * cursors pin to that identity, so its absence is a fact about what this
 * Zotero can support rather than a missing detail.
 */
export declare const ZOTERO_STATUS_SERVER_ID_UNREPORTED = "Server ID: not reported \u2014 this build does not identify its database, so refs and cursors cannot be pinned to it";
/** Status line field labels shared between host formatting and client parsing. */
export declare const ZOTERO_STATUS_FIELD_VERSION = "Zotero version";
export declare const ZOTERO_STATUS_FIELD_API = "API version";
export declare const ZOTERO_STATUS_FIELD_SCHEMA = "Schema version";
export declare const ZOTERO_STATUS_FIELD_SERVER_ID = "Server ID";
export declare const ZOTERO_STATUS_FIELD_WRITE = "Write";
/** The dialled authority, reported on both the connected and the failed probe. */
export declare const ZOTERO_STATUS_FIELD_ENDPOINT = "Local API";
/** Canonical status values for the Write field. */
export declare const ZOTERO_STATUS_WRITE_DISABLED = "disabled";
export declare const ZOTERO_STATUS_WRITE_ENABLED_STORED = "enabled (key stored)";
export declare const ZOTERO_STATUS_WRITE_ENABLED_PENDING = "enabled (no key yet)";
//# sourceMappingURL=contract.d.ts.map