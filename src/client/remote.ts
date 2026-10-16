/**
 * The client-side Typert Remote contribution for the dsh-zotero host
 * service: mounts the shared structural descriptors into `ctx.remote.zotero`.
 *
 * Endpoint identity comes from `../contract.ts` (types + wire factory, no
 * zod). The result and parameter codecs are the client arm
 * (`./status-codec.ts`), which materializes the same strict schemas the host
 * registers. Client Gateway decodes a unary result only through
 * `descriptor.result.decode`, so a pure-JSON result arrives unvalidated and
 * the client factory is not called at runtime. Configuration reads and writes
 * through the harness settings scope, not this namespace.
 * @module dsh-zotero/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroAttachmentLocationView,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroReportResultView,
  type ZoteroStatusView,
} from '../contract.ts'
import { ZOTERO_CLIENT_INVOCATIONS } from './status-codec.ts'

export type {
  ZoteroAttachmentLocationView,
  ZoteroClientErrorReport,
  ZoteroDiagnosticsView,
  ZoteroReportResultView,
  ZoteroStatusView,
} from '../contract.ts'

/** The `zotero` namespace's client contribution. */
export const ZOTERO_REMOTE: TypertRemoteContribution = {
  package: ZOTERO_REMOTE_PACKAGE,
  descriptors: ZOTERO_CLIENT_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. `index.ts` mounts this contribution
  // with `ctx.remote.$mount`, then registers the UI through
  // `ctx.inject(['remote.zotero', …], registerUi)`, so the official dotted
  // read `ctx.remote.zotero` resolves it on that fiber.
  /** The `zotero` namespace face mounted under `ctx.remote.zotero`. */
  interface TypertRemoteNamespace$7a6f7465726f {
    status: () => Promise<RemoteResult<ZoteroStatusView>>
    resolveAttachment: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
    diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>
    reportClientError: (
      report: ZoteroClientErrorReport,
    ) => Promise<RemoteResult<ZoteroReportResultView>>
  }
  interface TypertRemoteMap {
    'zotero/status': () => Promise<RemoteResult<ZoteroStatusView>>
    'zotero/resolveAttachment': (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
    'zotero/diagnostics': () => Promise<RemoteResult<ZoteroDiagnosticsView>>
    'zotero/reportClientError': (
      report: ZoteroClientErrorReport,
    ) => Promise<RemoteResult<ZoteroReportResultView>>
  }
  interface TypertRemoteNamespaceMap {
    zotero: TypertRemoteNamespace$7a6f7465726f
  }
}
