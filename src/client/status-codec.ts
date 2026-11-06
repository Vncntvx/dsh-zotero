/**
 * Client-side strict codecs for Zotero Typert remotes.
 * @module dsh-zotero/client/status-codec
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_COMMON_INVOCATIONS, ZOTERO_STATUS_RESULT_CODEC } from '../wire-schemas.ts'

export { ZOTERO_STATUS_RESULT_CODEC }

export const ZOTERO_CLIENT_INVOCATIONS: readonly InvocationDescriptor[] = ZOTERO_COMMON_INVOCATIONS
