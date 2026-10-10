/**
 * The write-authorization state of the plugin. Zotero 10 issues local write
 * keys through its own `/api/local/authorize` dialog (Allow for one write,
 * Always Allow for a persistent grant, or Deny) and consumes single-use keys
 * at authentication time, before the write runs. This module owns what that
 * implies for the plugin:
 *
 * - the persisted grant lives in the host credentials seam as a `grant`
 *   record bound to the Zotero instance id it was granted by; a record that
 *   names another instance is stale and is tombstoned, never used;
 * - a one-time key lives only in this process's memory and is forgotten as
 *   soon as the write it authorized settles, because the server has consumed
 *   it either way;
 * - concurrent callers share one in-flight authorization. The dialog is the
 *   scarcest resource in the loop, and Zotero rate-limits the endpoint at
 *   five requests per minute.
 *
 * There is no key material in the plugin config and no key caching past the
 * semantics above: the credentials seam is re-read per operation by its own
 * discipline, and the memory slot only bridges the one-write lifetime of a
 * single-use grant. A rejected persisted key is tombstoned by identity; a
 * persistence failure propagates and leaves the grant pending for retry.
 *
 * Verified against Zotero 10.0.3-beta.3 (`server_localAPI.js`): the dialog's
 * three buttons are Allow (`remember: false`), Always Allow
 * (`remember: true`), and Deny, with Deny as the default button, and the
 * endpoint is rate-limited to five prompts per minute. A single-use key is
 * deleted inside the authentication check itself, before the request body is
 * judged, so a refused write still burns it. A remembered key is never
 * consumed: it lives in `<Zotero profile>/localAPIKeys.json` and authenticates
 * indefinitely until the user discards the stored authorizations. That is why
 * a persisted grant is treated here as a durable secret, and why the plugin
 * never handles a raw key itself.
 * @module dsh-zotero/write-auth
 */
import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { ZoteroWriteHttpClient } from './write-http.js';
/**
 * The name Zotero's authorization dialog shows the user for this plugin.
 * A stable, recognizable name: the user decides on it, not on a request.
 */
export declare const WRITE_APP_NAME = "dsh (Zotero plugin)";
/**
 * The credentials record that carries this plugin's persistent write grant,
 * keyed under the plugin's own registered scope.
 */
export declare const WRITE_KEY_RECORD: import("@deepseek-ai/dsh-credentials").CredentialKey;
/** The grant payload this plugin stores; opaque to the credentials seam. */
export interface ZoteroWriteGrantPayload {
    /** The local API key Zotero issued. */
    readonly key: string;
    /** The Zotero instance id the dialog that granted the key was served by. */
    readonly serverId: string;
    /** The app name shown in the granting dialog, kept for the audit trail. */
    readonly appName: string;
    /** When the dialog granted the key (ISO 8601). */
    readonly authorizedAt: string;
}
export interface WriteAuthorizerDeps {
    /** The write transport; the authorize call rides it. */
    readonly client: ZoteroWriteHttpClient;
    /** The host credentials seam; absent compositions keep grants in memory only. */
    readonly credentials?: CredentialProvider | (() => CredentialProvider | undefined);
    /**
     * Live read of the persist-grant setting. A live read, not a captured
     * boolean: a settings commit applies to the next authorization without a
     * rebuild.
     */
    readonly persistKey: () => boolean;
}
/** One key for one write lifecycle: usable now, and either reusable or spent. */
export interface ZoteroWriteKey {
    readonly key: string;
    /** True when Zotero will consume the key at authentication time. */
    readonly oneTime: boolean;
}
export interface ParsedGrant {
    readonly key: string;
    readonly boundTo: string;
    readonly appName?: string;
    readonly authorizedAt?: string;
}
/**
 * Resolve and maintain the plugin's write authorization for the connected
 * Zotero instance. `keyFor` is the entry point the write domain calls before
 * every batch: it answers with the persisted grant while it is bound to the
 * connected instance, else with this process's own grant, else it runs the
 * authorize dialog and answers with what the user granted.
 */
export declare class WriteAuthorizer {
    private readonly deps;
    private memory;
    private readonly authorizing;
    private readonly persisting;
    constructor(deps: WriteAuthorizerDeps);
    private getCredentials;
    /**
     * The key to write with for this Zotero instance.
     * @param serverId - the instance id the plugin last read from; grants are
     *   bound to it, so a write follows the instance the reads saw.
     * @param signal - caller cancellation, forwarded to the authorize request.
     * @returns the key plus whether Zotero will consume it on first use.
     */
    keyFor(serverId: string, signal?: AbortSignal): Promise<ZoteroWriteKey>;
    /** Start or reuse the single authorization operation for one server. */
    private authorizationFor;
    /**
     * Await a shared authorization without letting one cancelled caller cancel
     * another live caller. The underlying request is aborted only after every
     * waiter has detached.
     */
    private awaitAuthorization;
    /** Read and parse the current stored write grant without any side effects. */
    private readStoredGrant;
    /**
     * Whether a grant for this Zotero instance is already available: the
     * in-memory key of this process, or a persisted grant bound to the
     * instance. It is a status fact for the settings card and the command
     * output, never a capability, since {@link keyFor} still runs the full
     * resolution.
     */
    hasGrant(serverId: string): Promise<boolean>;
    /**
     * Forget this process's copy of a key. Called by the domain when the write
     * a one-time key authorized has settled: the server consumed the key at
     * authentication whether the write succeeded or failed, so the memory slot
     * must never answer with it again. Persisted grants are untouched.
     * @param key - the one-time key the domain is done with.
     */
    forget(key: string): void;
    /**
     * Invalidate one exact grant after Zotero rejects it. The memory copy goes
     * immediately; the durable record is tombstoned through `modifyRecord`, so a
     * newer grant written by another process is never deleted.
     */
    invalidate(serverId: string, key: string): Promise<void>;
    /**
     * The persisted grant for this instance, or undefined. The record is
     * re-read on every call (the credentials seam's own discipline: never
     * cache a secret across operations), and a grant bound to another Zotero
     * instance is tombstoned rather than used, so the next authorization
     * re-binds to the instance actually connected.
     */
    private storedKey;
    /**
     * Persist one Always-Allow grant through the serialized credentials seam.
     * The memory grant remains pending after a failed write, so a later key
     * resolution retries it. When persistence is configured and the seam is
     * present, the current call fails closed rather than using a grant whose
     * Always-Allow promise could not be committed.
     */
    private persistPendingGrant;
    /**
     * Run the authorize dialog. A grant the user marked Always Allow is
     * persisted into the credentials seam, bound to this instance, when the seam
     * is composed and the setting allows it; every grant is also kept in memory
     * so the immediate next write does not re-open the dialog. If the seam is
     * absent, persistence remains pending for a later key resolution.
     */
    private authorize;
}
//# sourceMappingURL=write-auth.d.ts.map