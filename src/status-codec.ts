/**
 * Host-only strict boundary codec for `zotero/status`.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()`, and harness 0.1.5-rc.x still reads a live `schema`
 * property — both arms live here so the browser bundle never imports zod.
 * Structural endpoint identity comes from `./contract.js`.
 * @module dsh-zotero/status-codec
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroStatusInvocation,
  type ZoteroStatusView,
} from './contract.js'

/** Wire codec: one status view (strict; absent optional facts stay absent). */
export const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    zoteroVersion: z.string().optional(),
    write: z.object({ enabled: z.boolean(), authorized: z.boolean() }).strict().optional(),
    diagnosis: z.string(),
  })
  .strict()
  .readonly()

/**
 * Strict status codec, dual-shaped on purpose.
 *
 * Harness 0.1.5-rc.x reads a live `schema`; 0.1.6-alpha.1+ materializes through
 * `create()`. Carrying both keeps the Remote mount working on either line
 * without a version sniff at register time. The host pin's `TypertCodec` only
 * names `create`, so the live-schema arm is an intentional excess property.
 */
export const zoteroStatusCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroStatusView> => zoteroStatusSchema,
  schema: zoteroStatusSchema,
} as const

/** Host Typert manifest invocations (real zod factories + dual-arm schema). */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  zoteroStatusInvocation(zoteroStatusCodec as InvocationDescriptor['result']),
]
