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
import { type ZoteroAttachmentLocationView, type ZoteroClientErrorReport, type ZoteroDiagnosticsView, type ZoteroReportResultView, type ZoteroStatusView } from './contract.js';
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
    /** The live `debug` flag, so the snapshot names the verbosity it was taken at. */
    private debugEnabled;
}
//# sourceMappingURL=remote.d.ts.map