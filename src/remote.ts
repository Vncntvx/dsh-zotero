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

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { domainCall, ZOTERO_NOT_COMPOSED_MESSAGE } from './errors.js'
import { LOCAL_PROVIDER_ID } from './constants.js'
import {
  DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS,
  DIAGNOSTIC_MESSAGE_MAX_CHARS,
  clampText,
} from './diagnostics.js'
import { toStatusView } from './session-events.js'
import { requireZoteroService } from './service.js'
import {
  ZOTERO_SETTINGS_NAMESPACE,
  ZOTERO_STATUS_SERVICE_KEY,
  type ZoteroAttachmentLocationView,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroReportResultView,
  type ZoteroStatusView,
} from './contract.js'

/** Newest entries one diagnostics snapshot serves; the panel renders fewer. */
const SNAPSHOT_SERVE_LIMIT = 200

/** The zotero settings page's host service: the web tab's connectivity probe. */
export class ZoteroRuntime extends TypertRemoteService {
  /**
   * Register the service under the shared cordis key bound to the `zotero`
   * wire namespace.
   * @param ctx - owning cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, ZOTERO_STATUS_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })
  }

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
  async status(signal: AbortSignal): Promise<ZoteroStatusView> {
    signal.throwIfAborted()
    const status = await this.ctx.get('zotero')?.status(signal)
    signal.throwIfAborted()
    if (status === undefined) {
      return {
        providerId: LOCAL_PROVIDER_ID,
        connected: false,
        diagnosis: ZOTERO_NOT_COMPOSED_MESSAGE,
      }
    }
    return toStatusView(status)
  }

  /**
   * Resolve an attachment ref to its local file path or web URL for in-app reading.
   * @param ref - the item or attachment ref string.
   * @returns the resolved location view.
   */
  async resolveAttachment(ref: string, signal: AbortSignal): Promise<ZoteroAttachmentLocationView> {
    const service = requireZoteroService(this.ctx, signal)
    return await domainCall(() => service.resolveAttachment(ref, signal))
  }

  /**
   * Newest-first diagnostics snapshot for the web panel: the ring's retained
   * entries, cut to the serving limit, plus the live `debug` fact so the card
   * can say which verbosity it is looking at. Served even while degraded:
   * the reader consults this record once something broke.
   * @returns the snapshot view.
   */
  async diagnostics(signal: AbortSignal): Promise<ZoteroDiagnosticsView> {
    signal.throwIfAborted()
    const service = this.ctx.get('zotero')
    if (service === undefined) {
      return { entries: [], total: 0, truncated: false, debug: false }
    }
    const snapshot = service.diagnostics.snapshot(SNAPSHOT_SERVE_LIMIT)
    return {
      entries: snapshot.entries.map((entry) => ({
        seq: entry.seq,
        ts: entry.ts,
        level: entry.level,
        event: entry.event,
        message: entry.message,
        count: entry.count,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
      })),
      total: snapshot.total,
      truncated: snapshot.truncated,
      debug: this.debugEnabled(),
    }
  }

  /**
   * Receive one client-side crash report into the same ring the host seams
   * write, so the diagnostics panel shows both halves in one place. Stacks
   * are clamped host-side; the ring's own bounds apply on top.
   * @param report - the crashed surface's report.
   * @returns the ring sequence the report was assigned.
   */
  async reportClientError(
    report: ZoteroClientErrorReport,
    signal: AbortSignal,
  ): Promise<ZoteroReportResultView> {
    const service = requireZoteroService(this.ctx, signal)
    const detail: Record<string, string> = {}
    if (report.stack !== undefined && report.stack !== '') {
      detail.stack = clampText(report.stack, DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS)
    }
    if (report.componentStack !== undefined && report.componentStack !== '') {
      detail.componentStack = clampText(report.componentStack, DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS)
    }
    const seq = service.diagnostics.push({
      level: 'error',
      event: 'client.render',
      message: clampText(`${report.surface}: ${report.message}`, DIAGNOSTIC_MESSAGE_MAX_CHARS),
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
    })
    return { seq }
  }

  /** The live `debug` flag, so the snapshot names the verbosity it was taken at. */
  private debugEnabled(): boolean {
    return this.ctx.get('zotero')?.config.debug === true
  }
}
