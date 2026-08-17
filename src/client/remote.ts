/**
 * The client-side Typert Remote contribution for the dsh-zotero host
 * service: mounts the shared strict descriptors into `ctx.remote.zotero`.
 * The descriptors and codecs come from the shared contract module, so the
 * browser bundle and the host manifest stay on one wire definition. The
 * namespace carries the single fact the settings plane does not — live
 * connectivity for the dedicated web tab's status strip; the configuration
 * surface reads and writes through the harness's settings scope instead.
 * @module dsh-zotero/client/remote
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_INVOCATIONS } from '../contract.ts'
import type { ZoteroStatusView } from '../contract.ts'

export type { ZoteroStatusView } from '../contract.ts'

/** The zotero Remote namespace's client contribution. */
export const ZOTERO_REMOTE: TypertRemoteContribution = {
  package: 'dsh-zotero',
  descriptors: ZOTERO_INVOCATIONS,
}

/** The mounted `zotero` namespace face the client resolves through the service store. */
export type ZoteroRemoteFace = TypertRemoteNamespaceMap['zotero']

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. Note: the runtime access is NOT the
  // dotted `ctx.remote.zotero` read — that path walks the cordis fiber chain
  // and stops at the Loader's runtime-less internal forks between a plugin
  // entry and the root fiber. The plugin resolves the namespace service
  // through `ctx.reflect.get('remote.zotero')` instead (see client/index.ts).
  /** The `zotero` namespace face mounted under `ctx.remote.zotero`. */
  interface TypertRemoteNamespace$7a6f7465726f {
    status: () => Promise<RemoteResult<ZoteroStatusView>>
  }
  interface TypertRemoteMap {
    'zotero/status': () => Promise<RemoteResult<ZoteroStatusView>>
  }
  interface TypertRemoteNamespaceMap {
    zotero: TypertRemoteNamespace$7a6f7465726f
  }
}
