/**
 * The browser half's one live client face: the Remote calls every surface
 * shares, plus the protocol-failure notice the shell overlay renders.
 *
 * The face is created once by the root fiber and injected through
 * `ctx.slots.provideRoot` as `useZoteroClient`. Components never read a
 * module-level mutable binding, so an unload, HMR, or a second plugin instance
 * cannot leave a stale dispatcher, resolver, or reporter behind.
 * @module dsh-zotero/client/actions/client-face
 */

import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView, ZoteroClientErrorReport } from '../../contract.ts'
import { reportCrashedSurface, type ErrorReporter } from './error-reporter.ts'

/** One protocol-launch failure; `seq` keys the toast so a repeat restarts it. */
export interface ZoteroProtocolNotice {
  readonly seq: number
}

/**
 * One transient notice a panel raised, already worded by that panel.
 *
 * It lives on the face rather than in the panel because the notice outlives
 * the surface that raised it: closing a parsed tab or the manager must not
 * take the report of what it just did with it. The shell overlay owns
 * placement; `seq` keys the toast so a repeat restarts its hold.
 */
export interface ZoteroSurfaceNotice {
  readonly seq: number
  readonly text: string
  readonly tone?: 'success'
}

/** The shared browser face: Remote calls and the protocol notice. */
export interface ZoteroClientFace {
  /**
   * Launch one canonical `zotero://` URL through the Host.
   * @param url - canonical protocol URL.
   * @returns true when the Host accepted the launch; false after a visible
   *   notice and a diagnostics report when it did not.
   */
  readonly openProtocol: (url: string) => Promise<boolean>
  /** Resolve one attachment ref through the Host. */
  readonly resolveAttachment: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  /** File a client-error report through the Host diagnostics ring. */
  readonly reportClientError: ErrorReporter
  /** Current protocol-failure notice; null while none shows. */
  readonly protocolNotice: HostObservable<ZoteroProtocolNotice | null>
  /** Clear the shown protocol notice. */
  readonly dismissProtocolNotice: () => void
  /** Current transient notice a panel raised; null while none shows. */
  readonly surfaceNotice: HostObservable<ZoteroSurfaceNotice | null>
  /** Raise one transient notice in the shell overlay, outside any panel. */
  readonly notifySurface: (text: string, tone?: 'success') => void
  /** Clear the shown surface notice. */
  readonly dismissSurfaceNotice: () => void
}

/**
 * Build the browser face over the mounted `remote.zotero` namespace.
 *
 * `openProtocol` is the only launch path: a rejected or `ok:false` Remote
 * result is filed in diagnostics and shown as a toast, never converted into a
 * silent DOM anchor click. The Host owns platform dispatch; the browser does
 * not carry a second implementation.
 * @param ctx - the browser plugin context whose `remote.zotero` is mounted.
 * @returns the live face.
 */
export function createZoteroClientFace(ctx: Context): ZoteroClientFace {
  const protocolNotice = createSnapshotStore<ZoteroProtocolNotice | null>(null)
  const surfaceNotice = createSnapshotStore<ZoteroSurfaceNotice | null>(null)
  let noticeSeq = 0
  let surfaceSeq = 0

  const reportClientError: ErrorReporter = (report: ZoteroClientErrorReport) =>
    ctx.remote.zotero.reportClientError(report)

  const openProtocol = async (url: string): Promise<boolean> => {
    if (!url.startsWith('zotero://')) return false
    const result = await ctx.remote.zotero.openProtocol(url)
    if (result.ok) return true
    const failure: unknown = result.error
    reportCrashedSurface('action:open-zotero', failure, undefined, reportClientError)
    noticeSeq += 1
    protocolNotice.set({ seq: noticeSeq })
    return false
  }

  return {
    openProtocol,
    resolveAttachment: (ref) => ctx.remote.zotero.resolveAttachment(ref),
    reportClientError,
    protocolNotice,
    dismissProtocolNotice: () => {
      protocolNotice.set(null)
    },
    surfaceNotice,
    notifySurface: (text, tone) => {
      surfaceSeq += 1
      surfaceNotice.set({ seq: surfaceSeq, text, ...(tone === undefined ? {} : { tone }) })
    },
    dismissSurfaceNotice: () => {
      surfaceNotice.set(null)
    },
  }
}
