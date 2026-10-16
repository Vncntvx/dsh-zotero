/**
 * Client-side strict codecs for Zotero Typert remotes.
 *
 * Each codec carries the `{ mode, typeSymbol, create }` shape the typert
 * generator emits, and `create()` returns a module-level frozen zod schema:
 * the same strict schema the host arm registers in `src/status-codec.ts`, so
 * the two halves stay structurally identical without the browser importing
 * host code.
 *
 * Materialization here is not browser-side validation. Client Gateway decodes
 * a unary result only through `descriptor.result.decode` — which the generator
 * emits for byte-carrying boundaries alone — so a pure-JSON result reaches the
 * caller as `RemoteResult.value` and `create()` is never invoked at runtime.
 * These schemas are the structural counterpart and the fixture the parity
 * tests read. `zod` itself is the external platform module the shell serves
 * (`PLATFORM_MODULES`), so no second copy enters this bundle.
 * @module dsh-zotero/client/status-codec
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
} from '../contract.ts'

const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    endpoint: z.string().optional(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    zoteroVersion: z.string().optional(),
    write: z.object({ enabled: z.boolean(), authorized: z.boolean() }).strict().optional(),
    diagnosis: z.string().optional(),
  })
  .strict()
  .readonly()

export const ZOTERO_STATUS_CLIENT_RESULT_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroStatusView> => zoteroStatusSchema,
}) satisfies InvocationDescriptor['result']

const zoteroRefSchema = z.string().min(1)

export const ZOTERO_REF_CLIENT_PARAM_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_REF_PARAM_TYPE_SYMBOL,
  create: (): z.ZodType<string> => zoteroRefSchema,
}) satisfies InvocationDescriptor['parameters'][number]['codec']

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

export const ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroAttachmentLocationView> => zoteroAttachmentLocationSchema,
}) satisfies InvocationDescriptor['result']

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

export const ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroDiagnosticsView> => zoteroDiagnosticsSchema,
}) satisfies InvocationDescriptor['result']

const zoteroClientErrorReportSchema = z
  .object({
    surface: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
  })
  .strict()
  .readonly()

export const ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroClientErrorReport> => zoteroClientErrorReportSchema,
}) satisfies InvocationDescriptor['parameters'][number]['codec']

const zoteroReportResultSchema = z.object({ seq: z.number() }).strict().readonly()

export const ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC = Object.freeze({
  mode: 'strict',
  typeSymbol: ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  create: (): z.ZodType<ZoteroReportResultView> => zoteroReportResultSchema,
}) satisfies InvocationDescriptor['result']

/** Client Remote contribution descriptors (structural identity + real zod codec). */
export const ZOTERO_CLIENT_INVOCATIONS: readonly InvocationDescriptor[] = Object.freeze([
  zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC),
  zoteroResolveAttachmentInvocation(
    ZOTERO_REF_CLIENT_PARAM_CODEC,
    ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC,
  ),
  zoteroDiagnosticsInvocation(ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC),
  zoteroReportClientErrorInvocation(
    ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC,
    ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC,
  ),
])
