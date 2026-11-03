/**
 * The inject faces this plugin's Plugins-page entries publish. A face is what a
 * registration's `inject` factory returns: plain readonly members the component
 * reads straight off its props: no compartment, no source/hook split.
 * @module dsh-zotero/client/components/plugin/faces
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroRemediationReport,
  ZoteroRemediationRequest,
  ZoteroRemediationResult,
  ZoteroStatusView,
} from '../../remote.ts'

/**
 * The probe face the two status cards inject (activation guide, detail
 * section). The translator is not part of the face: both registrations
 * declare `locale: NS`, so the renderer synthesizes the `t` seat
 * (`ui-renderer/src/client/scoped-slots.tsx`).
 */
export interface ZoteroProbeFace {
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * The detail-page face: the probe the section already carried, plus the two
 * session-log maintenance calls the data-maintenance section runs. Both are
 * required, so a registration that forgets one fails to type instead of
 * rendering a section that silently reports every session healthy.
 */
export interface ZoteroDetailFace extends ZoteroProbeFace {
  readonly inspect: () => Promise<RemoteResult<ZoteroRemediationReport>>
  readonly execute: (
    request: ZoteroRemediationRequest,
  ) => Promise<RemoteResult<ZoteroRemediationResult>>
}
