/**
 * Host-only strict boundary codec for `zotero/status`.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()` (upstream `perf(typert): materialize generated schemas
 * on first use`). Structural endpoint identity comes from `./contract.js`.
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
 * Strict status codec. The `TypertCodec` strict arm is exactly
 * `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which this pure-JSON view does not need) — no live
 * `schema` property is carried.
 */
export const zoteroStatusCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroStatusView> => zoteroStatusSchema,
} as const

/** Host Typert manifest invocations (real zod factory). */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  zoteroStatusInvocation(zoteroStatusCodec as InvocationDescriptor['result']),
]
