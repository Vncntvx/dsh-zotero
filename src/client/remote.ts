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

/** The mounted `zotero` namespace face (read through `mountedNamespace` in `./index.ts`). */
export type ZoteroRemoteFace = TypertRemoteNamespaceMap['zotero']

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. At runtime `mountedNamespace`
  // (client/index.ts) reads only the service store (`ctx.reflect.get`):
  // `$mount` installs the namespace child service on the gateway's own
  // context, so the dotted form `ctx.remote.zotero` is a service lookup by
  // full name and trips the inject guard on any fiber that carries a
  // runtime. This declaration stays a required face for typing while the
  // runtime value is genuinely optional.
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
