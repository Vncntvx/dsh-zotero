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
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { domainCall, errorMessageOf, ZOTERO_NOT_COMPOSED_MESSAGE } from './errors.js'
import { LOCAL_PROVIDER_ID } from './constants.js'
import {
  DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS,
  DIAGNOSTIC_MESSAGE_MAX_CHARS,
  clampText,
} from './diagnostics.js'
import { requireZoteroService } from './service.js'
import { REF_KEY_SOURCE } from './ref-grammar.js'
import { isObjectKey } from './json.js'
import { isWsl, appendWslEnv, scrubbedEnvironment } from './environment.js'
import {
  ZOTERO_DIAGNOSIS_OK,
  ZOTERO_SETTINGS_NAMESPACE,
  ZOTERO_STATUS_SERVICE_KEY,
  type ZoteroAttachmentLocationView,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroOpenProtocolResultView,
  type ZoteroReportResultView,
  type ZoteroStatusView,
  type ZoteroWriteGrantRevokeView,
  type ZoteroSourcePageRequestView,
  type ZoteroSourcePageResultView,
} from './contract.js'
import type { ZoteroStatus } from './types.js'

/**
 * Fold a host-internal status record into the wire view.
 *
 * Absent optional facts stay absent: the strict codec rejects undefined keys,
 * and a connected probe carries no diagnosis. The success sentinel is stripped
 * for the same reason the Remote endpoint strips it: it marks "nothing to
 * explain" internally and must never reach a renderer.
 * @param status - the provider's own status record.
 * @returns the view the wire `status` endpoint serves.
 */
function toStatusView(
  status: ZoteroStatus,
  sourceProjection: ZoteroStatusView['sourceProjection'],
): ZoteroStatusView {
  return {
    providerId: status.providerId,
    sourceProjection,
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

/** The deep links this host may launch: a selection or a PDF read under a library. */
const PROTOCOL_URL_PATTERN = new RegExp(
  `^zotero://(select|open-pdf)/(?:library|groups/[1-9][0-9]*)/items/${REF_KEY_SOURCE}(?:\\?([^#]*))?$`,
)

function validProtocolUrl(url: string): boolean {
  if (url === 'zotero://select/') return true
  const match = PROTOCOL_URL_PATTERN.exec(url)
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
      return pair[1] === 'annotation' ? isObjectKey(value) : /^[1-9][0-9]*$/.test(value)
    } catch {
      return false
    }
  })
}

const POWERSHELL_LAUNCHER_SCRIPT =
  "$ErrorActionPreference = 'Stop'; $p = New-Object System.Diagnostics.ProcessStartInfo; $p.UseShellExecute = $true; $p.FileName = $env:DSH_ZOTERO_PROTOCOL_URL; [System.Diagnostics.Process]::Start($p) | Out-Null"

/** Pre-encoded PowerShell script payload avoiding runtime re-encoding. */
export const POWERSHELL_LAUNCHER_BASE64 = Buffer.from(
  POWERSHELL_LAUNCHER_SCRIPT,
  'utf16le',
).toString('base64')

/** Options for launching a native zotero:// protocol deep link. */
export interface OpenProtocolOptions {
  readonly platform?: NodeJS.Platform
  readonly launcher?: ProtocolLauncher
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}

/** One protocol failure with the URL and reason the client renders. */
function protocolFailure(url: string, reason: string, cause?: unknown): RemoteError {
  return new RemoteError(
    'zotero/protocol-failed',
    reason,
    { url, reason },
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Validate a Zotero target and dispatch without a command interpreter.
 * @param url - the canonical zotero:// URL.
 * @param options - platform, launcher, cancellation, and environment.
 * @returns the success acknowledgement.
 * @throws {RemoteError} `zotero/protocol-failed` for an invalid target or a launcher failure.
 */
export async function executeOpenProtocol(
  url: string,
  options: OpenProtocolOptions = {},
): Promise<ZoteroOpenProtocolResultView> {
  const {
    platform = process.platform,
    launcher = defaultLauncher,
    signal,
    env = process.env,
  } = options

  if (!url.startsWith('zotero://')) {
    throw protocolFailure(url, 'Protocol not allowed')
  }
  if (!validProtocolUrl(url)) {
    throw protocolFailure(url, 'Malformed zotero:// URL')
  }
  try {
    signal?.throwIfAborted()
    const inWsl = platform === 'linux' && isWsl(env)
    const childEnv = scrubbedEnvironment(env)
    if (platform === 'win32' || inWsl) {
      const wslenv = inWsl ? appendWslEnv(childEnv, 'DSH_ZOTERO_PROTOCOL_URL') : childEnv.WSLENV
      const launcherEnv = {
        ...childEnv,
        DSH_ZOTERO_PROTOCOL_URL: url,
        ...(wslenv ? { WSLENV: wslenv } : {}),
      }
      await launcher(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', POWERSHELL_LAUNCHER_BASE64],
        {
          signal,
          env: launcherEnv,
        },
      )
    } else {
      await launcher(platform === 'darwin' ? 'open' : 'xdg-open', [url], { signal, env: childEnv })
    }
    return { success: true }
  } catch (error) {
    throw protocolFailure(url, errorMessageOf(error), error)
  }
}

/** Newest entries one diagnostics snapshot serves; the panel renders fewer. */
const SNAPSHOT_SERVE_LIMIT = 200

/**
 * The zotero settings page's host service. Its namesake job is the web tab's
 * live connectivity probe, but the surface also carries the attachment
 * resolution, diagnostics, client-error reports, protocol wake-up, and the
 * write-grant revocation the settings plane needs.
 */
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
    const service = this.ctx.get('zotero')
    const [status, sourceProjection] = await Promise.all([
      service === undefined ? undefined : domainCall(() => service.status(signal)),
      service === undefined
        ? Promise.resolve({ state: 'not-composed' as const })
        : domainCall(() => service.sourceProjectionStatus(signal)),
    ])
    signal.throwIfAborted()
    if (status === undefined) {
      return {
        providerId: LOCAL_PROVIDER_ID,
        sourceProjection,
        connected: false,
        diagnosis: ZOTERO_NOT_COMPOSED_MESSAGE,
      }
    }
    return toStatusView(status, sourceProjection)
  }

  /**
   * Resolve an attachment ref to its local file path or web URL for in-app reading.
   * @param ref - the item or attachment ref string.
   * @returns the resolved location view.
   */
  async resolveAttachment(ref: string, signal: AbortSignal): Promise<ZoteroAttachmentLocationView> {
    return await domainCall(() => {
      const service = requireZoteroService(this.ctx, signal)
      return service.resolveAttachment(ref, signal)
    })
  }

  /**
   * One bounded page of the literature trail, read from the core's complete
   * ledger rather than the projection's windowed view. The endpoint rides the
   * core service: the trail is a conversation surface, so a session that never
   * mounts the library panel still pages its own trail.
   * @param request - the requested page.
   * @returns the bounded page with its exact totals.
   */
  async sourcePage(
    request: ZoteroSourcePageRequestView,
    signal: AbortSignal,
  ): Promise<ZoteroSourcePageResultView> {
    return await domainCall(() => {
      const service = requireZoteroService(this.ctx, signal)
      return service.sourcePage(request, signal)
    })
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
    return await domainCall(async () => {
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
    })
  }

  /**
   * Launch a zotero:// deep link natively through the host operating system.
   * @param url - canonical zotero:// deep link.
   * @param signal - cancellation signal.
   * @returns the success acknowledgement.
   * @throws {RemoteError} `zotero/protocol-failed` for an invalid target or a launcher failure.
   */
  async openProtocol(url: string, signal: AbortSignal): Promise<ZoteroOpenProtocolResultView> {
    return executeOpenProtocol(url, { signal })
  }

  /**
   * Revoke this plugin's persisted Zotero write grant: a local credentials
   * deletion plus an in-memory reset, with no Zotero request and no approval.
   * The endpoint carries no session identity, so the gateway evaluates it on
   * the global resource: the owner and explicitly global-authorized peers may
   * call it, and a session-scoped viewer may not.
   * @param signal - cancellation signal.
   * @returns whether a stored grant was removed.
   */
  async revokeWriteGrant(signal: AbortSignal): Promise<ZoteroWriteGrantRevokeView> {
    signal.throwIfAborted()
    return await domainCall(() => requireZoteroService(this.ctx, signal).revokeWriteGrant())
  }

  /** The live `debug` flag, so the snapshot names the verbosity it was taken at. */
  private debugEnabled(): boolean {
    return this.ctx.get('zotero')?.config.debug === true
  }
}
