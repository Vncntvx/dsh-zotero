/**
 * Host-only strict boundary codecs for the `zotero` wire namespace.
 * @module dsh-zotero/status-codec
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_COMMON_INVOCATIONS } from './wire-schemas.js'

/** Host Typert manifest invocations (real zod factory). */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = ZOTERO_COMMON_INVOCATIONS
