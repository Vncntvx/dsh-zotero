/**
 * Client-side strict codec arm for `zotero/status`.
 *
 * The browser Remote face never materializes result schemas: Client Gateway
 * returns `RemoteResult.value` unvalidated
 * (`packages/api/gateway/src/client/index.ts` invoke path), while
 * `typert.remotes.register` only requires `typeof create === 'function'`.
 * Host registration carries the real zod factory (and the 0.1.5 live schema
 * arm) in `src/status-codec.ts`.
 *
 * Materializing here would either ship a second zod copy into `lib/client.js`
 * or invent browser-side validation the platform does not perform. The factory
 * refuses materialization loudly — that is the architectural claim, not a
 * silent no-op parse.
 * @module dsh-zotero/client/status-codec
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroStatusInvocation,
} from '../contract.ts'

/** Error when browser code incorrectly tries to materialize a host-owned codec. */
export const HOST_OWNED_CODEC_MESSAGE =
  'dsh-zotero: ZoteroStatusView strict codec is host-owned; the client Remote face never materializes boundary schemas'

/**
 * Strict result codec the client contribution mounts. Same wire identity as
 * the host arm; `create` never returns a schema on this half.
 * @returns the host-owned strict codec for the status result.
 */
export function hostOwnedStatusCodec(): InvocationDescriptor['result'] {
  return {
    mode: 'strict',
    typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
    create: () => {
      throw new Error(HOST_OWNED_CODEC_MESSAGE)
    },
  }
}

/** Client Remote contribution descriptors (structural identity + host-owned codec). */
export const ZOTERO_CLIENT_INVOCATIONS: readonly InvocationDescriptor[] = [
  zoteroStatusInvocation(hostOwnedStatusCodec()),
]
