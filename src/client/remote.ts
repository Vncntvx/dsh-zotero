/**
 * The client-side Typert Remote contribution for the dsh-zotero host
 * service: mounts the shared strict descriptors into `ctx.remote.zotero`.
 * The descriptors and codecs come from the shared contract module, so the
 * browser bundle and the host manifest stay on one wire definition.
 * @module dsh-zotero/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_INVOCATIONS } from '../contract.ts'
import type { ZoteroConfigView } from '../contract.ts'

export type { ZoteroConfigView } from '../contract.ts'

/** The zotero Remote namespace's client contribution. */
export const ZOTERO_REMOTE: TypertRemoteContribution = {
  package: 'dsh-zotero',
  descriptors: ZOTERO_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. Note: the runtime access is NOT the
  // dotted `ctx.remote.zotero` read — that path walks the cordis fiber chain
  // and stops at the Loader's runtime-less internal forks between a plugin
  // entry and the root fiber. The plugin resolves the namespace service
  // through `ctx.reflect.get('remote.zotero')` instead (see client/index.ts).
  /** The `zotero` namespace face mounted under `ctx.remote.zotero`. */
  interface TypertRemoteNamespace$7a6f7465726f {
    config: () => Promise<RemoteResult<ZoteroConfigView>>
    configUpdate: (
      patch: Record<string, unknown>,
      revision?: number,
    ) => Promise<RemoteResult<ZoteroConfigView>>
    configClear: (field: string, revision?: number) => Promise<RemoteResult<ZoteroConfigView>>
  }
  interface TypertRemoteMap {
    'zotero/config': () => Promise<RemoteResult<ZoteroConfigView>>
    'zotero/configUpdate': (
      patch: Record<string, unknown>,
      revision?: number,
    ) => Promise<RemoteResult<ZoteroConfigView>>
    'zotero/configClear': (
      field: string,
      revision?: number,
    ) => Promise<RemoteResult<ZoteroConfigView>>
  }
  interface TypertRemoteNamespaceMap {
    zotero: TypertRemoteNamespace$7a6f7465726f
  }
}
