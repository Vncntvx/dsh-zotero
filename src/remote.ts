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

import { execFile } from 'node:child_process'
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
  type ZoteroOpenProtocolResultView,
  type ZoteroReportResultView,
  type ZoteroStatusView,
} from './contract.js'

/** Await the OS launcher accepting the protocol request. */
export type ProtocolLauncher = (
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv },
) => Promise<void>

const defaultLauncher: ProtocolLauncher = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { ...options, windowsHide: true, shell: false }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })

function validProtocolUrl(url: string): boolean {
  if (url === 'zotero://select/') return true
  const match =
    /^zotero:\/\/(select|open-pdf)\/(?:library|groups\/[1-9][0-9]*)\/items\/[A-Z0-9]{8}(?:\?([^#]*))?$/.exec(
      url,
    )
  if (!match) return false
  if (match[2] === undefined) return true
  if (match[1] !== 'open-pdf' || !match[2]) return false
  const seen = new Set<string>()
  return match[2].split('&').every((part) => {
    const pair = /^(page|annotation)=([^=]+)$/.exec(part)
    if (!pair || seen.has(pair[1]!)) return false
    seen.add(pair[1]!)
    try {
      const value = decodeURIComponent(pair[2]!)
      return pair[1] === 'annotation' ? /^[A-Z0-9]{8}$/.test(value) : /^[1-9][0-9]*$/.test(value)
    } catch {
      return false
    }
  })
}

/** Validate a Zotero target and dispatch without a command interpreter. */
export async function executeOpenProtocol(
  url: string,
  platform: NodeJS.Platform = process.platform,
  launcher: ProtocolLauncher = defaultLauncher,
  signal?: AbortSignal,
): Promise<ZoteroOpenProtocolResultView> {
  if (!url.startsWith('zotero://')) return { ok: false, error: 'Protocol not allowed' }
  if (!validProtocolUrl(url)) return { ok: false, error: 'Malformed zotero:// URL' }
  try {
    signal?.throwIfAborted()
    if (platform === 'win32') {
      const script =
        "$ErrorActionPreference = 'Stop'; $p = New-Object System.Diagnostics.ProcessStartInfo; $p.UseShellExecute = $true; $p.FileName = $env:DSH_ZOTERO_PROTOCOL_URL; [System.Diagnostics.Process]::Start($p) | Out-Null"
      await launcher(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          signal,
          env: { ...process.env, DSH_ZOTERO_PROTOCOL_URL: url },
        },
      )
    } else {
      await launcher(platform === 'darwin' ? 'open' : 'xdg-open', [url], { signal })
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

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

  /**
   * Launch a zotero:// deep link natively through the host operating system.
   * @param url - canonical zotero:// deep link.
   * @param signal - cancellation signal.
   */
  async openProtocol(url: string, signal: AbortSignal): Promise<ZoteroOpenProtocolResultView> {
    signal.throwIfAborted()
    return executeOpenProtocol(url, process.platform, defaultLauncher, signal)
  }

  /** The live `debug` flag, so the snapshot names the verbosity it was taken at. */
  private debugEnabled(): boolean {
    return this.ctx.get('zotero')?.config.debug === true
  }
}
