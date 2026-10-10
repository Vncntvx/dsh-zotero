/**
 * Shared attachment location resolver for browser components.
 * Configured during plugin UI registration from `ctx.remote.zotero`.
 * @module dsh-zotero/client/actions/attachment-resolver
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../contract.ts'

export type AttachmentResolver = (
  ref: string,
) => Promise<RemoteResult<ZoteroAttachmentLocationView>>

let activeResolver: AttachmentResolver | undefined

export function setAttachmentResolver(resolver: AttachmentResolver | undefined): void {
  activeResolver = resolver
}

export function getAttachmentResolver(): AttachmentResolver | undefined {
  return activeResolver
}
