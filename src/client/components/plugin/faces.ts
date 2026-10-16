/**
 * The inject faces this plugin's Plugins-page entries publish. A face is what a
 * registration's `inject` factory returns: plain readonly members the component
 * reads straight off its props — no compartment, no source/hook split.
 * @module dsh-zotero/client/components/plugin/faces
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../../remote.ts'

/** The probe face the two status cards inject (activation guide, detail section). */
export interface ZoteroProbeFace {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}
