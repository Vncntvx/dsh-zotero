/**
 * The client-side Typert Remote contribution for the dsh-zotero host
 * service: mounts the shared structural descriptors into `ctx.remote.zotero`.
 *
 * Endpoint identity comes from `../contract.ts` (types + wire factory, no
 * zod). The result codec is the client host-owned arm
 * (`./status-codec.ts`) — the browser never materializes boundary schemas;
 * host registration owns the real zod factory. Configuration reads and writes
 * through the harness settings scope, not this namespace.
 * @module dsh-zotero/client/remote
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_REMOTE_PACKAGE, type ZoteroStatusView } from '../contract.ts'
import { ZOTERO_CLIENT_INVOCATIONS } from './status-codec.ts'

export type { ZoteroStatusView } from '../contract.ts'

/** The `zotero` namespace's client contribution. */
export const ZOTERO_REMOTE: TypertRemoteContribution = {
  package: ZOTERO_REMOTE_PACKAGE,
  descriptors: ZOTERO_CLIENT_INVOCATIONS,
}

/** The mounted `zotero` namespace face (read as `ctx.remote.zotero` in `./index.ts`). */
export type ZoteroRemoteFace = TypertRemoteNamespaceMap['zotero']

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. `index.ts` mounts this contribution
  // with `ctx.remote.$mount`, then registers the UI through
  // `ctx.inject(['remote.zotero', …], registerUi)`, so the official dotted
  // read `ctx.remote.zotero` resolves it on that fiber.
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
