/**
 * The dsh-zotero host Remote service (wire namespace `zotero`, cordis key
 * {@link ZOTERO_STATUS_SERVICE_KEY}; the `zotero` key is the research
 * service's own).
 *
 * Registered as a TypertRemoteService so the Host Gateway can bind and
 * validate the service; the endpoints themselves are claimed by the strict
 * manifest in typert.ts (`ctx.typert.register`), which is the gateway's
 * preferred resolution path and needs no `@Remote` markers. The manifest is
 * hand-written because Typert's generator requires an in-repo workspace root
 * (`tsconfig.host.json` plus `packages/`) that this standalone checkout does
 * not have. The endpoints serve the web tab's live connectivity probe, the
 * plugin's diagnostics snapshot, and the client-error intake; the settings
 * page reads and writes the namespace through the harness's own settings
 * scope instead, so this service carries no user-layer mutation.
 * @module dsh-zotero/remote
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type ZoteroAttachmentLocationView, type ZoteroClientErrorReport, type ZoteroDiagnosticsView, type ZoteroOpenProtocolResultView, type ZoteroReportResultView, type ZoteroStatusView, type ZoteroWriteGrantRevokeView } from './contract.js';
/** Await the OS launcher accepting the protocol request. */
export type ProtocolLauncher = (command: string, args: readonly string[], options: {
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
}) => Promise<void>;
/** Pre-encoded PowerShell script payload avoiding runtime re-encoding. */
export declare const POWERSHELL_LAUNCHER_BASE64: string;
/** Options for launching a native zotero:// protocol deep link. */
export interface OpenProtocolOptions {
    readonly platform?: NodeJS.Platform;
    readonly launcher?: ProtocolLauncher;
    readonly signal?: AbortSignal;
    readonly env?: NodeJS.ProcessEnv;
}
/**
 * Validate a Zotero target and dispatch without a command interpreter.
 * @param url - the canonical zotero:// URL.
 * @param options - platform, launcher, cancellation, and environment.
 * @returns the success acknowledgement.
 * @throws {RemoteError} `zotero/protocol-failed` for an invalid target or a launcher failure.
 */
export declare function executeOpenProtocol(url: string, options?: OpenProtocolOptions): Promise<ZoteroOpenProtocolResultView>;
/** The zotero settings page's host service: the web tab's connectivity probe. */
export declare class ZoteroRuntime extends TypertRemoteService {
    /**
     * Register the service under the shared cordis key bound to the `zotero`
     * wire namespace.
     * @param ctx - owning cordis context.
     */
    constructor(ctx: Context);
    /**
     * Live connectivity view for the dedicated web tab: the service's status
     * probe with absent optional facts stripped (the strict wire codec rejects
     * undefined field keys). The endpoint rides unconditionally: a provider that
     * answered dialled something, and the card's live refresh replaces the parsed
     * text with this view, so an endpoint dropped here would make the address
     * disappear the moment the user clicked Refresh. The success sentinel
     * `ZOTERO_DIAGNOSIS_OK` is stripped the same way: a connected probe has
     * nothing to diagnose, so the card never renders a diagnosis box for a
     * healthy service.
     * @returns the connectivity view; the provider converges failures into it.
     */
    status(signal: AbortSignal): Promise<ZoteroStatusView>;
    /**
     * Resolve an attachment ref to its local file path or web URL for in-app reading.
     * @param ref - the item or attachment ref string.
     * @returns the resolved location view.
     */
    resolveAttachment(ref: string, signal: AbortSignal): Promise<ZoteroAttachmentLocationView>;
    /**
     * Newest-first diagnostics snapshot for the web panel: the ring's retained
     * entries, cut to the serving limit, plus the live `debug` fact so the card
     * can say which verbosity it is looking at. Served even while degraded:
     * the reader consults this record once something broke.
     * @returns the snapshot view.
     */
    diagnostics(signal: AbortSignal): Promise<ZoteroDiagnosticsView>;
    /**
     * Receive one client-side crash report into the same ring the host seams
     * write, so the diagnostics panel shows both halves in one place. Stacks
     * are clamped host-side; the ring's own bounds apply on top.
     * @param report - the crashed surface's report.
     * @returns the ring sequence the report was assigned.
     */
    reportClientError(report: ZoteroClientErrorReport, signal: AbortSignal): Promise<ZoteroReportResultView>;
    /**
     * Launch a zotero:// deep link natively through the host operating system.
     * @param url - canonical zotero:// deep link.
     * @param signal - cancellation signal.
     * @returns the success acknowledgement.
     * @throws {RemoteError} `zotero/protocol-failed` for an invalid target or a launcher failure.
     */
    openProtocol(url: string, signal: AbortSignal): Promise<ZoteroOpenProtocolResultView>;
    /**
     * Revoke this plugin's persisted Zotero write grant: a local credentials
     * deletion plus an in-memory reset, with no Zotero request and no approval.
     * The endpoint carries no session identity, so the gateway evaluates it on
     * the global resource: the owner and explicitly global-authorized peers may
     * call it, and a session-scoped viewer may not.
     * @param signal - cancellation signal.
     * @returns whether a stored grant was removed.
     */
    revokeWriteGrant(signal: AbortSignal): Promise<ZoteroWriteGrantRevokeView>;
    /** The live `debug` flag, so the snapshot names the verbosity it was taken at. */
    private debugEnabled;
}
//# sourceMappingURL=remote.d.ts.map