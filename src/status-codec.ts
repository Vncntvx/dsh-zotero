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
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  ZOTERO_REF_PARAM_TYPE_SYMBOL,
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroDiagnosticsInvocation,
  zoteroReportClientErrorInvocation,
  zoteroResolveAttachmentInvocation,
  zoteroStatusInvocation,
  type ZoteroAttachmentLocationView,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroReportResultView,
  type ZoteroStatusView,
} from './contract.js'

/** Wire codec: one status view (strict; absent optional facts stay absent). */
const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    // Optional on the wire because a service that is not composed dialled
    // nothing; required of every answer that reached a provider, which is what
    // `ZoteroStatus` (the provider's own record) carries.
    endpoint: z.string().optional(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    zoteroVersion: z.string().optional(),
    write: z.object({ enabled: z.boolean(), authorized: z.boolean() }).strict().optional(),
    // Optional on the wire because a connected probe has nothing to diagnose;
    // the host-internal `ZoteroStatus` keeps the total field with the
    // `ZOTERO_DIAGNOSIS_OK` sentinel, which the wire producer strips.
    diagnosis: z.string().optional(),
  })
  .strict()
  .readonly()

/**
 * Strict status codec. The `TypertCodec` strict arm is exactly
 * `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which this pure-JSON view does not need), so no live
 * `schema` property is carried.
 */
const zoteroStatusCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroStatusView> => zoteroStatusSchema,
} as const

/** Wire codec: resolveAttachment parameter (a non-empty string ref). */
const zoteroRefSchema = z.string().min(1)

export const zoteroRefParamCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_REF_PARAM_TYPE_SYMBOL,
  create: (): z.ZodType<string> => zoteroRefSchema,
} as const

/** Wire codec: resolveAttachment result. */
const zoteroAttachmentLocationSchema = z
  .object({
    ref: z.string(),
    kind: z.enum(['file', 'url']),
    title: z.string(),
    contentType: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
  })
  .strict()
  .readonly()

export const zoteroAttachmentLocationCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroAttachmentLocationView> => zoteroAttachmentLocationSchema,
} as const

/** Wire codec: one diagnostics snapshot (strict; the ring pre-strips absent optionals). */
const zoteroDiagnosticsSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            seq: z.number(),
            ts: z.number(),
            level: z.enum(['debug', 'info', 'warn', 'error']),
            event: z.string(),
            message: z.string(),
            count: z.number(),
            detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          })
          .strict()
          .readonly(),
      )
      .readonly(),
    total: z.number(),
    truncated: z.boolean(),
    debug: z.boolean(),
  })
  .strict()
  .readonly()

export const zoteroDiagnosticsCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroDiagnosticsView> => zoteroDiagnosticsSchema,
} as const

/** Wire codec: reportClientError parameter (surface + message required, stacks optional). */
const zoteroClientErrorReportSchema = z
  .object({
    surface: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
  })
  .strict()
  .readonly()

export const zoteroClientErrorReportCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroClientErrorReport> => zoteroClientErrorReportSchema,
} as const

/** Wire codec: reportClientError result (the ring sequence the report was assigned). */
const zoteroReportResultSchema = z.object({ seq: z.number() }).strict().readonly()

export const zoteroReportResultCodec = {
  mode: 'strict',
  typeSymbol: ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroReportResultView> => zoteroReportResultSchema,
} as const

/** Host Typert manifest invocations (real zod factory). */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  zoteroStatusInvocation(zoteroStatusCodec as InvocationDescriptor['result']),
  zoteroResolveAttachmentInvocation(
    zoteroRefParamCodec as InvocationDescriptor['parameters'][number]['codec'],
    zoteroAttachmentLocationCodec as InvocationDescriptor['result'],
  ),
  zoteroDiagnosticsInvocation(zoteroDiagnosticsCodec as InvocationDescriptor['result']),
  zoteroReportClientErrorInvocation(
    zoteroClientErrorReportCodec as InvocationDescriptor['parameters'][number]['codec'],
    zoteroReportResultCodec as InvocationDescriptor['result'],
  ),
]
